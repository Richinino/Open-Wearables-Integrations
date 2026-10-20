# Public ingress, private tailnet and local application checks are evaluated separately.
[CmdletBinding()]
param([switch]$LibraryOnly, [int]$RetrySeconds = 15)
$ErrorActionPreference = 'Stop'
$Tailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
$DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
$LogFile = Join-Path $DataDir 'funnel-watchdog.log'
$StateFile = Join-Path $DataDir 'funnel-watchdog.last'
$HealthFile = Join-Path $DataDir 'funnel-health.json'
$MinMinutesBetweenReconnects = 10

function Write-Log([string]$Message) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    $Lines = @(Get-Content -LiteralPath $LogFile)
    if ($Lines.Count -gt 500) { $Lines | Select-Object -Last 300 | Set-Content -LiteralPath $LogFile -Encoding UTF8 }
}
function Write-Health([hashtable]$Check) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $Previous = $null
    if (Test-Path -LiteralPath $HealthFile) {
        try { $Previous = Get-Content -LiteralPath $HealthFile -Raw | ConvertFrom-Json } catch { }
    }
    $Check.checked_at = (Get-Date).ToUniversalTime().ToString('o')
    $Check.schema_version = 1
    $Check.last_public_ok_at = if ($Check.public_ok) { $Check.checked_at } elseif ($Previous) { $Previous.last_public_ok_at } else { $null }
    $Temporary = "$HealthFile.tmp"
    $Check | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Temporary -Encoding UTF8
    Move-Item -LiteralPath $Temporary -Destination $HealthFile -Force
    if (-not $Previous -or $Previous.state -ne $Check.state) { Write-Log "state: $($Check.state)" }
}
function Get-HttpCode([string]$Uri, [string]$Resolve = '') {
    $Arguments = @('-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '6', '--noproxy', '*')
    if ($Resolve) { $Arguments += @('--resolve', $Resolve) }
    $Code = & curl.exe @Arguments $Uri
    if ($LASTEXITCODE -ne 0 -or $Code -notmatch '^\d{3}$') { return '000' }
    return [string]$Code
}
function Get-FunnelAddresses([string]$Name) {
    # Resolve public ingress independently of MagicDNS on this host.
    $Answer = Invoke-RestMethod -Uri "https://dns.google/resolve?name=$Name&type=A" -TimeoutSec 12
    return @($Answer.Answer | Where-Object { $_.type -eq 1 } | ForEach-Object { $_.data })
}
function Test-Funnel([string]$Name, [string[]]$Addresses) {
    $Transport = $false
    foreach ($Address in $Addresses) {
        $Resolve = '{0}:443:{1}' -f $Name, $Address
        $Backend = Get-HttpCode "https://$Name/" $Resolve
        $Api = Get-HttpCode "https://$Name/owi/ready" $Resolve
        if ($Backend -ne '000' -or $Api -ne '000') { $Transport = $true }
        if ($Backend -eq '200' -and $Api -eq '200') { return @{ Healthy = $true; Transport = $true } }
    }
    return @{ Healthy = $false; Transport = $Transport }
}
function Reconnect([string]$Reason) {
    if (Test-Path -LiteralPath $StateFile) {
        try {
            $Last = [datetimeoffset]::Parse((Get-Content -LiteralPath $StateFile -Raw))
            if ([datetimeoffset]::Now - $Last -lt [timespan]::FromMinutes($MinMinutesBetweenReconnects)) {
                Write-Log "$Reason; reconnected recently, waiting"
                return $false
            }
        } catch { Write-Log 'invalid reconnect timestamp; ignoring it' }
    }
    & $Tailscale down | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'tailscale down failed' }
    & $Tailscale up --timeout=20s | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'tailscale up failed' }
    [datetimeoffset]::Now.ToString('o') | Set-Content -LiteralPath $StateFile -Encoding UTF8
    Write-Log "$Reason; Tailscale reconnected; verifying ingress"
    return $true
}
function Invoke-Watchdog {
    $Check = @{ state = 'unknown'; public_ok = $false; private_ok = $null; local_backend_ok = $false; local_api_ok = $false }
    try {
        $Check.local_backend_ok = (Get-HttpCode 'http://127.0.0.1:8000/') -eq '200'
        $Check.local_api_ok = (Get-HttpCode 'http://127.0.0.1:8787/ready') -eq '200'
        if (-not $Check.local_backend_ok -or -not $Check.local_api_ok) {
            $Check.state = 'local_service_unavailable'; Write-Health $Check; return 1
        }
        $Status = & $Tailscale status --json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw 'tailscale status failed' }
        if ($Status.BackendState -ne 'Running') {
            if (-not (Reconnect "Tailscale state $($Status.BackendState)")) {
                $Check.state = 'tailscale_not_running'; Write-Health $Check; return 1
            }
            $Status = & $Tailscale status --json | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0) { throw 'tailscale status failed after reconnect' }
        }
        $Name = @($Status.CertDomains)[0]
        if (-not $Name) { throw 'no Funnel DNS name is configured' }
        $Addresses = @(Get-FunnelAddresses $Name)
        if ($Addresses.Count -eq 0) { throw 'public DNS returned no ingress addresses' }
        $Result = Test-Funnel $Name $Addresses
        if (-not $Result.Healthy) {
            Start-Sleep -Seconds $RetrySeconds
            $Result = Test-Funnel $Name $Addresses
            # HTTP errors indicate a proxy/application problem, not a dead VPN transport.
            if (-not $Result.Healthy -and -not $Result.Transport) {
                if (Reconnect 'Funnel transport does not answer') {
                    Start-Sleep -Seconds 3
                    $Result = Test-Funnel $Name $Addresses
                }
            }
        }
        $Check.public_ok = $Result.Healthy
        $Check.private_ok = (Get-HttpCode "https://$Name/owi/health") -eq '200'
        $Check.state = if (-not $Result.Healthy) { 'public_ingress_unavailable' } elseif (-not $Check.private_ok) { 'public_ok_private_unavailable' } else { 'ok' }
        Write-Health $Check
        if ($Check.public_ok) { return 0 }
        return 1
    } catch {
        $Check.state = 'check_failed'; Write-Health $Check
        Write-Log "check failed: $($_.Exception.Message)"
        return 2
    }
}
if (-not $LibraryOnly) { exit (Invoke-Watchdog) }

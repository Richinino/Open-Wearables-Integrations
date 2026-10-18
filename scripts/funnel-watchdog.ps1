# Tests the Tailscale Funnel from the outside and reconnects Tailscale when it stops answering.
#
# A VPN on this machine (NordVPN) that connects or switches servers leaves Tailscale running
# but the Funnel dead until Tailscale reconnects. Run by the scheduled task "owi Funnel
# watchdog" every 5 minutes; see docs/ako-to-funguje.md. The Funnel name comes from
# Tailscale itself, so no address is stored here.

$ErrorActionPreference = 'Stop'
$Tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
$LogFile = Join-Path $DataDir 'funnel-watchdog.log'
$StateFile = Join-Path $DataDir 'funnel-watchdog.last'
$MinMinutesBetweenReconnects = 10
$RetrySeconds = 30

function Write-Log([string]$Message) {
    New-Item -ItemType Directory -Force $DataDir | Out-Null
    Add-Content -Path $LogFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    $lines = Get-Content $LogFile
    if ($lines.Count -gt 500) { $lines | Select-Object -Last 300 | Set-Content $LogFile }
}

function Get-FunnelAddresses([string]$Name) {
    # Local DNS answers with the tailnet address, so ask public DNS for the Funnel ingress.
    $answer = Invoke-RestMethod -Uri "https://dns.google/resolve?name=$Name&type=A" -TimeoutSec 15
    return @($answer.Answer | Where-Object { $_.type -eq 1 } | ForEach-Object { $_.data })
}

function Test-Funnel([string]$Name, [string[]]$Addresses) {
    foreach ($address in $Addresses) {
        $code = & curl.exe -s -o NUL -w '%{http_code}' --max-time 15 --resolve "${Name}:443:$address" "https://$Name/"
        if ($code -and $code -ne '000') { return $true }
    }
    return $false
}

function Reconnect([string]$Reason) {
    if (Test-Path $StateFile) {
        $last = [datetime](Get-Content $StateFile -Raw)
        if ((Get-Date) - $last -lt [timespan]::FromMinutes($MinMinutesBetweenReconnects)) {
            Write-Log "$Reason; reconnected recently, waiting"
            return
        }
    }
    & $Tailscale down | Out-Null
    & $Tailscale up | Out-Null
    (Get-Date).ToString('o') | Set-Content $StateFile
    Write-Log "$Reason; Tailscale reconnected"
}

try {
    $status = & $Tailscale status --json | ConvertFrom-Json
    if ($status.BackendState -ne 'Running') {
        Reconnect "Tailscale state $($status.BackendState)"
        exit 0
    }
    $name = @($status.CertDomains)[0]
    if (-not $name) { exit 0 }
    $addresses = Get-FunnelAddresses $name
    if ($addresses.Count -eq 0) { exit 0 }
    if (Test-Funnel $name $addresses) { exit 0 }
    Start-Sleep -Seconds $RetrySeconds
    if (Test-Funnel $name $addresses) { exit 0 }
    Reconnect 'Funnel does not answer'
} catch {
    # No internet or public DNS: nothing a reconnect would fix.
    Write-Log "check skipped: $($_.Exception.Message)"
}

# Isolated regression checks: no real HTTP calls, VPN changes, sleeps or data writes.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'funnel-watchdog.ps1') -LibraryOnly
$RealReconnect = ${function:Reconnect}
$RealGetFunnelAddresses = ${function:Get-FunnelAddresses}
$Tailscale = 'Fake-Tailscale'
$script:Scenario = 'ok'
$script:Reconnects = 0
function Fake-Tailscale { $global:LASTEXITCODE = 0; '{"BackendState":"Running","CertDomains":["example.ts.net"]}' }
function Get-FunnelAddresses { @('192.0.2.1') }
function Write-Health([hashtable]$Check) { $script:LastCheck = $Check.Clone() }
function Write-Log([string]$Message) { }
function Start-Sleep { }
function Reconnect([string]$Reason) { $script:Reconnects++; return $false }
function Get-HttpCode([string]$Uri, [string]$Resolve = '') {
    if ($script:Scenario -eq 'local' -and $Uri -eq 'http://127.0.0.1:8787/ready') { return '503' }
    if ($Resolve) {
        if ($script:Scenario -eq 'http-error') { return '502' }
        if ($script:Scenario -eq 'transport') { return '000' }
    } elseif ($Uri.StartsWith('https://') -and $script:Scenario -eq 'private') { return '000' }
    return '200'
}
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "$Message; expected $Expected, got $Actual" }
}
Assert-Equal (Invoke-Watchdog) 0 'Healthy ingress'
Assert-Equal $script:LastCheck.state 'ok' 'Healthy state'
$script:Scenario = 'http-error'
Assert-Equal (Invoke-Watchdog) 1 '502 is an application failure'
Assert-Equal $script:Reconnects 0 'HTTP errors must not reconnect Tailscale'
$script:Scenario = 'private'
Assert-Equal (Invoke-Watchdog) 0 'Private VPN failure must not break working public ingress'
Assert-Equal $script:LastCheck.state 'public_ok_private_unavailable' 'Private path is diagnosed'
Assert-Equal $script:Reconnects 0 'Private failure must not flap public ingress'
$script:Scenario = 'local'
Assert-Equal (Invoke-Watchdog) 1 'A dead local API is detected'
Assert-Equal $script:LastCheck.state 'local_service_unavailable' 'Local failure is diagnosed'
Assert-Equal $script:Reconnects 0 'Local service failure must not reconnect VPN'
$script:Scenario = 'transport'
Assert-Equal (Invoke-Watchdog) 1 'Dead ingress remains a failure after cooldown'
Assert-Equal $script:Reconnects 1 'Only repeated transport failure attempts a reconnect'

# DNS failures and negative caches must not hide a working public ingress.
$script:DnsScenario = 'negative-cache'
$script:Resolvers = @()
function Invoke-RestMethod($Uri, $Headers, $TimeoutSec) {
    $script:Resolvers += $Uri
    if ($script:DnsScenario -eq 'all-fail') { throw 'resolver offline' }
    if ($Uri.StartsWith('https://dns.google/')) {
        if ($script:DnsScenario -eq 'first-offline') { throw 'resolver offline' }
        return @{ Status = 3; Answer = @() }
    }
    return @{ Status = 0; Answer = @(@{ type = 1; data = '192.0.2.2' }) }
}
Assert-Equal (@(& $RealGetFunnelAddresses 'example.ts.net'))[0] '192.0.2.2' 'Fallback after cached NXDOMAIN'
Assert-Equal $script:Resolvers.Count 2 'Both resolvers are queried after NXDOMAIN'
$script:DnsScenario = 'first-offline'
Assert-Equal (@(& $RealGetFunnelAddresses 'example.ts.net'))[0] '192.0.2.2' 'Fallback after resolver outage'
$script:DnsScenario = 'all-fail'
$DnsFailed = $false
try { & $RealGetFunnelAddresses 'example.ts.net' | Out-Null } catch { $DnsFailed = $true }
Assert-Equal $DnsFailed $true 'All DNS failures remain visible'

# The actual process launch must preserve non-default Tailscale preferences.
$UpInfo = New-TailscaleUpStartInfo
Assert-Equal $UpInfo.Arguments 'up' 'No flags that reset or require repeating unattended/exit-node settings'
Assert-Equal $UpInfo.UseShellExecute $false 'Launch the CLI directly'
Assert-Equal $UpInfo.CreateNoWindow $true 'Do not open a user window'

# Exercise the real reconnect function with only native commands and storage mocked.
$script:HasReconnectTime = $false
$script:SavedTimes = 0
$script:DownCalls = 0
$script:UpCalls = 0
$script:UpFails = $false
function Test-Path($LiteralPath) { return $script:HasReconnectTime }
function Get-Content($LiteralPath, [switch]$Raw) { return [datetimeoffset]::Now.ToString('o') }
function Set-Content($LiteralPath, $Encoding, [Parameter(ValueFromPipeline = $true)]$Value) {
    process { $script:SavedTimes++ }
}
function Fake-Tailscale {
    if ($args[0] -ne 'down') { throw 'Unexpected native command' }
    $script:DownCalls++
    $global:LASTEXITCODE = 0
}
function Invoke-TailscaleUp {
    $script:UpCalls++
    if ($script:UpFails) { throw 'simulated connection failure' }
}
Assert-Equal (& $RealReconnect 'transport failed') $true 'Running node reconnects'
Assert-Equal $script:DownCalls 1 'Running node disconnects once'
Assert-Equal $script:UpCalls 1 'Running node resumes once'
$script:UpFails = $true
$UpFailed = $false
try { & $RealReconnect 'transport failed' | Out-Null } catch { $UpFailed = $true }
Assert-Equal $UpFailed $true 'Failed startup is reported'
Assert-Equal $script:SavedTimes 2 'Failed reconnect also records its cooldown'
$script:HasReconnectTime = $true
Assert-Equal (& $RealReconnect 'transport failed') $false 'Recent failure prevents another disruptive reconnect'
Assert-Equal $script:DownCalls 2 'Cooldown avoids another disconnect'
$script:UpFails = $false
Assert-Equal (& $RealReconnect 'node stopped' -AlreadyStopped) $true 'Stopped node can resume during cooldown'
Assert-Equal $script:DownCalls 2 'Stopped node does not disconnect again'
Assert-Equal $script:UpCalls 3 'Stopped node resumes with existing preferences'
Write-Output 'Watchdog regression checks passed (13 scenarios).'

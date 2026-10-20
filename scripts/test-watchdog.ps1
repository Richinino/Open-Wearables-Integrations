# Isolated regression checks: no real HTTP calls, VPN changes, sleeps or data writes.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'funnel-watchdog.ps1') -LibraryOnly
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
Write-Output 'Watchdog regression checks passed (5 scenarios).'

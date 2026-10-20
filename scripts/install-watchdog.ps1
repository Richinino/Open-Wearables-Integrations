# Run from an elevated PowerShell to enable checks before user login.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$IsAdmin = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) { throw 'Run this script in PowerShell as Administrator to register an unattended task.' }
$Tailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
& $Tailscale set --unattended=true
if ($LASTEXITCODE -ne 0) { throw 'Could not enable Tailscale unattended mode.' }
$Script = Join-Path $PSScriptRoot 'funnel-watchdog.ps1'
$Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Script
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments
$Startup = New-ScheduledTaskTrigger -AtStartup
$Repeated = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'owi Funnel watchdog' -Action $Action -Trigger @($Startup, $Repeated) -Principal $Principal -Settings $Settings -Force | Out-Null
Write-Output 'Watchdog registered for startup and every five minutes without requiring user login.'

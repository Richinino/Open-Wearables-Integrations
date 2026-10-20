# Local safety backup. No remote upload and no automatic deletion of older snapshots.
[CmdletBinding()]
param(
    [string]$BackupRoot = (Join-Path $env:USERPROFILE 'open-wearables-backups'),
    [string]$OpenWearables = (Join-Path $env:USERPROFILE 'open-wearables'),
    [switch]$VerifyRestore
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Target = Join-Path $BackupRoot "snapshot-$Stamp"
New-Item -ItemType Directory -Path $Target -ErrorAction Stop | Out-Null
# Backups contain credentials. Only this Windows account and SYSTEM may read them.
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$UserGrant = '*{0}:(OI)(CI)F' -f $Sid
& icacls.exe $Target /inheritance:r /grant:r $UserGrant '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect backup permissions' }

function Run-Docker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArgs)
    $output = & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) { throw "Docker backup operation failed ($($DockerArgs[0]))" }
    return $output
}

$Manifest = [ordered]@{ created_at = (Get-Date).ToUniversalTime().ToString('o'); complete = $false; restore_verified = $false }
try {
    $Data = Join-Path $Repo 'data'
    $CopyTo = Join-Path $Target 'data'
    Push-Location $Repo
    try {
        & uv run --locked python -c 'import sys; from pathlib import Path; from owi.users import snapshot_data; snapshot_data(Path(sys.argv[1]), Path(sys.argv[2]))' $Data $CopyTo
        if ($LASTEXITCODE -ne 0) { throw 'SQLite snapshot failed' }
    } finally { Pop-Location }
    $ConfigDir = Join-Path $Target 'config'
    New-Item -ItemType Directory $ConfigDir | Out-Null
    $Configs = @{
        'owi.env' = (Join-Path $Repo '.env')
        'web.env.local' = (Join-Path $Repo 'web/.env.local')
        'ow.env' = (Join-Path $OpenWearables '.env')
        'ow-backend.env' = (Join-Path $OpenWearables 'backend/config/.env')
        'ow-frontend.env' = (Join-Path $OpenWearables 'frontend/.env')
        'ow-mcp.env' = (Join-Path $OpenWearables 'mcp/config/.env')
        'ow-override.yml' = (Join-Path $OpenWearables 'docker-compose.override.yml')
    }
    foreach ($Name in $Configs.Keys) {
        if (Test-Path -LiteralPath $Configs[$Name]) {
            Copy-Item -LiteralPath $Configs[$Name] -Destination (Join-Path $ConfigDir $Name)
        }
    }
    (& tailscale funnel status --json) | Set-Content -Encoding UTF8 (Join-Path $ConfigDir 'funnel.json')
    Export-ScheduledTask -TaskName 'owi Funnel watchdog' | Set-Content -Encoding UTF8 (Join-Path $ConfigDir 'watchdog-task.xml')
    (& git -C $Repo rev-parse HEAD) | Set-Content (Join-Path $ConfigDir 'source-revision.txt')
    (& git -C $OpenWearables rev-parse HEAD) | Set-Content (Join-Path $ConfigDir 'ow-source-revision.txt')
    # Preserve local fixes too: a fresh clone alone would miss uncommitted source files.
    $SourceDir = Join-Path $Target 'source'
    New-Item -ItemType Directory $SourceDir | Out-Null
    $SourceFiles = @(& git -C $Repo -c core.quotePath=false ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate source files' }
    foreach ($Relative in $SourceFiles) {
        $SourceFile = [IO.Path]::GetFullPath((Join-Path $Repo $Relative))
        if (-not $SourceFile.StartsWith($Repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Unsafe source path in backup'
        }
        if (Test-Path -LiteralPath $SourceFile -PathType Leaf) {
            $DestinationFile = Join-Path $SourceDir $Relative
            New-Item -ItemType Directory -Force (Split-Path $DestinationFile -Parent) | Out-Null
            Copy-Item -LiteralPath $SourceFile -Destination $DestinationFile
        }
    }

    foreach ($Database in @('open-wearables', 'svix')) {
        $Remote = "/tmp/owi-backup-$Stamp-$Database.dump"
        try {
            Run-Docker @('exec', 'postgres__open-wearables', 'pg_dump', '-U', 'open-wearables', '-Fc', '-d', $Database, '-f', $Remote) | Out-Null
            Run-Docker @('cp', "postgres__open-wearables:$Remote", (Join-Path $Target "$Database.dump")) | Out-Null
            Run-Docker @('exec', 'postgres__open-wearables', 'pg_restore', '--list', $Remote) | Out-Null
            if ($VerifyRestore) {
                $CheckDB = "owi_restore_$($Stamp.Replace('-', '_'))_$($Database.Replace('-', '_'))"
                $Created = $false
                try {
                    Run-Docker @('exec', 'postgres__open-wearables', 'createdb', '-U', 'open-wearables', $CheckDB) | Out-Null
                    $Created = $true
                    Run-Docker @('exec', 'postgres__open-wearables', 'pg_restore', '-U', 'open-wearables', '--exit-on-error', '--no-owner', '--no-privileges', '-d', $CheckDB, $Remote) | Out-Null
                } finally {
                    if ($Created) { Run-Docker @('exec', 'postgres__open-wearables', 'dropdb', '-U', 'open-wearables', $CheckDB) | Out-Null }
                }
            }
        } finally {
            Run-Docker @('exec', 'postgres__open-wearables', 'rm', '-f', $Remote) | Out-Null
        }
    }
    $Manifest.complete = $true
    $Manifest.restore_verified = [bool]$VerifyRestore
    $Manifest.files = @(Get-ChildItem $Target -File -Recurse | ForEach-Object {
        @{ path = $_.FullName.Substring($Target.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
} finally {
    $Manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $Target 'manifest.json')
}
Write-Output "Backup complete: $Target; restore verified: $($Manifest.restore_verified)"

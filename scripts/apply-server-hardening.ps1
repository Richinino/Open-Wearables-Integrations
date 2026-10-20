# Applies the portable override to the sibling Open Wearables checkout.
# Run scripts/backup.ps1 -VerifyRestore first. Credentials never go to stdout or arguments.
[CmdletBinding()]
param([string]$OpenWearables = (Join-Path $env:USERPROFILE 'open-wearables'))
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent

function Read-Env([string]$Path) {
    $Values = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($Line in [IO.File]::ReadAllLines($Path)) {
            if ($Line -match '^([A-Z_][A-Z_0-9]*)=(.*)$') { $Values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
        }
    }
    return $Values
}
function Set-Env([string]$Path, [hashtable]$Updates) {
    $Lines = if (Test-Path -LiteralPath $Path) { @([IO.File]::ReadAllLines($Path)) } else { @() }
    $Found = @{}
    $Result = @($Lines | ForEach-Object {
        if ($_ -match '^([A-Z_][A-Z_0-9]*)=' -and $Updates.ContainsKey($Matches[1])) {
            $Key = $Matches[1]; $Found[$Key] = $true; "$Key=$($Updates[$Key])"
        } else { $_ }
    })
    foreach ($Key in $Updates.Keys) { if (-not $Found.ContainsKey($Key)) { $Result += "$Key=$($Updates[$Key])" } }
    [IO.File]::WriteAllLines($Path, $Result, [Text.UTF8Encoding]::new($false))
}
function New-Secret {
    $Bytes = New-Object byte[] 32
    $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Generator.GetBytes($Bytes) } finally { $Generator.Dispose() }
    return ([BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
}
$EnvPath = Join-Path $OpenWearables '.env'
$BackendEnv = Join-Path $OpenWearables 'backend/config/.env'
$Existing = Read-Env $EnvPath
$Credentials = @{}
foreach ($Key in @('DB_PASSWORD', 'REDIS_PASSWORD')) {
    $Value = $Existing[$Key]
    $Credentials[$Key] = if ($Value -and $Value.Length -ge 32 -and $Value -match '^[a-f0-9]+$') { $Value } else { New-Secret }
}
$Credentials['FLOWER_BASIC_AUTH'] = if ($Existing['FLOWER_BASIC_AUTH']) { $Existing['FLOWER_BASIC_AUTH'] } else { 'owi:' + (New-Secret) }
Set-Env $EnvPath $Credentials
Set-Env $BackendEnv @{ DB_PASSWORD = $Credentials['DB_PASSWORD']; REDIS_PASSWORD = $Credentials['REDIS_PASSWORD'] }
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$UserGrant = '*{0}:F' -f $Sid
foreach ($File in @($EnvPath, $BackendEnv)) {
    & icacls.exe $File /inheritance:r /grant:r $UserGrant '*S-1-5-18:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect credential files' }
}
Copy-Item -LiteralPath (Join-Path $Repo 'docker/open-wearables.override.yml') -Destination (Join-Path $OpenWearables 'docker-compose.override.yml') -Force
Push-Location $OpenWearables
try {
    & docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid Compose configuration; deployment not started' }
    # Change the existing role too: POSTGRES_PASSWORD only initializes an empty volume.
    $SQL = 'ALTER ROLE "open-wearables" WITH PASSWORD ' + "'" + $Credentials['DB_PASSWORD'] + "';"
    $SQL | & docker exec -i postgres__open-wearables psql -U open-wearables -d postgres -v ON_ERROR_STOP=1 -q
    if ($LASTEXITCODE -ne 0) { throw 'Database credential rotation failed' }
    & docker compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; restore the local safety backup if needed' }
} finally { Pop-Location }
Write-Output 'Internal ports restricted; database and Redis credentials updated; log rotation enabled.'

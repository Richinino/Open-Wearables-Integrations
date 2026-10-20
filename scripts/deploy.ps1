[CmdletBinding()]
param([switch]$SkipBackup, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
Push-Location $Repo
$OldTag = $env:OWI_IMAGE_TAG
$OldRevision = $env:OWI_BUILD_REVISION
try {
    if (-not $SkipBackup) { & (Join-Path $PSScriptRoot 'backup.ps1') -VerifyRestore }
    $Head = (& git rev-parse --short HEAD).Trim()
    $Digest = & uv run --locked python -c 'import hashlib,pathlib; h=hashlib.sha256(); files=sorted(pathlib.Path("src").rglob("*.py"))+[pathlib.Path(p) for p in ("pyproject.toml","uv.lock","docker/Dockerfile",".dockerignore")]; [(h.update(p.as_posix().encode()),h.update(p.read_bytes())) for p in files]; print(h.hexdigest()[:12])'
    if ($LASTEXITCODE -ne 0) { throw 'Could not calculate source revision' }
    $Revision = "$Head-$($Digest.Trim())"
    $env:OWI_BUILD_REVISION = $Revision
    $env:OWI_IMAGE_TAG = $Revision
    $Compose = @('compose', '--env-file', '.env', '-f', 'docker/compose.yml')
    & docker image inspect "owi:$Revision" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & docker @Compose build owi
        if ($LASTEXITCODE -ne 0) { throw 'Image build failed; the running services were not changed' }
    }
    if ($BuildOnly) { Write-Output "Candidate built: owi:$Revision"; return }
    $Smoke = @'
import os, sqlite3
from owi.config import load_settings
from owi.store import Store
from owi.users import user_paths
import owi.serve
s = load_settings()
assert os.getuid() != 0
paths = [s.db_path]
if s.accounts_path.is_file():
    with sqlite3.connect(s.accounts_path.resolve().as_uri() + '?mode=ro', uri=True) as accounts:
        paired = accounts.execute("SELECT ow_user_id FROM accounts WHERE status='active' AND ow_user_id IS NOT NULL").fetchall()
    paths = [user_paths(s.data_dir, row[0]).db_path for row in paired]
checked = 0
for path in paths:
    if not path.is_file():
        continue  # a newly paired account may be waiting for its first sync
    with Store(path, readonly=True) as store:
        store.span()
    checked += 1
print(f'Candidate image and data access verified ({checked} result stores)')
'@
    & docker @Compose run --rm --no-deps api python -c $Smoke
    if ($LASTEXITCODE -ne 0) { throw 'Candidate smoke test failed; the running services were not changed' }
    & docker @Compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw 'Could not start new containers' }
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 15; $Attempt++) {
        try {
            $Response = Invoke-RestMethod 'http://127.0.0.1:8787/ready' -TimeoutSec 4
            $Version = Invoke-RestMethod 'http://127.0.0.1:8787/version' -TimeoutSec 4
            if ($Response.status -eq 'ok' -and $Version.revision -eq $Revision) { $Ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $Ready) { throw 'New API did not become ready; preserved image: owi:before-hardening-20261019' }
    & docker image tag "owi:$Revision" owi:local
    if ($LASTEXITCODE -ne 0) { throw 'Could not update local image tag' }
    @{ revision = $Revision; deployed_at = (Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -Encoding UTF8 data/deployment.json
    Write-Output "Deployed and verified: $Revision"
} finally {
    $env:OWI_IMAGE_TAG = $OldTag
    $env:OWI_BUILD_REVISION = $OldRevision
    Pop-Location
}

[CmdletBinding()]
param([string]$Image = 'owi:local')
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
Push-Location $Repo
try {
    $PytestVersion = & uv run --locked python -c 'import tomllib; print(next(p["version"] for p in tomllib.load(open("uv.lock","rb"))["package"] if p["name"]=="pytest"))'
    if ($LASTEXITCODE -ne 0) { throw 'Could not read locked test dependency' }
    $Mount = 'type=bind,source={0},target=/testroot/tests,readonly' -f (Join-Path $Repo 'tests')
    # This is a disposable container, with no production data or secret mounts.
    $Command = 'uv pip install --python /app/.venv/bin/python pytest==' + $PytestVersion.Trim() +
        ' && python -m pytest -q /testroot/tests -o cache_dir=/tmp/pytest-cache --basetemp=/tmp/test-data'
    & docker run --rm --user 0 --mount $Mount --env 'PYTHONPATH=/app/src:/testroot' --env 'UV_CACHE_DIR=/tmp/uv-cache' --workdir /tmp $Image sh -ec $Command
    if ($LASTEXITCODE -ne 0) { throw 'Container regression tests failed' }
} finally { Pop-Location }

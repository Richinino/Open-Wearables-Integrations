# Deploy only the web sources to the existing Vercel project using its configured account.
[CmdletBinding()]
param([string]$ProjectName = 'zdravie')
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$AuthRoot = Join-Path $env:APPDATA 'com.vercel.cli/Data'
$Auth = Get-Content -LiteralPath (Join-Path $AuthRoot 'auth.json') -Raw | ConvertFrom-Json
$Config = Get-Content -LiteralPath (Join-Path $AuthRoot 'config.json') -Raw | ConvertFrom-Json
if (-not $Auth.token -or -not $Config.currentTeam) { throw 'Sign in to the Vercel CLI and select the intended team first.' }
$Headers = @{ Authorization = "Bearer $($Auth.token)" }
$TeamQuery = 'teamId=' + [uri]::EscapeDataString($Config.currentTeam)
$Projects = Invoke-RestMethod "https://api.vercel.com/v10/projects?$TeamQuery" -Headers $Headers -TimeoutSec 20
$Matches = @($Projects.projects | Where-Object { $_.name -eq $ProjectName })
if ($Matches.Count -ne 1) { throw 'The existing Vercel project could not be selected unambiguously.' }
$Project = $Matches[0]
if ($Project.rootDirectory -ne 'web') { throw 'This deployment script expects the existing project root to be web/.' }

$Paths = @()
foreach ($Folder in @('web/src', 'web/public')) {
    $Paths += @(Get-ChildItem -LiteralPath (Join-Path $Repo $Folder) -File -Recurse)
}
foreach ($Name in @('package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'eslint.config.mjs', 'vitest.config.mts')) {
    $Paths += Get-Item -LiteralPath (Join-Path $Repo "web/$Name")
}
$Files = @()
$Digest = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
try {
    foreach ($Path in ($Paths | Sort-Object FullName)) {
        $Relative = $Path.FullName.Substring($Repo.Length + 1).Replace('\', '/')
        # No environment files, build outputs, dependencies or local health data are uploaded.
        if ($Relative -notmatch '^web/(src/|public/|[^/]+\.(json|ts|mts|mjs)$)' -or $Path.Name -like '.env*') {
            throw 'Unexpected file in the deployment manifest.'
        }
        $Bytes = [IO.File]::ReadAllBytes($Path.FullName)
        $Digest.AppendData([Text.Encoding]::UTF8.GetBytes($Relative))
        $Digest.AppendData($Bytes)
        $Files += @{ file = $Relative; data = [Convert]::ToBase64String($Bytes); encoding = 'base64' }
    }
    $Revision = ([BitConverter]::ToString($Digest.GetHashAndReset())).Replace('-', '').ToLowerInvariant()
} finally { $Digest.Dispose() }
$Payload = @{
    name = $ProjectName; project = $Project.id; target = 'production'; files = $Files
    meta = @{ sourceRevision = $Revision; source = 'local-hardening' }
    projectSettings = @{ rootDirectory = 'web'; framework = 'nextjs'; nodeVersion = $Project.nodeVersion }
} | ConvertTo-Json -Depth 8 -Compress
if ([Text.Encoding]::UTF8.GetByteCount($Payload) -gt 4MB) { throw 'Deployment manifest is too large for inline upload.' }
$Details = Invoke-RestMethod "https://api.vercel.com/v9/projects/$($Project.id)?$TeamQuery" -Headers $Headers -TimeoutSec 20
@{ id = $Details.targets.production.id; url = $Details.targets.production.url } |
    ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Repo 'data/web-deployment-before.json')
$Deployment = Invoke-RestMethod "https://api.vercel.com/v13/deployments?$TeamQuery" -Method Post -Headers $Headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($Payload)) -TimeoutSec 60
$Record = @{
    id = $Deployment.id; url = $Deployment.url; revision = $Revision; project = $Project.id
    created_at = (Get-Date).ToUniversalTime().ToString('o'); state = $Deployment.readyState
}
$Record | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Repo 'data/web-deployment.json')
$Record | ConvertTo-Json -Compress

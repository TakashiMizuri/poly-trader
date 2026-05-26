param(
    [Parameter(Mandatory = $false)]
    [string]$RemoteHost = "",

    [Parameter(Mandatory = $false)]
    [string]$User = "root",

    [Parameter(Mandatory = $false)]
    [string]$ProjectDir = "/opt/poly-trader",

    [Parameter(Mandatory = $false)]
    [switch]$SkipBackup,

    [Parameter(Mandatory = $false)]
    [switch]$VerboseRemote
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-RepoDotEnv {
    param([string]$RepoRoot)
    $envPath = Join-Path $RepoRoot ".env"
    if (-not (Test-Path -LiteralPath $envPath)) {
        return
    }
    foreach ($raw in Get-Content -LiteralPath $envPath) {
        $line = $raw.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
        $eq = $line.IndexOf('=')
        if ($eq -le 0) { continue }
        $key = $line.Substring(0, $eq).Trim()
        if ($key.Length -eq 0) { continue }
        if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key))) { continue }
        $value = $line.Substring($eq + 1).Trim()
        if ($value.Length -ge 2) {
            $q = $value[0]
            if (($q -eq '"' -or $q -eq "'") -and $value[$value.Length - 1] -eq $q) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        [Environment]::SetEnvironmentVariable($key, $value)
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-RepoDotEnv -RepoRoot $repoRoot

if ([string]::IsNullOrWhiteSpace($RemoteHost)) {
    $RemoteHost = $env:POLYTRADER_DEPLOY_HOST
}

if ([string]::IsNullOrWhiteSpace($User) -or $User -eq "root") {
    $deployUser = $env:POLYTRADER_DEPLOY_USER
    if (-not [string]::IsNullOrWhiteSpace($deployUser)) {
        $User = $deployUser
    }
}

if ([string]::IsNullOrWhiteSpace($ProjectDir) -or $ProjectDir -eq "/opt/poly-trader") {
    $deployDir = $env:POLYTRADER_DEPLOY_DIR
    if (-not [string]::IsNullOrWhiteSpace($deployDir)) {
        $ProjectDir = $deployDir
    }
}

if ([string]::IsNullOrWhiteSpace($RemoteHost)) {
    throw "RemoteHost is required. Pass -RemoteHost or set POLYTRADER_DEPLOY_HOST."
}

$sshTarget = "$User@$RemoteHost"

$remoteScript = @"
set -euo pipefail
cd '$ProjectDir'
echo '==> Connected to:' \$(hostname)
echo '==> Working dir:' \$PWD
echo '==> Current branch:' \$(git rev-parse --abbrev-ref HEAD)
echo '==> Pull latest changes'
git pull --ff-only
"@

if (-not $SkipBackup) {
    $remoteScript += @"
echo '==> Backup DB'
bash deploy/backup.sh
"@
}

$remoteScript += @"
echo '==> Deploy update'
bash deploy/update.sh
"@

if ($VerboseRemote) {
    $remoteScript += @"
echo '==> Docker status'
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
"@
}

Write-Host "Deploying to $sshTarget ($ProjectDir)..."
$remoteScript | ssh $sshTarget "bash -s"
if ($LASTEXITCODE -ne 0) {
    throw "SSH deploy failed with exit code $LASTEXITCODE."
}
Write-Host "Deploy completed."

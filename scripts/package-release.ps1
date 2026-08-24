param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts'),
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $SkipVerify) {
  & (Join-Path $PSScriptRoot 'verify.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Push-Location $repositoryRoot
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }
  } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $outputRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $outputRoot | Out-Null
}

$package = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $outputRoot "huaxia-rag-mvp-$($package.version).zip"
if (Test-Path -LiteralPath $archivePath) {
  throw 'Release ZIP already exists; use a new empty output directory'
}
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("rag-release-" + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $temporaryRoot 'huaxia-rag-mvp'
New-Item -ItemType Directory -Path $stage | Out-Null

function Copy-ReleaseItem([string]$relativePath) {
  $source = Join-Path $repositoryRoot $relativePath
  $destination = Join-Path $stage $relativePath
  $parent = Split-Path -Parent $destination
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  Copy-Item -LiteralPath $source -Destination $destination -Recurse
}

try {
  foreach ($item in @('package.json', 'package-lock.json', '.env.example', 'README.md', 'backend/package.json',
    'backend/src', 'database/migrations', 'frontend/package.json', 'frontend/dist', 'docs', 'examples',
    'scripts/start-local.ps1', 'scripts/start-team.ps1', 'scripts/backup-data.ps1',
    'scripts/restore-data.ps1', 'scripts/check-data-dir.js')) {
    Copy-ReleaseItem $item
  }
  $files = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length)
    while ($relative.StartsWith('\') -or $relative.StartsWith('/')) { $relative = $relative.Substring(1) }
    [ordered]@{
      path = $relative.Replace('\', '/')
      sizeBytes = $_.Length
      sha256 = Get-Sha256 $_.FullName
    }
  })
  [ordered]@{
    formatVersion = 1
    appVersion = $package.version
    node = '>=24 <25'
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    files = $files
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'release-manifest.json') -Encoding utf8
  Compress-Archive -Path $stage -DestinationPath $archivePath -CompressionLevel Optimal
  Write-Output ([ordered]@{ status = 'RELEASE_CREATED'; path = $archivePath; fileCount = $files.Count + 1 } | ConvertTo-Json -Compress)
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}

param(
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
$source = (Resolve-Path -LiteralPath $DataDir).Path
$database = Join-Path $source 'knowledge.db'
if (-not (Test-Path -LiteralPath $database -PathType Leaf)) {
  throw 'knowledge.db does not exist in DATA_DIR'
}
if (Test-Path -LiteralPath (Join-Path $source 'runtime.lock')) {
  throw 'runtime.lock exists; stop the service before backup'
}

node (Join-Path $PSScriptRoot 'check-data-dir.js') $source
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$outputFull = [IO.Path]::GetFullPath($OutputPath)
if ([IO.Path]::GetExtension($outputFull) -ne '.zip') {
  throw 'OutputPath must use the .zip extension'
}
if (Test-Path -LiteralPath $outputFull) {
  throw 'OutputPath already exists; use a new backup file name'
}
$outputParent = Split-Path -Parent $outputFull
if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
  New-Item -ItemType Directory -Path $outputParent | Out-Null
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("rag-backup-" + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $temporaryRoot 'stage'
$stageData = Join-Path $stage 'data'
New-Item -ItemType Directory -Path $stageData | Out-Null
try {
  Copy-Item -LiteralPath $database -Destination (Join-Path $stageData 'knowledge.db')
  $original = Join-Path $source 'original'
  if (Test-Path -LiteralPath $original -PathType Container) {
    Copy-Item -LiteralPath $original -Destination (Join-Path $stageData 'original') -Recurse
  } else {
    New-Item -ItemType Directory -Path (Join-Path $stageData 'original') | Out-Null
  }
  $files = @(Get-ChildItem -LiteralPath $stageData -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length)
    while ($relative.StartsWith('\') -or $relative.StartsWith('/')) { $relative = $relative.Substring(1) }
    [ordered]@{
      path = $relative.Replace('\', '/')
      sizeBytes = $_.Length
      sha256 = Get-Sha256 $_.FullName
    }
  })
  $manifest = [ordered]@{
    formatVersion = 1
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    files = $files
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'backup-manifest.json') -Encoding utf8
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $outputFull -CompressionLevel Optimal
  Write-Output ([ordered]@{ status = 'BACKUP_CREATED'; path = $outputFull; fileCount = $files.Count } | ConvertTo-Json -Compress)
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}

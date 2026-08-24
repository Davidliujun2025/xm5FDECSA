param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [Parameter(Mandatory = $true)][string]$TargetDataDir
)

$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
$backup = (Resolve-Path -LiteralPath $BackupPath).Path
$target = [IO.Path]::GetFullPath($TargetDataDir)
if (Test-Path -LiteralPath $target) {
  throw 'TargetDataDir must be a new path that does not exist'
}
$targetParent = Split-Path -Parent $target
if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) {
  New-Item -ItemType Directory -Path $targetParent | Out-Null
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($backup)
try {
  foreach ($entry in $archive.Entries) {
    $segments = $entry.FullName.Replace('\', '/').Split('/', [StringSplitOptions]::RemoveEmptyEntries)
    if ($entry.FullName.StartsWith('/') -or $entry.FullName -match '^[A-Za-z]:' -or $segments -contains '..') {
      throw 'Backup contains an unsafe path'
    }
  }
} finally {
  $archive.Dispose()
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("rag-restore-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  Expand-Archive -LiteralPath $backup -DestinationPath $temporaryRoot
  $manifestPath = Join-Path $temporaryRoot 'backup-manifest.json'
  $sourceData = Join-Path $temporaryRoot 'data'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $sourceData 'knowledge.db') -PathType Leaf)) {
    throw 'Backup is missing its manifest or knowledge.db'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.formatVersion -ne 1) { throw 'Unsupported backup format version' }
  $manifestPaths = @($manifest.files | ForEach-Object { $_.path })
  $actualPaths = @(Get-ChildItem -LiteralPath $sourceData -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($temporaryRoot.Length)
    while ($relative.StartsWith('\') -or $relative.StartsWith('/')) { $relative = $relative.Substring(1) }
    $relative.Replace('\', '/')
  })
  if ((Compare-Object $manifestPaths $actualPaths).Count -ne 0) { throw 'Backup file manifest does not match archive contents' }
  foreach ($file in $manifest.files) {
    $candidate = Join-Path $temporaryRoot $file.path
    $hash = Get-Sha256 $candidate
    if ($hash -ne $file.sha256 -or (Get-Item -LiteralPath $candidate).Length -ne $file.sizeBytes) {
      throw "Backup file checksum failed: $($file.path)"
    }
  }
  node (Join-Path $PSScriptRoot 'check-data-dir.js') $sourceData
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Move-Item -LiteralPath $sourceData -Destination $target
  Write-Output ([ordered]@{ status = 'RESTORED'; targetDataDir = $target; fileCount = $manifest.files.Count } | ConvertTo-Json -Compress)
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}

param(
  [switch]$InstallDependencies
)

$ErrorActionPreference = 'Stop'
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("rag-portable-test-" + [guid]::NewGuid().ToString('N'))
$artifactRoot = Join-Path $temporaryRoot 'artifacts'
New-Item -ItemType Directory -Path $artifactRoot | Out-Null
try {
  & (Join-Path $PSScriptRoot 'package-release.ps1') -OutputDirectory $artifactRoot -SkipVerify
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $archive = Get-ChildItem -LiteralPath $artifactRoot -Filter '*.zip' | Select-Object -First 1
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive.FullName)
  try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $banned = @($names | Where-Object {
      $_ -match '(^|/)(node_modules|data|\.env|\.npm|npm-cache)(/|$)' -or $_ -match '\.(db|db-wal|db-shm|log)$'
    })
    if ($banned.Count -ne 0) { throw "Release contains banned content: $($banned -join ', ')" }
    if (-not ($names -contains 'huaxia-rag-mvp/release-manifest.json')) { throw 'Release is missing release-manifest.json' }
  } finally {
    $zip.Dispose()
  }

  $results = @()
  foreach ($targetNumber in 1..2) {
    $targetRoot = Join-Path $temporaryRoot "target-$targetNumber"
    Expand-Archive -LiteralPath $archive.FullName -DestinationPath $targetRoot
    $appRoot = Join-Path $targetRoot 'huaxia-rag-mvp'
    if ($InstallDependencies) {
      Push-Location $appRoot
      try {
        npm ci --omit=dev --ignore-scripts --prefer-offline
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
      } finally { Pop-Location }
      $env:NODE_ENV = 'production'
      $env:RUN_PROFILE = 'local'
      $env:RAG_HOST = '127.0.0.1'
      $env:RAG_PORT = [string](33200 + $targetNumber)
      $env:RAG_API_KEY = "portable_A1b2C3d4E5f6G7h8I9j0K1l2M3n4_$targetNumber"
      $env:FRONTEND_SESSION_SECRET = "portable_Z9y8X7w6V5u4T3s2R1q0P9o8N7m6_$targetNumber"
      $env:DATA_DIR = Join-Path $targetRoot 'runtime-data'
      $process = Start-Process -FilePath 'node.exe' -ArgumentList @('backend/src/app.js') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
      try {
        $ready = $false
        foreach ($attempt in 1..60) {
          try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$($env:RAG_PORT)/health/ready" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $ready = $true; break }
          } catch {}
          Start-Sleep -Milliseconds 250
        }
        if (-not $ready) { throw "Isolated target $targetNumber did not become ready" }
        $homeResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$($env:RAG_PORT)/" -UseBasicParsing -TimeoutSec 5
        if ($homeResponse.StatusCode -ne 200) { throw "Isolated target $targetNumber did not serve the frontend" }
      } finally {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
        $process.WaitForExit()
      }
    }
    $results += [ordered]@{ target = $targetNumber; expanded = $true; installedAndStarted = [bool]$InstallDependencies }
  }
  Write-Output ([ordered]@{
    status = 'PORTABLE_REHEARSAL_PASSED'
    computer = $env:COMPUTERNAME
    targets = $results
    note = 'Local two-directory rehearsal for clean install and startup; a second Windows computer or clean VM is a v1.1 suggestion and does not block this iteration merge.'
  } | ConvertTo-Json -Depth 5)
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    $removed = $false
    foreach ($attempt in 1..3) {
      try {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
        $removed = $true
        break
      } catch {
        Start-Sleep -Milliseconds 500
      }
    }
    if (-not $removed) { Write-Warning "Temporary rehearsal directory could not be removed: $temporaryRoot" }
  }
}

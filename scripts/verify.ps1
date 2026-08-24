$ErrorActionPreference = 'Stop'

$sourceFiles = Get-ChildItem -Path 'backend/src', 'scripts', 'tests', 'examples' -Recurse -File | Where-Object { $_.Extension -in @('.js', '.mjs') }
foreach ($file in $sourceFiles) {
  node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run smoke
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run security-scan
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path '.git') {
  git cat-file -e '8642444^{commit}'
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'Cannot verify frontend baseline 8642444'
    exit 1
  }
  git diff --exit-code 8642444 -- frontend
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'frontend differs from frozen baseline 8642444'
    exit 1
  }

  $forbiddenTrackedFiles = @(git ls-files | Where-Object {
    $trackedPath = $_.Replace('\\', '/')
    ($trackedPath -match '(^|/)(node_modules|dist|coverage|artifacts|data|logs?|npm-cache)(/|$)') -or
    ($trackedPath -match '\.(db|db-wal|db-shm|sqlite|sqlite3|log|zip|pdf|doc|docx|xls|xlsx|ppt|pptx)$') -or
    (($trackedPath -match '(^|/)\.env($|\.)') -and ($trackedPath -notmatch '(^|/)\.env\.example$'))
  })
  if ($forbiddenTrackedFiles) {
    Write-Error "Forbidden tracked runtime or sensitive files: $($forbiddenTrackedFiles -join ', ')"
    exit 1
  }
}

Write-Output 'VERIFY_PASSED'

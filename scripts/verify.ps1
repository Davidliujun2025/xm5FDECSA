$ErrorActionPreference = 'Stop'

$sourceFiles = Get-ChildItem -Path 'backend/src', 'scripts', 'tests', 'evals', 'examples' -Recurse -File | Where-Object { $_.Extension -in @('.js', '.mjs') }
foreach ($file in $sourceFiles) {
  node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run security-scan
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$forbiddenTrackedFiles = @(git ls-files | Where-Object {
  $trackedPath = $_.Replace('\\', '/')
  ($trackedPath -match '(^|/)(node_modules|dist|coverage|artifacts|data|logs?|npm-cache)(/|$)') -or
  ($trackedPath -match '\.(db|db-wal|db-shm|sqlite|sqlite3|log|zip|pdf|doc|docx|xls|xlsx|ppt|pptx)$') -or
  (($trackedPath -match '(^|/)\.env($|\.)') -and ($trackedPath -notmatch '(^|/)\.env\.example$'))
})
if ($forbiddenTrackedFiles) {
  Write-Error "发现禁止提交的敏感或运行时文件：$($forbiddenTrackedFiles -join ', ')"
  exit 1
}

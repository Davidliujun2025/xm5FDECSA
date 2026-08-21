$ErrorActionPreference = 'Stop'

$sourceFiles = Get-ChildItem -Path 'backend/src', 'scripts', 'tests' -Recurse -File -Filter '*.js'
foreach ($file in $sourceFiles) {
  node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$forbiddenTrackedFiles = git ls-files -- '.env' 'data/**' '*.db' '*.db-wal' '*.db-shm'
if ($forbiddenTrackedFiles) {
  Write-Error "发现禁止提交的敏感或运行时文件：$($forbiddenTrackedFiles -join ', ')"
}

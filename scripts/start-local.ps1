$ErrorActionPreference = 'Stop'
$env:RUN_PROFILE = 'local'
$env:RAG_HOST = '127.0.0.1'
npm start
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

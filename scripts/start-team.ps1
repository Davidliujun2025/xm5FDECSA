$ErrorActionPreference = 'Stop'
$env:RUN_PROFILE = 'team'

$required = @('RAG_HOST', 'RAG_API_KEY', 'FRONTEND_SESSION_SECRET', 'FRONTEND_DEFAULT_TOPIC_ID', 'CORS_ORIGINS', 'TEAM_ALLOWED_CIDRS')
$missing = $required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missing.Count -gt 0) {
  throw "team profile 缺少必填环境变量：$($missing -join ', ')"
}

npm start
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

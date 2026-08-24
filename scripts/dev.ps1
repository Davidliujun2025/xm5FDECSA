$ErrorActionPreference = 'Stop'
$backend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--workspace', 'backend') -NoNewWindow -PassThru
$frontend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--workspace', 'frontend') -NoNewWindow -PassThru

try {
  Wait-Process -Id $backend.Id, $frontend.Id
} finally {
  foreach ($process in @($backend, $frontend)) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id
    }
  }
}

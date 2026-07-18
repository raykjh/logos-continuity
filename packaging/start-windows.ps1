$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js 24 or newer is required. Install it from https://nodejs.org/ and run this file again."
}

$nodeMajor = [int](& $nodeCommand.Source -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 24) {
  throw "Node.js 24 or newer is required. Detected: $(& $nodeCommand.Source --version)"
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "data") | Out-Null
$env:PORT = if ($env:PORT) { $env:PORT } else { "4318" }
$env:LOGOS_DB_PATH = Join-Path $root "data\logos.db"
$url = "http://127.0.0.1:$($env:PORT)"

$server = Start-Process -FilePath $nodeCommand.Source -ArgumentList "--env-file-if-exists=.env.local", "server/index.ts" -WorkingDirectory $root -PassThru -NoNewWindow
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1
      if ($health.ok) {
        $ready = $true
        break
      }
    } catch {
      if ($server.HasExited) { break }
    }
  }
  if (-not $ready) {
    throw "LOGOS Continuity did not start successfully."
  }
  Write-Host "LOGOS Continuity is running at $url" -ForegroundColor Green
  Write-Host "Press Ctrl+C or close this window to stop the app." -ForegroundColor DarkGray
  Start-Process $url
  Wait-Process -Id $server.Id
} finally {
  if (-not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}

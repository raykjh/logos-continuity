param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev", "build", "start", "test")]
  [string]$Task
)

$runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$bundledNode = Join-Path $runtimeRoot "node\bin\node.exe"
$bundledPnpm = Join-Path $runtimeRoot "bin\fallback\pnpm.cmd"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand -and (Test-Path $bundledNode)) {
  $env:PATH = "$(Split-Path $bundledNode);$env:PATH"
  $nodeCommand = Get-Command node -ErrorAction Stop
}

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCommand -and (Test-Path $bundledPnpm)) {
  $pnpmCommand = Get-Item $bundledPnpm
}

if (-not $nodeCommand) {
  throw "Node.js 24 이상을 찾을 수 없습니다."
}
if (-not $pnpmCommand) {
  throw "pnpm을 찾을 수 없습니다."
}

switch ($Task) {
  "dev" {
    & $nodeCommand.Source --env-file-if-exists=.env.local "scripts/dev.mjs"
  }
  "build" {
    & $pnpmCommand.Source exec tsc --noEmit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $pnpmCommand.Source exec vite build
  }
  "start" {
    & $nodeCommand.Source --env-file-if-exists=.env.local "server/index.ts"
  }
  "test" {
    & $nodeCommand.Source --test "tests/*.test.ts"
  }
}

exit $LASTEXITCODE

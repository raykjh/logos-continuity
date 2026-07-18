$ErrorActionPreference = "Stop"

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$artifacts = [System.IO.Path]::GetFullPath((Join-Path $workspace "artifacts"))
$target = [System.IO.Path]::GetFullPath((Join-Path $artifacts "LOGOS-Continuity-Judge"))
$archive = [System.IO.Path]::GetFullPath((Join-Path $artifacts "LOGOS-Continuity-Judge.zip"))

if (-not $target.StartsWith($artifacts + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Portable target must stay inside the workspace artifacts directory."
}
if (-not $archive.StartsWith($artifacts + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Portable archive must stay inside the workspace artifacts directory."
}

$runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$bundledPnpm = Join-Path $runtimeRoot "bin\fallback\pnpm.cmd"
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCommand -and (Test-Path -LiteralPath $bundledPnpm)) {
  $pnpmCommand = Get-Item -LiteralPath $bundledPnpm
}
if (-not $pnpmCommand) {
  throw "pnpm is required to build the web assets."
}

Push-Location $workspace
try {
  & $pnpmCommand.Source build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }

  New-Item -ItemType Directory -Force -Path $target | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $target "data") | Out-Null
  Copy-Item -LiteralPath (Join-Path $workspace "dist") -Destination (Join-Path $target "dist") -Recurse
  Copy-Item -LiteralPath (Join-Path $workspace "server") -Destination (Join-Path $target "server") -Recurse
  Copy-Item -LiteralPath (Join-Path $workspace "packaging\README_JUDGE.md") -Destination (Join-Path $target "README_JUDGE.md")
  Copy-Item -LiteralPath (Join-Path $workspace "packaging\start-windows.ps1") -Destination (Join-Path $target "start-windows.ps1")
  Copy-Item -LiteralPath (Join-Path $workspace "packaging\start-windows.cmd") -Destination (Join-Path $target "start-windows.cmd")
  Copy-Item -LiteralPath (Join-Path $workspace "packaging\start.sh") -Destination (Join-Path $target "start.sh")
  Copy-Item -LiteralPath (Join-Path $workspace "docs\JUDGE_DEMO_SCRIPT.md") -Destination (Join-Path $target "JUDGE_DEMO_SCRIPT.md")
  Copy-Item -LiteralPath (Join-Path $workspace ".env.example") -Destination (Join-Path $target ".env.example")

  $portableMarker = [ordered]@{
    name = "LOGOS Continuity Portable Judge Build"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    requirement = "Node.js 24 or newer"
    installRequired = $false
    localSafeMode = $true
  }
  $portableMarker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target "portable-build.json") -Encoding utf8

  Compress-Archive -LiteralPath $target -DestinationPath $archive -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  $size = (Get-Item -LiteralPath $archive).Length
  $manifest = [ordered]@{
    name = "LOGOS Continuity Judge Build"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    archive = "LOGOS-Continuity-Judge.zip"
    bytes = $size
    sha256 = $hash
    requirement = "Node.js 24 or newer"
    installRequired = $false
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts "judge-build-manifest.json") -Encoding utf8
  Write-Host "Portable judge build created: $archive"
  Write-Host "SHA256: $hash"
} finally {
  Pop-Location
}

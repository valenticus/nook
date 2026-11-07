$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-build-artifact.ps1')

$windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:CARGO_TARGET_DIR = Join-Path $windowsRoot 'target-nook-dev'
$env:NOOK_DEV_BUILD = '1'
$devConfigPath = Join-Path $windowsRoot 'src-tauri\tauri.nook-dev.conf.json'
if (-not (Test-Path -LiteralPath $devConfigPath)) { throw "Nook Dev Tauri config not found: $devConfigPath" }
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if ((Test-Path -LiteralPath (Join-Path $cargoBin 'cargo.exe')) -and (($env:PATH -split ';') -notcontains $cargoBin)) {
  $env:PATH = "$cargoBin;$env:PATH"
}

Push-Location $windowsRoot
try {
  & (Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe') build --release -p nook-hook --no-default-features --features nook-dev-relay --bin nook-hook-dev
  if ($LASTEXITCODE -ne 0) { throw "Isolated Dev relay build failed with exit code $LASTEXITCODE" }

  & npx.cmd tauri build --no-bundle --features nook-dev --config src-tauri/tauri.nook-dev.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Tauri Dev build failed with exit code $LASTEXITCODE" }

  $exe = Join-Path $env:CARGO_TARGET_DIR 'release\nook-dev.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "Nook Dev executable not found: $exe" }
  $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
  if ($version.ProductName -ne 'Nook Dev' -or $version.FileDescription -ne 'Nook Dev') {
    throw "Unexpected executable metadata: ProductName='$($version.ProductName)', FileDescription='$($version.FileDescription)'"
  }

  $stableBin = Join-Path $windowsRoot 'dev-release\bin'
  $relay = Join-Path $env:CARGO_TARGET_DIR 'release\nook-hook-dev.exe'
  $artifact = Complete-NookDevArtifact -SourceExe $exe -SourceRelay $relay -DestinationBin $stableBin
  Write-Output "$($artifact.Path) SHA-256=$($artifact.Sha256)"
  Write-Output "$($artifact.RelayPath) SHA-256=$($artifact.RelaySha256)"
  Write-Output "Nook Dev metadata verified: ProductName=$($version.ProductName); FileDescription=$($version.FileDescription)"
  Write-Output "Stable Dev-only outputs: $stableBin"
}
finally {
  Pop-Location
}

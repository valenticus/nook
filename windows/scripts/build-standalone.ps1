$ErrorActionPreference = 'Stop'

$windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:CARGO_TARGET_DIR = Join-Path $windowsRoot 'target-nook-standalone'
$env:NOOK_STANDALONE_BUILD = '1'
$env:NOOK_DEV_BUILD = '0'
$standaloneConfigPath = Join-Path $windowsRoot 'src-tauri\tauri.nook-standalone.conf.json'
if (-not (Test-Path -LiteralPath $standaloneConfigPath)) { throw "Nook Standalone Tauri config not found: $standaloneConfigPath" }
$standaloneConfig = Get-Content -LiteralPath $standaloneConfigPath -Raw | ConvertFrom-Json
if ($standaloneConfig.identifier -ne 'io.github.valenticus.nook' -or
    $standaloneConfig.productName -ne 'Nook Personal Edition' -or
    $standaloneConfig.mainBinaryName -ne 'nook-standalone') {
  throw 'Nook Standalone Tauri identity is incorrect.'
}
if ($standaloneConfig.build.beforeBuildCommand -ne 'npm run build:standalone' -or
    $standaloneConfig.build.frontendDist -ne '../dist-standalone') {
  throw 'Nook Standalone frontend build must use its isolated command and output.'
}
$resources = $standaloneConfig.bundle.resources
$nsis = $standaloneConfig.bundle.windows.nsis
if (($resources.PSObject.Properties.Name -notcontains '../target/release/nook-hook.exe') -or
    $null -ne $resources.'../target/release/nook-hook.exe' -or
    $resources.'../target-nook-standalone/release/nook-hook-standalone.exe' -ne 'nook-hook-standalone.exe' -or
    $resources.'../../LICENSE' -ne 'LICENSE' -or
    $resources.'../../NOTICE' -ne 'NOTICE' -or
    $null -ne $nsis.installerHooks -or
    $null -ne $nsis.installerIcon -or
    $null -ne $nsis.uninstallerIcon -or
    $null -ne $nsis.headerImage -or
    $null -ne $nsis.uninstallerHeaderImage -or
    $null -ne $nsis.sidebarImage) {
  throw 'Nook Standalone config must remove Original relay and installer resources.'
}
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$cargoExe = Join-Path $cargoBin 'cargo.exe'
if (-not (Test-Path -LiteralPath $cargoExe)) { throw "Cargo not found: $cargoExe" }
if (($env:PATH -split ';') -notcontains $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }

Push-Location $windowsRoot
try {
  & $cargoExe build --release -p nook-hook --no-default-features --features standalone-relay --bin nook-hook-standalone
  if ($LASTEXITCODE -ne 0) { throw "Isolated Standalone relay build failed with exit code $LASTEXITCODE" }

  & npx.cmd tauri build --no-bundle --features nook-standalone --config src-tauri/tauri.nook-standalone.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Tauri Standalone build failed with exit code $LASTEXITCODE" }

  $sourceBin = Join-Path $env:CARGO_TARGET_DIR 'release'
  $exe = Join-Path $sourceBin 'nook-standalone.exe'
  $relay = Join-Path $sourceBin 'nook-hook-standalone.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "Nook Standalone executable not found: $exe" }
  if (-not (Test-Path -LiteralPath $relay)) { throw "Nook Standalone relay not found: $relay" }
  $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
  if ($version.ProductName -ne 'Nook Personal Edition' -or $version.FileDescription -ne 'Nook Personal Edition') {
    throw "Unexpected Standalone executable metadata: ProductName='$($version.ProductName)', FileDescription='$($version.FileDescription)'"
  }
  $relayVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($relay)
  if ($relayVersion.ProductName -ne 'Nook Personal Edition' -or $relayVersion.FileDescription -ne 'Nook Personal Edition' -or $relayVersion.OriginalFilename -ne 'nook-hook-standalone.exe') {
    throw "Unexpected Standalone relay metadata: ProductName='$($relayVersion.ProductName)', OriginalFilename='$($relayVersion.OriginalFilename)'"
  }

  $stableBin = Join-Path $windowsRoot 'standalone-release\bin'
  $null = [System.IO.Directory]::CreateDirectory($stableBin)
  foreach ($source in @($exe, $relay)) {
    $destination = Join-Path $stableBin (Split-Path $source -Leaf)
    [System.IO.File]::Copy($source, $destination, $true)
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -cne $destinationHash) { throw "SHA-256 copy verification failed: $destination" }
    Write-Output "$destination SHA-256=$($destinationHash.ToLowerInvariant())"
  }
  Write-Output "Nook Standalone identity verified: $($standaloneConfig.identifier); ProductName=$($version.ProductName); FileDescription=$($version.FileDescription)"
  Write-Output "Stable Standalone-only outputs: $stableBin"
}
finally {
  Pop-Location
}

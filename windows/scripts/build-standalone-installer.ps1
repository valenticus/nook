$ErrorActionPreference = 'Stop'

$windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $windowsRoot '..')).Path
$env:CARGO_TARGET_DIR = Join-Path $windowsRoot 'target-nook-standalone'
$env:NOOK_STANDALONE_BUILD = '1'
$env:NOOK_DEV_BUILD = '0'

$configPath = Join-Path $windowsRoot 'src-tauri\tauri.nook-standalone.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.productName -ne 'Nook Personal Edition' -or
    $config.version -ne '0.2.0' -or
    $config.identifier -ne 'io.github.valenticus.nook' -or
    $config.mainBinaryName -ne 'nook-standalone') {
  throw 'Standalone product identity/version is not the approved Nook Personal Edition 0.2.0 identity.'
}
if ($config.build.beforeBuildCommand -ne 'npm run build:standalone' -or
    $config.build.frontendDist -ne '../dist-standalone') {
  throw 'Standalone installer must use the isolated frontend build and output.'
}
$resources = $config.bundle.resources
$nsis = $config.bundle.windows.nsis
if ($resources.'../target/release/nook-hook.exe' -ne $null -or
    $resources.'../target-nook-standalone/release/nook-hook-standalone.exe' -ne 'nook-hook-standalone.exe' -or
    $resources.'../../LICENSE' -ne 'LICENSE' -or
    $resources.'../../NOTICE' -ne 'NOTICE' -or
    $nsis.installerHooks -ne $null) {
  throw 'Standalone bundle must include only its relay plus LICENSE/NOTICE and no installer hooks.'
}
foreach ($relative in @('LICENSE', 'NOTICE')) {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relative) -PathType Leaf)) {
    throw "Required legal notice is missing: $relative"
  }
}

$releaseTarget = Join-Path $env:CARGO_TARGET_DIR 'release'
$replaceableExecutables = @(
  [IO.Path]::GetFullPath((Join-Path $releaseTarget 'nook-standalone.exe')),
  [IO.Path]::GetFullPath((Join-Path $releaseTarget 'nook-hook-standalone.exe'))
)
$running = Get-Process -Name @('nook-standalone', 'nook-hook-standalone') -ErrorAction SilentlyContinue
if ($running) {
  $unknownPath = @($running | Where-Object { -not $_.Path })
  if ($unknownPath.Count) {
    throw 'A Standalone process is running but its executable path cannot be verified; refusing to build over a possibly locked target.'
  }
  $blocking = @($running | Where-Object {
    $processPath = [IO.Path]::GetFullPath($_.Path)
    $replaceableExecutables -contains $processPath
  })
  if ($blocking.Count) {
    $paths = ($blocking | ForEach-Object { $_.Path }) -join ', '
    throw "A Standalone build target is running ($paths). Close it manually before rebuilding those binaries."
  }
}

$cargoExe = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (-not (Test-Path -LiteralPath $cargoExe)) { throw "Cargo not found: $cargoExe" }
$cargoBin = Split-Path -Parent $cargoExe
if (($env:PATH -split ';') -notcontains $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
$sevenZip = @(
  (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
  (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $sevenZip) { throw '7-Zip is required to inspect the generated NSIS installer contents.' }

Push-Location $windowsRoot
try {
  & $cargoExe build --locked --release -p nook-hook --no-default-features --features standalone-relay --bin nook-hook-standalone
  if ($LASTEXITCODE -ne 0) { throw "Standalone relay build failed with exit code $LASTEXITCODE" }

  & npx.cmd tauri build --features nook-standalone --config src-tauri/tauri.nook-standalone.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Standalone NSIS build failed with exit code $LASTEXITCODE" }

  $release = Join-Path $env:CARGO_TARGET_DIR 'release'
  $app = Join-Path $release 'nook-standalone.exe'
  $relay = Join-Path $release 'nook-hook-standalone.exe'
  foreach ($file in @($app, $relay)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Expected Standalone build output is missing: $file" }
  }
  $appInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($app)
  $relayInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($relay)
  if ($appInfo.ProductName -ne 'Nook Personal Edition' -or
      $appInfo.FileDescription -ne 'Nook Personal Edition' -or
      $appInfo.ProductVersion -notlike '0.2.0*' -or
      $appInfo.LegalCopyright -notlike '*Zubair Bin Shaukat and contributors*') {
    throw "App metadata mismatch: Product='$($appInfo.ProductName)', Description='$($appInfo.FileDescription)', Version='$($appInfo.ProductVersion)'"
  }
  if ($relayInfo.ProductName -ne 'Nook Personal Edition' -or
      $relayInfo.FileDescription -ne 'Nook Personal Edition' -or
      $relayInfo.OriginalFilename -ne 'nook-hook-standalone.exe' -or
      $relayInfo.ProductVersion -notlike '0.2.0*' -or
      $relayInfo.LegalCopyright -notlike '*Zubair Bin Shaukat and contributors*') {
    throw "Relay metadata mismatch: Product='$($relayInfo.ProductName)', Description='$($relayInfo.FileDescription)', Filename='$($relayInfo.OriginalFilename)', Version='$($relayInfo.ProductVersion)'"
  }

  $bundle = Join-Path $release 'bundle\nsis'
  $installer = Get-ChildItem -LiteralPath $bundle -File -Filter '*-setup.exe' | Select-Object -First 1
  if (-not $installer) { throw "Tauri did not produce an NSIS setup executable in $bundle" }
  $installerInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($installer.FullName)
  if ($installerInfo.ProductName -ne 'Nook Personal Edition' -or
      $installerInfo.FileDescription -ne 'Nook Personal Edition' -or
      $installerInfo.ProductVersion -notlike '0.2.0*' -or
      $installerInfo.LegalCopyright -notlike '*Zubair Bin Shaukat and contributors*') {
    throw "Installer metadata mismatch: Product='$($installerInfo.ProductName)', Description='$($installerInfo.FileDescription)', Version='$($installerInfo.ProductVersion)'"
  }
  $listing = & $sevenZip l -slt $installer.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect NSIS installer archive with 7-Zip: $($listing -join [Environment]::NewLine)" }
  $listingText = $listing -join [Environment]::NewLine
  foreach ($required in @('nook-hook-standalone.exe', 'LICENSE', 'NOTICE')) {
    if ($listingText -notmatch [regex]::Escape($required)) { throw "NSIS installer does not contain required resource $required" }
  }
  if ($listingText -match 'nook-hook\.exe|hooks\.nsh|updater') {
    throw 'NSIS installer contains a forbidden Original relay, installer hook, or updater resource.'
  }

  $output = Join-Path $windowsRoot 'standalone-release\installer'
  $null = [IO.Directory]::CreateDirectory($output)
  $destination = Join-Path $output 'Nook-Personal-Edition-0.2.0-setup.exe'
  [IO.File]::Copy($installer.FullName, $destination, $true)
  $sourceHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
  $outputHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  if ($sourceHash -cne $outputHash) { throw 'SHA-256 mismatch after copying the installer to standalone-release.' }
  Write-Output "Installer: $destination"
  Write-Output "Identity: $($config.identifier); $($appInfo.ProductName) $($appInfo.ProductVersion)"
  Write-Output "Included: standalone relay, LICENSE, NOTICE; Original relay/updater/NSIS hooks absent"
  Write-Output "SHA-256: $($outputHash.ToLowerInvariant())"
}
finally {
  Pop-Location
}

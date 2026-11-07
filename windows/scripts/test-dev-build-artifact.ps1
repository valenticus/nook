$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'dev-build-artifact.ps1')

$parseTokens = $null
$parseErrors = $null
$buildScript = Join-Path $PSScriptRoot 'build-dev.ps1'
[System.Management.Automation.Language.Parser]::ParseFile($buildScript, [ref] $parseTokens, [ref] $parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) { throw "build-dev.ps1 failed PowerShell parsing: $($parseErrors[0].Message)" }

$tempRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) ('nook-dev-artifact-test-' + [Guid]::NewGuid().ToString('N'))))
$sourceBin = Join-Path $tempRoot 'target-nook-dev\release'
$stableBin = Join-Path $tempRoot 'dev-release\bin'
$sourceExe = Join-Path $sourceBin 'nook-dev.exe'
$sourceRelay = Join-Path $sourceBin 'nook-hook-dev.exe'
$stableExe = Join-Path $stableBin 'nook-dev.exe'
$stableRelay = Join-Path $stableBin 'nook-hook-dev.exe'

function Get-TestSha256([byte[]] $Bytes) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose() }
}

try {
  $null = [System.IO.Directory]::CreateDirectory($sourceBin)
  $firstBytes = [System.Text.Encoding]::UTF8.GetBytes('Nook Dev artifact test fixture, version one.')
  $relayBytes = [System.Text.Encoding]::UTF8.GetBytes('Nook Dev relay test fixture, deny-only.')
  [System.IO.File]::WriteAllBytes($sourceExe, $firstBytes)
  [System.IO.File]::WriteAllBytes($sourceRelay, $relayBytes)

  $first = Complete-NookDevArtifact -SourceExe $sourceExe -SourceRelay $sourceRelay -DestinationBin $stableBin
  if ($first.Path -cne [System.IO.Path]::GetFullPath($stableExe)) { throw 'The stable artifact path is incorrect.' }
  if ($first.RelayPath -cne [System.IO.Path]::GetFullPath($stableRelay)) { throw 'The stable relay path is incorrect.' }
  if ($first.Sha256 -cne (Get-TestSha256 $firstBytes)) { throw 'The reported SHA-256 does not match the source bytes.' }
  if ($first.RelaySha256 -cne (Get-TestSha256 $relayBytes)) { throw 'The reported relay SHA-256 does not match the source bytes.' }
  if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($stableExe)) -cne [Convert]::ToBase64String($firstBytes)) {
    throw 'The stable artifact contents do not match the source.'
  }
  if ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($stableRelay)) -cne [Convert]::ToBase64String($relayBytes)) {
    throw 'The stable relay contents do not match the source.'
  }

  $secondBytes = [System.Text.Encoding]::UTF8.GetBytes('Nook Dev artifact test fixture, replacement contents.')
  [System.IO.File]::WriteAllBytes($sourceExe, $secondBytes)
  $second = Complete-NookDevArtifact -SourceExe $sourceExe -SourceRelay $sourceRelay -DestinationBin $stableBin
  if ($second.Path -cne $first.Path) { throw 'The stable artifact path changed between copies.' }
  if ($second.Sha256 -cne (Get-TestSha256 $secondBytes) -or $second.Sha256 -ceq $first.Sha256) {
    throw 'The stable artifact was not overwritten and re-hashed correctly.'
  }

  $missingFailed = $false
  try { Complete-NookDevArtifact -SourceExe (Join-Path $sourceBin 'missing.exe') -SourceRelay $sourceRelay -DestinationBin $stableBin | Out-Null }
  catch { $missingFailed = $true }
  if (-not $missingFailed) { throw 'A missing build output was accepted.' }
  $missingRelayFailed = $false
  try { Complete-NookDevArtifact -SourceExe $sourceExe -SourceRelay (Join-Path $sourceBin 'missing-relay.exe') -DestinationBin $stableBin | Out-Null }
  catch { $missingRelayFailed = $true }
  if (-not $missingRelayFailed) { throw 'A missing Dev relay was accepted.' }
  if (-not [System.IO.File]::Exists($stableRelay)) { throw 'The stable Dev relay is missing from dev-release/bin.' }
  if ((Get-NookDevSha256 $stableExe) -cne $second.Sha256) { throw 'A failed copy modified the last verified stable artifact.' }

  Write-Output "PASS: copy and SHA-256 verification ($($PSVersionTable.PSVersion))"
} finally {
  if ([System.IO.Directory]::Exists($tempRoot)) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

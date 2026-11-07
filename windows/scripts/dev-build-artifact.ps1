function Get-NookDevSha256([string] $Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not [System.IO.File]::Exists($fullPath)) { throw "Dev artifact does not exist: $fullPath" }

  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  $stream = $null
  try {
    $stream = [System.IO.File]::OpenRead($fullPath)
    $digest = $algorithm.ComputeHash($stream)
    return ([System.BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $algorithm.Dispose()
  }
}

function Complete-NookDevArtifact([string] $SourceExe, [string] $SourceRelay, [string] $DestinationBin) {
  $sourcePath = [System.IO.Path]::GetFullPath($SourceExe)
  if (-not [System.IO.File]::Exists($sourcePath)) { throw "Nook Dev executable not found: $sourcePath" }
  $sourceRelayPath = [System.IO.Path]::GetFullPath($SourceRelay)
  if ([System.IO.Path]::GetFileName($sourceRelayPath) -ine 'nook-hook-dev.exe') { throw "Only nook-hook-dev.exe can be copied as the Nook Dev relay: $sourceRelayPath" }
  if (-not [System.IO.File]::Exists($sourceRelayPath)) { throw "Nook Dev relay not found: $sourceRelayPath" }

  $destination = [System.IO.Path]::GetFullPath($DestinationBin)
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $destination 'nook-dev.exe'))
  $targetRelayPath = [System.IO.Path]::GetFullPath((Join-Path $destination 'nook-hook-dev.exe'))
  if ([System.String]::Equals($sourcePath, $targetPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The stable Dev artifact destination must be separate from the build output.'
  }
  if ([System.String]::Equals($sourceRelayPath, $targetRelayPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The stable Dev relay destination must be separate from the build output.'
  }

  $null = [System.IO.Directory]::CreateDirectory($destination)
  [System.IO.File]::Copy($sourcePath, $targetPath, $true)
  [System.IO.File]::Copy($sourceRelayPath, $targetRelayPath, $true)
  if (-not [System.IO.File]::Exists($targetPath)) { throw "Stable Dev artifact was not copied: $targetPath" }
  if (-not [System.IO.File]::Exists($targetRelayPath)) { throw "Stable Dev relay was not copied: $targetRelayPath" }

  $sourceHash = Get-NookDevSha256 $sourcePath
  $targetHash = Get-NookDevSha256 $targetPath
  if ($sourceHash -cne $targetHash) { throw "SHA-256 verification failed while copying Nook Dev to $targetPath" }
  $sourceRelayHash = Get-NookDevSha256 $sourceRelayPath
  $targetRelayHash = Get-NookDevSha256 $targetRelayPath
  if ($sourceRelayHash -cne $targetRelayHash) { throw "SHA-256 verification failed while copying Nook Dev relay to $targetRelayPath" }

  return [PSCustomObject]@{ Path = $targetPath; Sha256 = $targetHash; RelayPath = $targetRelayPath; RelaySha256 = $targetRelayHash }
}

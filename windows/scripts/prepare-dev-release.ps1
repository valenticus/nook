param(
  [string] $ReleaseBin = (Join-Path $PSScriptRoot '..\dev-release\bin'),
  [switch] $Commit
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$release = [System.IO.Path]::GetFullPath($ReleaseBin)
$destination = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'NookDev\bin'))
if (-not (Test-Path -LiteralPath $release -PathType Container)) { throw 'Dev release directory does not exist.' }
if ($Commit) { $null = New-Item -ItemType Directory -Path $destination -Force }

function Get-Hash([string] $Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Publish-Immutable([string] $Name) {
  $source = Join-Path $release $Name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing Dev artifact: $Name" }
  $hash = Get-Hash $source
  $target = Join-Path $destination "nook-dev-$hash.exe"
  Write-Output "$target SHA-256=$hash"
  if (-not $Commit) { return }
  if (Test-Path -LiteralPath $target) {
    if ((Get-Hash $target) -cne $hash) { throw "Existing content-addressed artifact differs: $target" }
    return
  }
  $temporary = Join-Path $destination ('.nook-dev-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [System.IO.File]::Copy($source, $temporary, $false)
    if ((Get-Hash $temporary) -cne $hash) { throw "SHA-256 verification failed while preparing $Name" }
    try { [System.IO.File]::Move($temporary, $target) }
    catch [System.IO.IOException] {
      if (-not (Test-Path -LiteralPath $target) -or (Get-Hash $target) -cne $hash) { throw }
    }
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

Publish-Immutable 'nook-dev.exe'
if ($Commit) { Write-Output "Prepared immutable Dev artifacts under $destination" }
else { Write-Output 'Preview only. Re-run with -Commit to copy verified, content-addressed binaries.' }

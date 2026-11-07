[CmdletBinding()]
param(
  [switch]$Prepare,
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'

function Test-NookCodexRelayPair {
  param([string]$RelayPath, [string]$BuiltRelayPath)
  if (-not [System.IO.Path]::IsPathRooted($RelayPath) -or -not (Test-Path -LiteralPath $RelayPath -PathType Leaf)) { return $false }
  if (-not [System.IO.Path]::IsPathRooted($BuiltRelayPath) -or -not (Test-Path -LiteralPath $BuiltRelayPath -PathType Leaf)) { return $false }
  return (Get-FileHash -LiteralPath $RelayPath -Algorithm SHA256).Hash -ceq (Get-FileHash -LiteralPath $BuiltRelayPath -Algorithm SHA256).Hash
}

function Test-NookCodexPipeName {
  param([string]$Endpoint, [string]$UserSid)
  return $Endpoint -ceq "\\.\pipe\nook-dev-$UserSid"
}

function Test-NookCodexProcessIdentity {
  param([string]$Path, [string]$ExpectedPath, [string]$OwnerSid, [string]$ExpectedSid)
  try { $samePath = [System.IO.Path]::GetFullPath($Path) -ieq [System.IO.Path]::GetFullPath($ExpectedPath) } catch { return $false }
  return ($samePath -and $OwnerSid -ceq $ExpectedSid)
}

function Get-NookCodexHooksDocument {
  param([string]$RelayPath)
  if (-not [System.IO.Path]::IsPathRooted($RelayPath) -or [System.IO.Path]::GetFileName($RelayPath) -cne 'nook-hook-dev.exe') {
    throw 'Refusing hooks unless the command targets an absolute nook-hook-dev.exe.'
  }
  $command = '"' + $RelayPath + '" --agent codex'
  $hooks = @{}
  foreach ($event in @('SessionStart', 'SessionEnd')) {
    $timeout = if ($event -ceq 'SessionEnd') { 3 } else { 10 }
    $hooks[$event] = @(@{ hooks = @(@{ type = 'command'; command = $command; timeout = $timeout }) })
  }
  return @{ hooks = $hooks }
}

function Write-NookCodexHooksDocument {
  param([string]$Path, [string]$RelayPath)
  $json = (Get-NookCodexHooksDocument $RelayPath) | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-NookCodexConfigText {
  return 'cli_auth_credentials_store = "file"'
}

function Test-NookCodexConfigText {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  $store = @($Text -split "`r?`n" | Where-Object { $_ -match '^\s*cli_auth_credentials_store\s*=\s*"file"\s*(?:#.*)?$' })
  if ($store.Count -ne 1) { return $false }
  if ($Text -match '(?im)^\s*\[\[?hooks(?:\.|\])|^\s*\[plugins(?:\.|\])|^\s*plugins\.') { return $false }
  return $true
}

function Test-NookCodexHooksDocument {
  param([string]$Json, [string]$RelayPath)
  try { $document = $Json | ConvertFrom-Json } catch { return $false }
  if ($null -eq $document.hooks) { return $false }
  $events = @($document.hooks.PSObject.Properties.Name | Sort-Object)
  if (($events -join ',') -cne 'SessionEnd,SessionStart') { return $false }
  $expected = '"' + $RelayPath + '" --agent codex'
  foreach ($event in @('SessionStart', 'SessionEnd')) {
    $groups = @($document.hooks.$event)
    if ($groups.Count -ne 1 -or @($groups[0].hooks).Count -ne 1) { return $false }
    $hook = $groups[0].hooks[0]
    $expectedTimeout = if ($event -ceq 'SessionEnd') { 3 } else { 10 }
    if ($hook.type -cne 'command' -or $hook.command -cne $expected -or $hook.timeout -ne $expectedTimeout) { return $false }
    if ($null -ne $hook.commandWindows -or $null -ne $hook.prompt) { return $false }
  }
  return (($document | ConvertTo-Json -Depth 20 -Compress) -notmatch '(?i)(?<!dev-)nook-hook\.exe')
}

function Get-NookCodexManagedHookFindings {
  param([string]$ProgramDataRoot = $env:ProgramData)
  $findings = @()
  $root = Join-Path $ProgramDataRoot 'OpenAI\Codex'
  foreach ($name in @('config.toml', 'requirements.toml')) {
    $path = Join-Path $root $name
    try { $policyFile = Get-Item -LiteralPath $path -ErrorAction Stop }
    catch {
      if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
        $findings += [pscustomobject]@{ Source = $path; State = 'Unreadable' }
      }
      continue
    }
    if ($policyFile.PSIsContainer) { $findings += [pscustomobject]@{ Source = $path; State = 'UnexpectedDirectory' }; continue }
    try { $content = Get-Content -LiteralPath $path -Raw -ErrorAction Stop }
    catch { $findings += [pscustomobject]@{ Source = $path; State = 'Unreadable' }; continue }
    if ($content -match '(?im)^\s*(?:\[\[?hooks(?:\.|\])|hooks\.(?:managed_dir|windows_managed_dir)|allow_managed_hooks_only\s*=)') {
      $findings += [pscustomobject]@{ Source = $path; State = 'HooksPolicyPresent' }
    }
  }
  foreach ($key in @('HKLM:\SOFTWARE\Policies\OpenAI\Codex', 'HKCU:\SOFTWARE\Policies\OpenAI\Codex')) {
    try {
      $null = Get-Item -LiteralPath $key -ErrorAction Stop
      $findings += [pscustomobject]@{ Source = $key; State = 'PolicyPresent' }
    } catch {
      if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
        $findings += [pscustomobject]@{ Source = $key; State = 'Unreadable' }
      }
    }
  }
  return $findings
}

function Get-NookCodexManagedHookBlockReason {
  param([object[]]$Findings = @())
  if ($Findings.Count -gt 0) { return 'A system/managed Codex policy source is present or unreadable; effective managed hooks cannot be excluded. Refusing to launch.' }
  return $null
}

function Get-NookCodexCloudManagedHookBlockReason {
  param([string]$EffectivePolicyState = 'Unknown')
  if ($EffectivePolicyState -ceq 'VerifiedAbsent') { return $null }
  return 'Codex CLI 0.154.0 has no supported non-session command that proves cloud/enterprise requirements contain no managed hooks. CODEX_HOME does not exclude those requirements; refusing to start Codex.'
}

function Get-NookCodexScratchPaths {
  param([string]$ScratchParent, [string]$UserSid, [switch]$ForLaunch)
  if ([string]::IsNullOrWhiteSpace($ScratchParent)) {
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localAppData)) { throw 'Cannot resolve the current user LocalAppData directory.' }
    $ScratchParent = Join-Path $localAppData 'NookDev\Tests\Codex'
  }
  $sidTag = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($UserSid)).TrimEnd('=').Replace('+','-').Replace('/','_')
  $baseName = 'nook-codex-dev-' + $sidTag
  $repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $parent = [System.IO.Path]::GetFullPath($ScratchParent)
  for ($slot = 0; $slot -lt 100; $slot++) {
    $name = if ($slot -eq 0) { $baseName } else { '{0}-{1:D2}' -f $baseName, $slot }
    $root = [System.IO.Path]::GetFullPath((Join-Path $parent $name))
    if ($root.StartsWith($repo.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Scratch CODEX_HOME/workspace must be outside the repository.' }
    if (-not (Test-Path -LiteralPath $root)) {
      if ($ForLaunch) { continue }
      return [pscustomobject]@{ Root = $root; Parent = $parent; Home = (Join-Path $root 'codex-home'); Workspace = (Join-Path $root 'workspace'); Marker = (Join-Path $root '.nook-codex-dev-owned') }
    }
    $item = Get-Item -LiteralPath $root -Force -ErrorAction SilentlyContinue
    if (-not (Test-NookCodexScratchDirectoryEntry $item)) { continue }
    $markerPath = Join-Path $root '.nook-codex-dev-owned'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { continue }
    $markerText = (Get-Content -LiteralPath $markerPath -Raw -ErrorAction SilentlyContinue).TrimEnd("`r", "`n")
    if (-not (Test-NookCodexOwnershipMarker $markerText $UserSid)) { continue }
    if (-not (Test-NookCodexDirectoryAcl $root $UserSid -RequireProtectedDacl)) {
      if ($ForLaunch) { throw 'FAIL CLOSED: a marked Codex scratch profile has an unexpected ACL or owner.' }
      continue
    }
    return [pscustomobject]@{ Root = $root; Parent = $parent; Home = (Join-Path $root 'codex-home'); Workspace = (Join-Path $root 'workspace'); Marker = $markerPath }
  }
  if ($ForLaunch) { throw 'FAIL CLOSED: no safely marked isolated CODEX_HOME exists. Run -Prepare first.' }
  throw 'FAIL CLOSED: no unused safe Codex scratch slot is available.'
}

function Test-NookCodexOwnershipMarker {
  param([string]$MarkerText, [string]$UserSid)
  return (@("nook-codex-dev-v1`n$UserSid", "nook-codex-dev-v2`n$UserSid") -ccontains $MarkerText)
}

function Test-NookCodexScratchDirectoryEntry {
  param([object]$Item)
  if ($null -eq $Item -or $Item.PSIsContainer -ne $true) { return $false }
  return (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
}

function Test-NookCodexScratchLocation {
  param([string]$ScratchRoot, [string]$ExpectedRoot, [string]$LocalAppDataPath, [string]$TempPath, [string]$RepositoryPath, [string]$GlobalCodexHome)
  try {
    $root = [System.IO.Path]::GetFullPath($ScratchRoot).TrimEnd('\')
    $expected = [System.IO.Path]::GetFullPath($ExpectedRoot).TrimEnd('\')
    $local = [System.IO.Path]::GetFullPath($LocalAppDataPath).TrimEnd('\')
    $temp = [System.IO.Path]::GetFullPath($TempPath).TrimEnd('\')
    $repo = [System.IO.Path]::GetFullPath($RepositoryPath).TrimEnd('\')
    $globalHome = [System.IO.Path]::GetFullPath($GlobalCodexHome).TrimEnd('\')
  } catch { return $false }
  if ($root -ine $expected) { return $false }
  if (-not $root.StartsWith($local + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
  foreach ($forbidden in @($temp, $repo, $globalHome)) {
    if ($root -ieq $forbidden -or $root.StartsWith($forbidden + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
  }
  return $true
}

function New-NookCodexDirectorySecurity {
  param([string]$UserSid)
  $user = New-Object System.Security.Principal.SecurityIdentifier($UserSid)
  $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $security.SetOwner($user)
  foreach ($identity in @($user, $system)) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    [void]$security.AddAccessRule($rule)
  }
  return $security
}

function Test-NookCodexDirectoryAcl {
  param([string]$Path, [string]$UserSid, [switch]$RequireProtectedDacl)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if ($RequireProtectedDacl -and -not $acl.AreAccessRulesProtected) { return $false }
    $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 2) { return $false }
    $allowed = @('S-1-5-18', $UserSid)
    foreach ($rule in $rules) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
          $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
          $rule.InheritanceFlags -ne ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) -or
          $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None -or
          $rule.IdentityReference.Value -notin $allowed) { return $false }
      $allowed = @($allowed | Where-Object { $_ -cne $rule.IdentityReference.Value })
    }
    if ($allowed.Count -ne 0) { return $false }
    $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value
    return ($ownerSid -ceq $UserSid)
  } catch { return $false }
}

function Test-NookCodexNoReparsePath {
  param([string]$Path, [string]$StopAt)
  try {
    $current = [System.IO.Path]::GetFullPath($Path)
    $stop = [System.IO.Path]::GetFullPath($StopAt).TrimEnd('\')
    while ($current -and $current.StartsWith($stop, [System.StringComparison]::OrdinalIgnoreCase)) {
      if (Test-Path -LiteralPath $current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      }
      if ($current.TrimEnd('\') -ieq $stop) { return $true }
      $parent = [System.IO.Directory]::GetParent($current)
      if ($null -eq $parent) { return $false }
      $current = $parent.FullName
    }
  } catch { return $false }
  return $false
}

function Initialize-NookCodexScratchRoot {
  param([string]$Root, [string]$Parent, [string]$UserSid)
  $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  $repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $globalHome = Join-Path $env:USERPROFILE '.codex'
  $sidTag = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($UserSid)).TrimEnd('=').Replace('+','-').Replace('/','_')
  $expectedParent = [System.IO.Path]::GetFullPath((Join-Path $localAppData 'NookDev\Tests\Codex'))
  $baseName = 'nook-codex-dev-' + $sidTag
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  $rootName = [System.IO.Path]::GetFileName($rootFull)
  $validRootName = ($rootName -ceq $baseName) -or ($rootName -match ('^' + [regex]::Escape($baseName) + '-(?:0[1-9]|[1-9][0-9])$'))
  if ([System.IO.Path]::GetFullPath($Parent) -ine $expectedParent -or -not $validRootName -or -not (Test-NookCodexScratchLocation $Root $rootFull $localAppData ([System.IO.Path]::GetTempPath()) $repository $globalHome)) {
    throw 'Scratch CODEX_HOME path is outside the approved per-user Nook Dev test directory.'
  }
  if (-not (Test-NookCodexNoReparsePath $Parent $localAppData)) { throw 'Scratch parent contains a reparse point or unsafe path component.' }
  if (-not (Test-Path -LiteralPath $Parent -PathType Container)) { [void][IO.Directory]::CreateDirectory($Parent) }
  if (-not (Test-NookCodexNoReparsePath $Parent $localAppData)) { throw 'Scratch parent contains a reparse point or unsafe path component.' }
  if (-not (Test-Path -LiteralPath $Root)) {
    $security = New-NookCodexDirectorySecurity $UserSid
    [void][IO.Directory]::CreateDirectory($Root, $security)
  }
  if (-not (Test-NookCodexDirectoryAcl $Root $UserSid -RequireProtectedDacl)) { throw 'Scratch root ACL is not restricted to the current Windows SID and SYSTEM.' }
}

function Test-NookCodexWorkspaceIsolation {
  param([string]$Workspace)
  if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { return $false }
  foreach ($name in @('.codex', '.git', 'AGENTS.md', '.agents')) {
    if (Test-Path -LiteralPath (Join-Path $Workspace $name)) { return $false }
  }
  return $true
}

function Initialize-NookCodexScratchContents {
  param([string]$ScratchRoot, [string]$RelayPath, [string]$UserSid)
  $scratchCodexHome = Join-Path $ScratchRoot 'codex-home'
  $workspace = Join-Path $ScratchRoot 'workspace'
  $marker = Join-Path $ScratchRoot '.nook-codex-dev-owned'
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'Scratch path already exists without this launcher ownership marker; refusing to modify it.' }
  $markerText = (Get-Content -LiteralPath $marker -Raw).TrimEnd("`r", "`n")
  if (-not (Test-NookCodexOwnershipMarker $markerText $UserSid)) { throw 'Scratch ownership marker does not match this user; refusing to modify it.' }
  foreach ($path in @($scratchCodexHome, $workspace)) {
    if (Test-Path -LiteralPath $path) {
      if (-not (Test-NookCodexDirectoryAcl $path $UserSid)) { throw 'Scratch child directory has an unexpected ACL, owner, or reparse point.' }
    } else {
      [void][IO.Directory]::CreateDirectory($path)
      if (-not (Test-NookCodexDirectoryAcl $path $UserSid)) { throw 'Scratch child directory did not inherit the restricted Nook Dev ACL.' }
    }
  }
  $hooksPath = Join-Path $scratchCodexHome 'hooks.json'
  if (Test-Path -LiteralPath $hooksPath -PathType Leaf) {
    if (-not (Test-NookCodexHooksDocument (Get-Content -LiteralPath $hooksPath -Raw) $RelayPath)) { throw 'Existing scratch hooks are not exactly the two approved Dev lifecycle hooks; refusing to overwrite.' }
  } else { Write-NookCodexHooksDocument $hooksPath $RelayPath }
  $configPath = Join-Path $scratchCodexHome 'config.toml'
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    if (-not (Test-NookCodexConfigText (Get-Content -LiteralPath $configPath -Raw))) { throw 'Existing scratch config is not restricted to file-backed isolated auth; refusing to overwrite.' }
  } else { Set-Content -LiteralPath $configPath -Value (Get-NookCodexConfigText) -Encoding ASCII }
  if (-not (Test-NookCodexWorkspaceIsolation $workspace)) { throw 'Scratch workspace has an unexpected project configuration layer.' }
  return [pscustomobject]@{ Root = $ScratchRoot; Home = $scratchCodexHome; Workspace = $workspace; HooksPath = (Join-Path $scratchCodexHome 'hooks.json') }
}

function Initialize-NookCodexOwnershipMarker {
  param([string]$ScratchRoot, [string]$UserSid, [switch]$RootWasCreated)
  $marker = Join-Path $ScratchRoot '.nook-codex-dev-owned'
  if ($RootWasCreated) {
    if (Test-Path -LiteralPath $marker) { throw 'New scratch root unexpectedly already contains a marker; refusing to claim it.' }
    Set-Content -LiteralPath $marker -Value "nook-codex-dev-v2`n$UserSid" -Encoding ASCII
    return
  }
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'Scratch path already exists without this launcher ownership marker; refusing to modify it.' }
  $markerText = (Get-Content -LiteralPath $marker -Raw).TrimEnd("`r", "`n")
  if (-not (Test-NookCodexOwnershipMarker $markerText $UserSid)) { throw 'Scratch ownership marker does not match this user; refusing to modify it.' }
}

function Initialize-NookCodexScratch {
  param([string]$ScratchRoot, [string]$ScratchParent, [string]$RelayPath, [string]$UserSid)
  $rootExisted = Test-Path -LiteralPath $ScratchRoot
  Initialize-NookCodexScratchRoot $ScratchRoot $ScratchParent $UserSid
  # Claim the newly ACL-protected directory before creating any contents. If the process stops before this write,
  # the next Prepare skips the unmarked directory and chooses another numbered scratch slot.
  Initialize-NookCodexOwnershipMarker $ScratchRoot $UserSid -RootWasCreated:(-not $rootExisted)
  return Initialize-NookCodexScratchContents $ScratchRoot $RelayPath $UserSid
}

function Invoke-NookCodexVersionCheck {
  param([string]$CommandPath)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 promotes native stderr records to terminating errors under Stop.
    # Codex 0.154.0 may warn about refusing temp-directory arg0 aliases while --version still succeeds.
    $ErrorActionPreference = 'Continue'
    $output = (& $CommandPath --version 2>&1 | Out-String -Width 4096).Trim()
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Test-NookCodexCliPath {
  param([string]$CommandPath, [string]$ExpectedNpmRoot)
  try { $command = [System.IO.Path]::GetFullPath($CommandPath); $root = [System.IO.Path]::GetFullPath($ExpectedNpmRoot) }
  catch { return $false }
  if (-not $command.StartsWith($root.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($command) -cne 'codex.cmd') { return $false }
  $wrapper = Get-Content -LiteralPath $command -Raw -ErrorAction SilentlyContinue
  return ($wrapper -match '(?i)node_modules[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js')
}

function Test-NookCodexAuthAvailable {
  param([string]$CodexHome)
  return (Test-Path -LiteralPath (Join-Path $CodexHome 'auth.json') -PathType Leaf)
}

function Get-NookCodexInheritedAuthOverrides {
  param([System.Collections.IDictionary]$Environment = [Environment]::GetEnvironmentVariables('Process'))
  $sensitiveNames = @('OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL')
  return @($sensitiveNames | Where-Object { $Environment.Contains($_) -and -not [string]::IsNullOrWhiteSpace([string]$Environment[$_]) })
}

function Invoke-NookCodexDevLifecycle {
  param([switch]$StartCodex, [switch]$InitializeOnly)
  $windowsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $bin = Join-Path $windowsRoot 'dev-release\bin'
  $relay = Join-Path $bin 'nook-hook-dev.exe'
  $builtRelay = Join-Path $windowsRoot 'target-nook-dev\release\nook-hook-dev.exe'
  $nookDev = Join-Path $bin 'nook-dev.exe'
  $builtApp = Join-Path $windowsRoot 'target-nook-dev\release\nook-dev.exe'
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $scriptPath = [System.IO.Path]::GetFullPath($PSCommandPath)
  $scriptHash = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash
  Write-Host "Scenario script: $scriptPath"
  Write-Host "Scenario SHA256: $scriptHash"
  Write-Host "Current Windows SID: $sid"

  if (-not (Test-NookCodexRelayPair $relay $builtRelay)) { throw "FAIL CLOSED: Dev relay missing or SHA-256 differs from the Dev build: $relay" }
  if (-not (Test-Path -LiteralPath $nookDev -PathType Leaf) -or [System.Diagnostics.FileVersionInfo]::GetVersionInfo($nookDev).ProductName -ne 'Nook Dev') { throw "FAIL CLOSED: expected the Nook Dev executable at $nookDev" }
  if (-not (Test-Path -LiteralPath $builtApp -PathType Leaf) -or (Get-FileHash $nookDev -Algorithm SHA256).Hash -cne (Get-FileHash $builtApp -Algorithm SHA256).Hash) { throw 'FAIL CLOSED: Nook Dev executable does not match the current Dev build.' }

  $devProcesses = @(Get-CimInstance Win32_Process -Filter "Name='nook-dev.exe'" -ErrorAction Stop)
  if ($devProcesses.Count -ne 1) { throw "FAIL CLOSED: expected exactly one nook-dev.exe; found $($devProcesses.Count). No process was started or stopped." }
  $devProcess = $devProcesses[0]
  $owner = Invoke-CimMethod -InputObject $devProcess -MethodName GetOwnerSid -ErrorAction Stop
  if ($owner.ReturnValue -ne 0 -or -not (Test-NookCodexProcessIdentity $devProcess.ExecutablePath $nookDev ([string]$owner.Sid) $sid)) { throw 'FAIL CLOSED: running Nook Dev path or owner SID does not exactly match this user and Dev build.' }

  $endpoint = ((& $relay --test-endpoint 2>$null) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not (Test-NookCodexPipeName $endpoint $sid)) { throw 'FAIL CLOSED: Dev relay did not report this user’s exact nook-dev IPC endpoint.' }
  $probe = Test-NookCodexNamedPipe $endpoint
  if (-not $probe.Available) { throw "FAIL CLOSED: exact Dev IPC endpoint is not available (Win32 error $($probe.Error))." }

  $npmRoot = Join-Path $env:APPDATA 'npm'
  $codexCommand = Join-Path $npmRoot 'codex.cmd'
  if (-not (Test-NookCodexCliPath $codexCommand $npmRoot)) { throw 'FAIL CLOSED: expected the official npm Codex CLI wrapper; PATH aliases and VS Code binaries are not accepted.' }
  $scratch = Get-NookCodexScratchPaths -UserSid $sid -ForLaunch:$StartCodex
  if ($InitializeOnly) {
    $scratchState = Initialize-NookCodexScratch $scratch.Root $scratch.Parent $relay $sid
  } elseif (-not (Test-Path -LiteralPath $scratch.Marker -PathType Leaf)) {
    throw 'FAIL CLOSED: isolated CODEX_HOME is not prepared. Run this script with -Prepare first; no user config or credentials are copied.'
  } else {
    $scratchState = Initialize-NookCodexScratch $scratch.Root $scratch.Parent $relay $sid
  }
  if (-not (Test-NookCodexHooksDocument (Get-Content -LiteralPath $scratchState.HooksPath -Raw) $relay)) { throw 'FAIL CLOSED: CODEX_HOME hooks are not exactly SessionStart and SessionEnd using the Dev relay.' }
  $managedReason = Get-NookCodexManagedHookBlockReason (Get-NookCodexManagedHookFindings)
  if ($managedReason) { throw "FAIL CLOSED: $managedReason" }

  $oldVersionHome = [Environment]::GetEnvironmentVariable('CODEX_HOME', 'Process')
  try {
    $env:CODEX_HOME = $scratchState.Home
    $versionCheck = Invoke-NookCodexVersionCheck $codexCommand
    $versionOutput = $versionCheck.Output
    $versionExit = $versionCheck.ExitCode
  } finally {
    if ($null -eq $oldVersionHome) { Remove-Item Env:\CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $oldVersionHome }
  }
  if ($versionExit -ne 0 -or $versionOutput -notmatch '(?m)^codex-cli 0\.154\.0\s*$') { throw 'FAIL CLOSED: installed Codex CLI is not exactly 0.154.0 or its version check failed.' }

  if ($InitializeOnly) {
    Write-Host "Prepared isolated CODEX_HOME: $($scratchState.Home)"
    Write-Host "Prepared scratch workspace: $($scratchState.Workspace)"
    Write-Host 'No credentials were copied. This isolated home requires a separate Codex authorization; use the Codex login flow only after the user chooses to authorize this scratch home.'
    Write-Host 'Lifecycle launch is currently blocked: Codex CLI 0.154.0 has no supported non-session command to prove cloud/enterprise managed hooks are absent. Do not start Codex from this scratch home until that policy state can be verified.'
    Write-Host 'No Codex session or authorization flow was started.'
    return
  }

  if (-not $StartCodex) { throw 'Use -Prepare to create an isolated test home, or -Launch for an explicit interactive lifecycle run.' }
  $cloudManagedBlock = Get-NookCodexCloudManagedHookBlockReason 'Unknown'
  if ($cloudManagedBlock) { throw "FAIL CLOSED: $cloudManagedBlock" }
  if (@(Get-NookCodexInheritedAuthOverrides).Count -gt 0) { throw 'FAIL CLOSED: a credential/provider environment override is present. Variable names were not logged; remove it from this PowerShell context or authorize a separate scratch account.' }
  if (-not (Test-NookCodexAuthAvailable $scratchState.Home)) { throw 'FAIL CLOSED: the isolated CODEX_HOME has no auth.json. Separate authorization is required; global credentials were not copied.' }
  $configPath = Join-Path $scratchState.Home 'config.toml'
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $configText = Get-Content -LiteralPath $configPath -Raw
    if (-not (Test-NookCodexConfigText $configText)) { throw 'FAIL CLOSED: isolated config.toml contains unsupported auth, inline hooks, or plugins.' }
  }
  foreach ($extraHookSource in @((Join-Path $scratchState.Home 'hooks'), (Join-Path $scratchState.Home 'plugins'))) {
    if (Test-Path -LiteralPath $extraHookSource) { throw 'FAIL CLOSED: isolated CODEX_HOME contains an additional hooks or plugins source.' }
  }
  Write-Host "Codex CLI: $codexCommand"
  Write-Host "Codex CLI verified: $($versionOutput -split "`r?`n" | Where-Object { $_ -match '^codex-cli ' } | Select-Object -First 1)"
  Write-Host 'For lifecycle observation: wait for SessionStart in Nook Dev, then enter /exit. Review hooks first with /hooks if prompted; untrusted hooks will not run.'
  $oldCodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME', 'Process')
  $oldLocation = Get-Location
  try {
    $env:CODEX_HOME = $scratchState.Home
    Set-Location -LiteralPath $scratchState.Workspace
    & $codexCommand --cd $scratchState.Workspace
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Codex CLI exited with code $exitCode." }
  } finally {
    Set-Location -LiteralPath $oldLocation
    if ($null -eq $oldCodexHome) { Remove-Item Env:\CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $oldCodexHome }
  }
}

function Test-NookCodexNamedPipe {
  param([string]$Name)
  if (-not ('NookCodexPipeProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class NookCodexPipeProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool WaitNamedPipe(string name, uint timeout);
}
'@
  }
  $available = [NookCodexPipeProbe]::WaitNamedPipe($Name, 0)
  return [pscustomobject]@{ Available = $available; Error = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    if ($Prepare -eq $Launch) { throw 'Choose exactly one mode: -Prepare or -Launch.' }
    Invoke-NookCodexDevLifecycle -InitializeOnly:$Prepare -StartCodex:$Launch
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}

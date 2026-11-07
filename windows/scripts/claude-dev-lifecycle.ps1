[CmdletBinding()]
param(
  [switch]$Prepare,
  [switch]$Launch,
  [string]$ScratchRoot
)

$ErrorActionPreference = 'Stop'

function Test-NookDevRelayPair {
  param([string]$RelayPath, [string]$BuiltRelayPath)
  if (-not [System.IO.Path]::IsPathRooted($RelayPath) -or -not (Test-Path -LiteralPath $RelayPath -PathType Leaf)) { return $false }
  if (-not [System.IO.Path]::IsPathRooted($BuiltRelayPath) -or -not (Test-Path -LiteralPath $BuiltRelayPath -PathType Leaf)) { return $false }
  return (Get-FileHash -LiteralPath $RelayPath -Algorithm SHA256).Hash -ceq (Get-FileHash -LiteralPath $BuiltRelayPath -Algorithm SHA256).Hash
}

function Test-NookDevPipeName {
  param([string]$Endpoint, [string]$UserSid)
  return $Endpoint -ceq "\\.\pipe\nook-dev-$UserSid"
}

function Get-NookDevPipeState {
  param([string[]]$PipeNames, [string]$PipeLeaf, [bool]$WaitSucceeded, [int]$Win32Error)
  if ($WaitSucceeded) { return 'Available' }
  if ($Win32Error -eq 5) { return 'Inaccessible' }
  if ($Win32Error -eq 121 -or $Win32Error -eq 231) { return 'Busy' }
  if (@($PipeNames | Where-Object { $_ -like 'nook-dev-*' }).Count -gt 0) { return 'OtherSidOnly' }
  if ($Win32Error -eq 2) { return 'Missing' }
  return 'Unknown'
}

function Get-NookDevProcessState {
  param([int]$ProcessCount, [int]$ReadablePathCount, [int]$CurrentBuildCount)
  if ($ProcessCount -eq 0) { return 'NotRunning' }
  if ($ReadablePathCount -eq 0) { return 'Unverifiable' }
  if ($CurrentBuildCount -eq 0) { return 'OtherOrStaleBuild' }
  if ($CurrentBuildCount -gt 1 -or $ProcessCount -ne 1) { return 'Multiple' }
  return 'CurrentBuild'
}

function Get-NookClaudeManagedDocumentState {
  param([string]$Json)
  try { $document = $Json | ConvertFrom-Json } catch { return 'Unreadable' }
  if ($null -ne $document.policyHelper) { return 'DynamicPolicy' }
  if ($null -ne $document.hooks -and @($document.hooks.PSObject.Properties | Where-Object { @($_.Value).Count -gt 0 }).Count -gt 0) { return 'HooksPresent' }
  if ($null -ne $document.enabledPlugins -and @($document.enabledPlugins.PSObject.Properties | Where-Object { $_.Value -ne $false }).Count -gt 0) { return 'PluginsPresent' }
  return 'NoHooks'
}

function Get-NookClaudeLocalManagedHookFindings {
  param([string]$ProgramFilesRoot = $env:ProgramFiles)
  $findings = @()
  foreach ($key in @('HKLM:\SOFTWARE\Policies\ClaudeCode', 'HKCU:\SOFTWARE\Policies\ClaudeCode')) {
    try {
      $value = Get-ItemProperty -LiteralPath $key -Name Settings -ErrorAction Stop
      if ($null -ne $value.Settings) { $findings += [pscustomobject]@{ Source = $key; State = Get-NookClaudeManagedDocumentState ([string]$value.Settings) } }
    } catch [System.Management.Automation.ItemNotFoundException] { }
      catch [System.Management.Automation.PSArgumentException] { }
      catch { if (Test-Path -LiteralPath $key) { $findings += [pscustomobject]@{ Source = $key; State = 'Unreadable' } } }
  }

  $managedRoot = Join-Path $ProgramFilesRoot 'ClaudeCode'
  $files = @((Join-Path $managedRoot 'managed-settings.json'))
  $fragmentDir = Join-Path $managedRoot 'managed-settings.d'
  if (Test-Path -LiteralPath $fragmentDir -PathType Container) {
    $files += @(Get-ChildItem -LiteralPath $fragmentDir -Filter '*.json' -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  }
  foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    try { $json = Get-Content -LiteralPath $file -Raw -ErrorAction Stop; $state = Get-NookClaudeManagedDocumentState $json }
    catch { $state = 'Unreadable' }
    $findings += [pscustomobject]@{ Source = $file; State = $state }
  }
  return $findings
}

function Test-NookClaudeHookSettings {
  param([string]$SettingsPath, [string]$RelayPath)
  try { $settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json } catch { return $false }
  if ($null -eq $settings.hooks) { return $false }
  $events = @($settings.hooks.PSObject.Properties.Name | Sort-Object)
  if (($events -join ',') -cne 'PermissionRequest,PostToolUse,PreToolUse,SessionEnd,SessionStart,Stop,UserPromptSubmit') { return $false }
  $expectedMatchers = @{ PreToolUse = 'Read|Bash'; PostToolUse = 'Read'; PermissionRequest = 'Bash' }
  foreach ($event in @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd')) {
    $entries = @($settings.hooks.$event)
    if ($entries.Count -ne 1 -or @($entries[0].hooks).Count -ne 1) { return $false }
    $hook = $entries[0].hooks[0]
    if ($hook.type -cne 'command' -or $hook.command -cne $RelayPath -or @($hook.args).Count -ne 1 -or $hook.args[0] -cne $event) { return $false }
    $expectedTimeout = if ($event -eq 'PermissionRequest') { 120 } else { 10 }
    if ($hook.timeout -ne $expectedTimeout) { return $false }
    if ($expectedMatchers.ContainsKey($event)) {
      if ($entries[0].matcher -cne $expectedMatchers[$event]) { return $false }
    } elseif ($null -ne $entries[0].matcher) { return $false }
  }
  $serialized = $settings | ConvertTo-Json -Depth 30 -Compress
  if ($serialized -match '(?i)(?<!dev-)nook-hook\.exe') { return $false }
  return $true
}

function Get-NookClaudeDoctorManagedStatus {
  param([string]$DoctorOutput)
  if ([string]::IsNullOrWhiteSpace($DoctorOutput)) { return 'Unknown' }
  $normalized = $DoctorOutput -replace '[\u2010-\u2015\u2212]', '-'
  $lines = @($normalized -split "`r?`n" | ForEach-Object { $_.Trim() })
  $remote = @($lines | Where-Object { $_ -like 'Managed settings (remote):*' })
  $policy = @($lines | Where-Object { $_ -like 'Organization policy:*' })
  if ($remote.Count -ne 1 -or $policy.Count -ne 1) { return 'Unknown' }
  if ($remote[0] -ceq 'Managed settings (remote): not fetched - requires an Enterprise or Team subscription' -and
      $policy[0] -ceq 'Organization policy: not applicable to Pro and Max accounts') { return 'NotApplicable' }
  if ($remote[0] -match '(?i)fetched|enterprise|team' -or $policy[0] -match '(?i)applicable|enterprise|team') { return 'EnterpriseOrTeamOrChanged' }
  return 'Unknown'
}

function Get-NookClaudeExcludedUserAuthOverrides {
  param([string]$ConfigDirectory)
  $settingsPath = Join-Path $ConfigDirectory 'settings.json'
  if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { return @() }
  try { $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json } catch { return @('UnreadableUserSettings') }
  $overrides = @()
  if ($null -ne $settings.apiKeyHelper) { $overrides += 'apiKeyHelper' }
  if ($null -ne $settings.env) {
    if (@($settings.env.PSObject.Properties).Count -gt 0) { $overrides += 'UserEnvironmentOverrides' }
  }
  return $overrides
}

function Get-NookClaudeAuthEnvironmentOverrides {
  $names = @(
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_WEB_IDENTITY_TOKEN_FILE',
    'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID'
  )
  return @($names | Where-Object { -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, 'Process')) })
}

function Get-NookClaudeCliIdentity {
  $shim = Get-Command claude.cmd -ErrorAction Stop
  $shimPath = [System.IO.Path]::GetFullPath($shim.Source)
  $packageRoot = Join-Path (Split-Path $shimPath -Parent) 'node_modules\@anthropic-ai\claude-code'
  $packageJson = Join-Path $packageRoot 'package.json'
  $binary = Join-Path $packageRoot 'bin\claude.exe'
  if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf) -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw "FAIL CLOSED: could not resolve the installed Claude CLI package and executable from $shimPath."
  }
  try { $package = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json } catch { throw 'FAIL CLOSED: installed Claude package metadata is unreadable.' }
  if ($package.name -cne '@anthropic-ai/claude-code' -or [string]::IsNullOrWhiteSpace([string]$package.version)) {
    throw 'FAIL CLOSED: resolved Claude package identity is not verifiable.'
  }
  return [pscustomobject]@{ Binary = [System.IO.Path]::GetFullPath($binary); Version = [string]$package.version; Shim = $shimPath }
}

function Test-NookClaudeScratchWorkspace {
  param([string]$Root, [string]$RelayPath)
  try { $rootPath = [System.IO.Path]::GetFullPath($Root) } catch { return $false }
  if (-not [System.IO.Path]::IsPathRooted($Root) -or -not (Test-Path -LiteralPath $rootPath -PathType Container)) { return $false }
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\') + '\'
  if ($rootPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
  $rootItem = Get-Item -LiteralPath $rootPath -Force
  if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  $workspace = Join-Path $rootPath 'workspace'
  $profile = Join-Path $rootPath 'claude-profile'
  $settingsPath = Join-Path $workspace '.claude\settings.json'
  $fixturePath = Join-Path $workspace 'nook-hook-fixture.txt'
  if (-not (Test-Path -LiteralPath $workspace -PathType Container) -or -not (Test-Path -LiteralPath $profile -PathType Container)) { return $false }
  if (-not (Test-NookClaudeHookSettings $settingsPath $RelayPath) -or -not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) { return $false }
  if (Test-Path -LiteralPath (Join-Path $workspace '.claude\settings.local.json')) { return $false }
  $allowedWorkspaceItems = @('.claude', 'nook-hook-fixture.txt')
  $actualWorkspaceItems = @(Get-ChildItem -LiteralPath $workspace -Force | Select-Object -ExpandProperty Name)
  if ((@($actualWorkspaceItems | Sort-Object) -join '|') -cne (@($allowedWorkspaceItems | Sort-Object) -join '|')) { return $false }
  $claudeItems = @(Get-ChildItem -LiteralPath (Join-Path $workspace '.claude') -Force | Select-Object -ExpandProperty Name)
  if (($claudeItems -join '|') -cne 'settings.json') { return $false }
  $profileSettings = Join-Path $profile 'settings.json'
  if (Test-Path -LiteralPath $profileSettings -PathType Leaf) {
    try { $profileDocument = Get-Content -LiteralPath $profileSettings -Raw | ConvertFrom-Json } catch { return $false }
    if (@($profileDocument.PSObject.Properties).Count -gt 0) { return $false }
  }
  $blockedProfileLayers = @('plugins', 'hooks', 'skills', 'agents', 'commands', 'rules', 'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', 'mcpServers.json')
  foreach ($name in $blockedProfileLayers) {
    if (Test-Path -LiteralPath (Join-Path $profile $name)) { return $false }
  }
  foreach ($item in Get-ChildItem -LiteralPath $rootPath -Force -Recurse) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  }
  return $true
}

function Format-NookPowerShellLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Test-NookClaudeDoctorIdentity {
  param([string]$DoctorOutput, [string]$ExpectedVersion, [string]$ExpectedBinaryPath)
  if ([string]::IsNullOrWhiteSpace($DoctorOutput)) { return $false }
  $lines = @($DoctorOutput -split "`r?`n" | ForEach-Object { $_.Trim() })
  $headings = @($lines | Where-Object { $_ -ceq 'Claude Code doctor' })
  $running = @($lines | Where-Object { $_ -like 'Running:*' })
  $paths = @($lines | Where-Object { $_ -like 'Path:*' })
  $healthy = @($lines | Where-Object { $_ -ceq 'No installation issues found.' })
  if ($headings.Count -ne 1 -or $running.Count -ne 1 -or $paths.Count -ne 1 -or $healthy.Count -ne 1) { return $false }
  if ($running[0] -notmatch ('\(' + [regex]::Escape($ExpectedVersion) + '\)$')) { return $false }
  $reportedPath = $paths[0].Substring('Path:'.Length).Trim()
  try { return [System.IO.Path]::GetFullPath($reportedPath) -ieq [System.IO.Path]::GetFullPath($ExpectedBinaryPath) } catch { return $false }
}

function Test-NookClaudeContextSnapshot {
  param(
    [string]$OriginalSid,
    [AllowNull()][string]$OriginalConfigDir,
    [string]$OriginalCommand,
    [string]$CurrentSid,
    [AllowNull()][string]$CurrentConfigDir,
    [string]$CurrentCommand
  )
  return ($OriginalSid -ceq $CurrentSid -and
    [string]::Equals($OriginalConfigDir, $CurrentConfigDir, [System.StringComparison]::Ordinal) -and
    [System.IO.Path]::GetFullPath($OriginalCommand) -ieq [System.IO.Path]::GetFullPath($CurrentCommand))
}

function Get-NookClaudeManagedHooksBlockReason {
  param([object[]]$Findings = @(), [string]$RemoteStatus = 'Unknown')
  $states = @($Findings | ForEach-Object State)
  if ($states -contains 'HooksPresent') { return 'Managed hooks are present in a local policy source; refusing to launch.' }
  if ($states -contains 'PluginsPresent') { return 'A local managed source enables plugins that may contribute hooks; refusing to launch.' }
  if ($states -contains 'DynamicPolicy' -or $states -contains 'Unreadable') { return 'A local managed source is dynamic or unreadable, so its effective hooks are unknown; refusing to launch.' }
  if ($RemoteStatus -eq 'EnterpriseOrTeamOrChanged') { return 'Claude doctor reports remote managed settings or an Enterprise/Team policy; refusing to launch.' }
  if ($RemoteStatus -ne 'NotApplicable') { return 'Claude doctor did not provide the exact approved Pro/Max remote-settings status; refusing to launch.' }
  return $null
}

function Get-NookClaudeHookDefinitions {
  return @(
    [pscustomobject]@{ Event = 'SessionStart'; Matcher = $null; Timeout = 10 },
    [pscustomobject]@{ Event = 'UserPromptSubmit'; Matcher = $null; Timeout = 10 },
    [pscustomobject]@{ Event = 'PreToolUse'; Matcher = 'Read|Bash'; Timeout = 10 },
    [pscustomobject]@{ Event = 'PostToolUse'; Matcher = 'Read'; Timeout = 10 },
    [pscustomobject]@{ Event = 'PermissionRequest'; Matcher = 'Bash'; Timeout = 120 },
    [pscustomobject]@{ Event = 'Stop'; Matcher = $null; Timeout = 10 },
    [pscustomobject]@{ Event = 'SessionEnd'; Matcher = $null; Timeout = 10 }
  )
}

function Protect-NookClaudeScratchRoot {
  param([string]$Root)
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $identity) { throw 'FAIL CLOSED: current Windows SID is unavailable; cannot protect the isolated Claude profile.' }
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $security.SetAccessRuleProtection($true, $false)
  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, $propagation, $allow)))
  $system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'FullControl', $inherit, $propagation, $allow)))
  Set-Acl -LiteralPath $Root -AclObject $security -ErrorAction Stop
}

function New-NookClaudeScratchWorkspace {
  param([string]$RelayPath, [string]$ScratchParent = [System.IO.Path]::GetTempPath())
  if (-not [System.IO.Path]::IsPathRooted($RelayPath) -or [System.IO.Path]::GetFileName($RelayPath) -cne 'nook-hook-dev.exe') {
    throw 'Refusing scratch hooks unless the relay is an absolute nook-hook-dev.exe path.'
  }
  $root = Join-Path $ScratchParent ('nook-claude-dev-' + [Guid]::NewGuid().ToString('N'))
  $workspace = Join-Path $root 'workspace'
  $profile = Join-Path $root 'claude-profile'
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $fullRoot = [System.IO.Path]::GetFullPath($root)
  if ($fullRoot.StartsWith($repoRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Scratch workspace must be outside the repository.'
  }
  $settingsDir = Join-Path $workspace '.claude'
  [void][System.IO.Directory]::CreateDirectory($root)
  Protect-NookClaudeScratchRoot $root
  [void][System.IO.Directory]::CreateDirectory($settingsDir)
  [void][System.IO.Directory]::CreateDirectory($profile)
  $settingsPath = Join-Path $settingsDir 'settings.json'
  $settings = @{ hooks = @{} }
  foreach ($definition in Get-NookClaudeHookDefinitions) {
    $entry = @{ hooks = @(@{ type = 'command'; command = $RelayPath; args = @($definition.Event); timeout = $definition.Timeout }) }
    if ($definition.Matcher) { $entry.matcher = $definition.Matcher }
    $settings.hooks[$definition.Event] = @($entry)
  }
  $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $workspace 'nook-hook-fixture.txt') -Value 'Nook Dev Claude hook fixture. Read-only test data.' -Encoding UTF8
  if (-not (Test-NookClaudeHookSettings $settingsPath $RelayPath)) { throw 'Scratch settings failed Dev-only hook validation; refusing to launch.' }
  return [pscustomobject]@{ Root = $root; Workspace = $workspace; Profile = $profile; SettingsPath = $settingsPath; FixturePath = (Join-Path $workspace 'nook-hook-fixture.txt') }
}

function Invoke-NookClaudeDevLifecycle {
  param([switch]$Prepare, [switch]$StartClaude, [string]$ScratchRoot)
  if ($Prepare -eq $StartClaude) { throw 'Choose exactly one action: -Prepare or -Launch.' }
  if ($Prepare -and -not [string]::IsNullOrWhiteSpace($ScratchRoot)) { throw '-ScratchRoot is only used with -Launch.' }
  if ($StartClaude -and [string]::IsNullOrWhiteSpace($ScratchRoot)) { throw 'FAIL CLOSED: pass the scratch path created by -Prepare using -ScratchRoot.' }
  $windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $bin = Join-Path $windowsRoot 'dev-release\bin'
  $relay = Join-Path $bin 'nook-hook-dev.exe'
  $builtRelay = Join-Path $windowsRoot 'target-nook-dev\release\nook-hook-dev.exe'
  $nookDev = Join-Path $bin 'nook-dev.exe'

  if (-not (Test-NookDevRelayPair $relay $builtRelay)) { throw "FAIL CLOSED: Dev relay missing or does not byte-match the Dev build output: $relay" }
  $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($nookDev)
  if (-not (Test-Path -LiteralPath $nookDev -PathType Leaf) -or $version.ProductName -ne 'Nook Dev') { throw "FAIL CLOSED: expected the Nook Dev executable at $nookDev" }

  $endpointOutput = & $relay --test-endpoint 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'FAIL CLOSED: Dev relay did not report its isolated IPC endpoint.' }
  $endpoint = ([string]$endpointOutput).Trim()
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not (Test-NookDevPipeName $endpoint $sid)) { throw 'FAIL CLOSED: relay endpoint is not the exact current-user Nook Dev pipe.' }
  $pipeLeaf = $endpoint.Substring($endpoint.LastIndexOf('\') + 1)
  $pipeNames = @(Get-ChildItem '\\.\pipe\' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  $probe = Test-NookNamedPipe $endpoint
  $pipeState = Get-NookDevPipeState $pipeNames $pipeLeaf $probe.Available $probe.Error
  $allRunningDev = @(Get-Process -Name nook-dev -ErrorAction SilentlyContinue)
  $builtApp = Join-Path $windowsRoot 'target-nook-dev\release\nook-dev.exe'
  $builtHash = (Get-FileHash -LiteralPath $builtApp -Algorithm SHA256).Hash
  $pathReadable = @($allRunningDev | Where-Object Path)
  $runningDev = @($allRunningDev | Where-Object {
    $_.Path -and (Test-Path -LiteralPath $_.Path -PathType Leaf) -and
      (Get-FileHash -LiteralPath $_.Path -Algorithm SHA256).Hash -ceq $builtHash
  })
  $processState = Get-NookDevProcessState $allRunningDev.Count $pathReadable.Count $runningDev.Count
  if ($processState -eq 'NotRunning') { throw 'FAIL CLOSED: Nook Dev is not running.' }
  if ($processState -eq 'Unverifiable') { throw 'FAIL CLOSED: nook-dev.exe is running, but its executable path cannot be read; refusing to infer which build it is.' }
  if ($processState -eq 'OtherOrStaleBuild') { throw 'FAIL CLOSED: nook-dev.exe is running, but it does not match the current Dev build.' }
  if ($processState -eq 'Multiple') { throw "FAIL CLOSED: found $($allRunningDev.Count) nook-dev.exe processes or multiple current-build matches; refusing to choose one." }
  if ($pipeState -eq 'OtherSidOnly') { throw 'FAIL CLOSED: Nook Dev is running from the expected image, but only a nook-dev pipe for another SID exists. The current user has no Dev IPC listener; no process was started or stopped.' }
  if ($pipeState -eq 'Missing') { throw "FAIL CLOSED: Nook Dev is running, but its exact current-user IPC pipe is absent ($endpoint). Check the Dev app startup log; no process was started or stopped." }
  if ($pipeState -eq 'Inaccessible') { throw "FAIL CLOSED: the exact Dev IPC pipe exists but cannot be opened by this user ($endpoint)." }
  if ($pipeState -eq 'Busy') { throw "FAIL CLOSED: the exact Dev IPC pipe exists, but no instance became available during the non-connecting probe ($endpoint)." }
  if ($pipeState -ne 'Available') { throw "FAIL CLOSED: Dev IPC availability is indeterminate (Win32 error $($probe.Error))." }

  $cli = Get-NookClaudeCliIdentity
  $identitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $help = (& $cli.Binary --help 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $help -notmatch '--setting-sources\s+<sources>' -or $help -notmatch '--strict-mcp-config' -or $help -notmatch '--tools\s+<tools') { throw 'FAIL CLOSED: installed Claude CLI does not expose the verified project-only settings, strict MCP, and tool allowlist contracts.' }
  $authHelp = (& $cli.Binary auth login --help 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $authHelp -notmatch 'Sign in to your Anthropic account') { throw 'FAIL CLOSED: installed CLI does not expose the verified standalone auth login command.' }
  $versionOutput = (& $cli.Binary --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch ('^' + [regex]::Escape($cli.Version) + '(?:\s|$)')) { throw 'FAIL CLOSED: Claude CLI package version does not match the direct executable version.' }

  $managedFindings = @(Get-NookClaudeLocalManagedHookFindings)
  $localBlock = Get-NookClaudeManagedHooksBlockReason $managedFindings 'NotApplicable'
  if ($localBlock -and $managedFindings.Count -gt 0) { throw "FAIL CLOSED: $localBlock" }
  if ($managedFindings.Count -gt 0 -and ($managedFindings | Where-Object State -ne 'NoHooks')) { throw 'FAIL CLOSED: a local managed source is present but could not be positively verified as hook-free.' }
  $authEnvironment = @(Get-NookClaudeAuthEnvironmentOverrides)
  if ($authEnvironment.Count -gt 0) { throw ('FAIL CLOSED: authentication/provider environment overrides are present (' + ($authEnvironment -join ', ') + '); values were not read or logged. Start a clean PowerShell process for this isolated profile.') }

  if ($Prepare) {
    $scratch = New-NookClaudeScratchWorkspace $relay
    if (-not (Test-NookClaudeScratchWorkspace $scratch.Root $relay)) { throw 'FAIL CLOSED: generated scratch workspace/profile failed its isolation checks.' }
    Write-Host "Prepared isolated scratch root: $($scratch.Root)"
    Write-Host 'No Claude session was started and no credentials were copied.'
    Write-Host 'Step 1 — authenticate only this new profile (standalone login; no agent prompt):'
    Write-Host ('$oldClaudeConfigDir = $env:CLAUDE_CONFIG_DIR; try { $env:CLAUDE_CONFIG_DIR = ' + (Format-NookPowerShellLiteral $scratch.Profile) + '; & ' + (Format-NookPowerShellLiteral $cli.Binary) + ' auth login } finally { $env:CLAUDE_CONFIG_DIR = $oldClaudeConfigDir }')
    Write-Host 'Step 2 — after login succeeds, run the lifecycle test from this same PowerShell account:'
    Write-Host ('& ' + (Format-NookPowerShellLiteral $PSCommandPath) + ' -Launch -ScratchRoot ' + (Format-NookPowerShellLiteral $scratch.Root))
    Write-Host 'The profile remains in the system temp directory so its separately-created login can be reused.'
    return
  }

  $rootPath = [System.IO.Path]::GetFullPath($ScratchRoot)
  $relayFullPath = [System.IO.Path]::GetFullPath($relay)
  if (-not (Test-NookClaudeScratchWorkspace $rootPath $relayFullPath)) { throw 'FAIL CLOSED: scratch files changed, contain extra configuration, or are not the expected isolated workspace/profile.' }
  $profile = Join-Path $rootPath 'claude-profile'
  $profileAuthOverrides = @(Get-NookClaudeExcludedUserAuthOverrides $profile)
  if ($profileAuthOverrides.Count -gt 0) { throw 'FAIL CLOSED: isolated profile contains user auth/provider overrides in settings; no values were logged.' }

  $oldConfigDir = [Environment]::GetEnvironmentVariable('CLAUDE_CONFIG_DIR', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('CLAUDE_CONFIG_DIR', $profile, 'Process')
    $profileConfig = [Environment]::GetEnvironmentVariable('CLAUDE_CONFIG_DIR', 'Process')
    $doctorOutput = (& $cli.Binary doctor 2>&1 | Out-String)
    $doctorExit = $LASTEXITCODE
    if ($doctorExit -ne 0) { throw "FAIL CLOSED: claude doctor exited with code $doctorExit in the isolated profile; authenticate that profile separately and retry." }
    if (-not (Test-NookClaudeDoctorIdentity $doctorOutput $cli.Version $cli.Binary)) { throw 'FAIL CLOSED: claude doctor output does not prove it inspected the resolved Claude CLI executable and version.' }
    $remoteStatus = Get-NookClaudeDoctorManagedStatus $doctorOutput
    $managedBlock = Get-NookClaudeManagedHooksBlockReason $managedFindings $remoteStatus
    if ($managedBlock) { throw "FAIL CLOSED: $managedBlock" }

    $currentCli = Get-NookClaudeCliIdentity
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $currentConfigDir = [Environment]::GetEnvironmentVariable('CLAUDE_CONFIG_DIR', 'Process')
    if (-not (Test-NookClaudeContextSnapshot $identitySid $profileConfig $cli.Binary $currentSid $currentConfigDir $currentCli.Binary)) {
      throw 'FAIL CLOSED: Claude CLI, Windows identity, or isolated profile changed after doctor; refusing to launch.'
    }

    Write-Host "Claude CLI: $($cli.Version) (resolved direct executable)"
    Write-Host 'Settings sources: project only; user/local sources excluded; managed sources checked by doctor and local policy scan.'
    Write-Host 'Permission mode: default (interactive approval; no bypass flags).'
    Write-Host "Scratch workspace: $(Join-Path $rootPath 'workspace')"
    Write-Host 'Manual test: read nook-hook-fixture.txt, then request only `powershell.exe -NoLogo -NoProfile -Command "Write-Output NOOK_DEV_PERMISSION_PROBE"`; click Deny if Nook presents that exact request.'
    Write-Host 'This command only prints a fixed marker. If it runs without a Nook card, record that PermissionRequest was not exercised and do not try a different command.'
    Write-Host 'Do not approve any tool call during this test. Then wait for the turn to stop and enter /exit.'
    Push-Location (Join-Path $rootPath 'workspace')
    try {
      & $cli.Binary --setting-sources project --strict-mcp-config --tools Read,Bash --permission-mode default
      $exitCode = $LASTEXITCODE
      if ($exitCode -ne 0) { throw "Claude CLI exited with code $exitCode." }
    } finally {
      Pop-Location
    }
  } finally {
    [Environment]::SetEnvironmentVariable('CLAUDE_CONFIG_DIR', $oldConfigDir, 'Process')
  }
}

function Test-NookNamedPipe {
  param([string]$Name)
  if (-not ('NookDevPipeProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class NookDevPipeProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool WaitNamedPipe(string name, uint timeout);
}
'@
  }
  $available = [NookDevPipeProbe]::WaitNamedPipe($Name, 0)
  return [pscustomobject]@{ Available = $available; Error = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    if ($Prepare -eq $Launch) { throw 'Use exactly one action: -Prepare (no Claude session) or -Launch -ScratchRoot <path> (manual interactive E2E).' }
    Invoke-NookClaudeDevLifecycle -Prepare:$Prepare -StartClaude:$Launch -ScratchRoot $ScratchRoot
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}

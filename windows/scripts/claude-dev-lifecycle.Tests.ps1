. (Join-Path $PSScriptRoot 'claude-dev-lifecycle.ps1')

Describe 'Nook Dev Claude lifecycle preflight' {
  It 'accepts only a relay identical to the built Dev relay' {
    $fileA = Join-Path $TestDrive 'nook-hook-dev.exe'
    $fileB = Join-Path $TestDrive 'built-nook-hook-dev.exe'
    [System.IO.File]::WriteAllText($fileA, 'dev-relay')
    [System.IO.File]::WriteAllText($fileB, 'dev-relay')
    Test-NookDevRelayPair $fileA $fileB | Should Be $true
    [System.IO.File]::WriteAllText($fileB, 'production-relay')
    Test-NookDevRelayPair $fileA $fileB | Should Be $false
  }

  It 'refuses when either the packaged or built Dev relay is missing' {
    $file = Join-Path $TestDrive 'present-relay.exe'
    [System.IO.File]::WriteAllText($file, 'dev-relay')
    Test-NookDevRelayPair (Join-Path $TestDrive 'missing.exe') $file | Should Be $false
    Test-NookDevRelayPair $file (Join-Path $TestDrive 'missing-built.exe') | Should Be $false
  }

  It 'accepts only the exact current-user Dev IPC endpoint' {
    Test-NookDevPipeName '\\.\pipe\nook-dev-S-1-5-21-test' 'S-1-5-21-test' | Should Be $true
    Test-NookDevPipeName '\\.\pipe\nook-S-1-5-21-test' 'S-1-5-21-test' | Should Be $false
    Test-NookDevPipeName '\\.\pipe\nook-dev-S-1-5-21-other' 'S-1-5-21-test' | Should Be $false
  }

  It 'distinguishes missing, other-SID, inaccessible, and available Dev IPC' {
    (Get-NookDevPipeState @() 'nook-dev-current' $false 2) | Should Be 'Missing'
    (Get-NookDevPipeState @() 'nook-dev-current' $false 5) | Should Be 'Inaccessible'
    (Get-NookDevPipeState @('nook-dev-current') 'nook-dev-current' $false 121) | Should Be 'Busy'
    (Get-NookDevPipeState @('nook-dev-other') 'nook-dev-current' $false 2) | Should Be 'OtherSidOnly'
    (Get-NookDevPipeState @('nook-dev-other') 'nook-dev-current' $false 5) | Should Be 'Inaccessible'
    (Get-NookDevPipeState @('nook-dev-current') 'nook-dev-current' $true 0) | Should Be 'Available'
  }

  It 'distinguishes stopped, current, unreadable, and stale Dev processes' {
    (Get-NookDevProcessState 0 0 0) | Should Be 'NotRunning'
    (Get-NookDevProcessState 1 0 0) | Should Be 'Unverifiable'
    (Get-NookDevProcessState 1 1 0) | Should Be 'OtherOrStaleBuild'
    (Get-NookDevProcessState 1 1 1) | Should Be 'CurrentBuild'
    (Get-NookDevProcessState 2 2 1) | Should Be 'Multiple'
  }

  It 'distinguishes actual managed hooks from an empty managed policy' {
    (Get-NookClaudeManagedDocumentState '{"permissions":{"deny":[]}}') | Should Be 'NoHooks'
    (Get-NookClaudeManagedDocumentState '{"hooks":{"SessionStart":[{}]}}') | Should Be 'HooksPresent'
    (Get-NookClaudeManagedDocumentState '{"policyHelper":{"command":"policy.exe"}}') | Should Be 'DynamicPolicy'
    (Get-NookClaudeManagedDocumentState '{"enabledPlugins":{"some-plugin":true}}') | Should Be 'PluginsPresent'
  }

  It 'allows only the exact Pro/Max remote-settings doctor result' {
    $dash = [char]0x2014
    $doctor = @'
Claude Code doctor
Running: npm-global (2.1.314)
Path: C:\Users\TestUser\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
Managed settings (remote): not fetched requires an Enterprise or Team subscription
Organization policy: not applicable to Pro and Max accounts
'@
    $doctor = $doctor.Replace('not fetched requires', "not fetched $dash requires")
    (Get-NookClaudeDoctorManagedStatus $doctor) | Should Be 'NotApplicable'
    (Get-NookClaudeManagedHooksBlockReason @() (Get-NookClaudeDoctorManagedStatus $doctor)) | Should Be $null
  }

  It 'blocks Enterprise/Team, fetched remote settings, and unknown doctor output' {
    $enterprise = "Managed settings (remote): fetched`nOrganization policy: applicable to Enterprise accounts"
    $team = "Managed settings (remote): fetched`nOrganization policy: applicable to Team accounts"
    $unknown = "Managed settings (remote): status unavailable`nOrganization policy: status unavailable"
    (Get-NookClaudeDoctorManagedStatus $enterprise) | Should Be 'EnterpriseOrTeamOrChanged'
    (Get-NookClaudeDoctorManagedStatus $team) | Should Be 'EnterpriseOrTeamOrChanged'
    (Get-NookClaudeDoctorManagedStatus $unknown) | Should Be 'Unknown'
    (Get-NookClaudeManagedHooksBlockReason @() 'Unknown') | Should Match 'refusing to launch'
  }

  It 'blocks local managed hooks even when doctor reports remote settings are inapplicable' {
    $findings = @([pscustomobject]@{ State = 'HooksPresent' })
    (Get-NookClaudeManagedHooksBlockReason $findings 'NotApplicable') | Should Match 'Managed hooks are present'
  }

  It 'requires doctor identity and launch to share CLI, SID, and config directory' {
    $path = 'C:\Claude\bin\claude.exe'
    $doctor = "Claude Code doctor`nRunning: npm-global (2.1.314)`nPath: $path`nNo installation issues found."
    Test-NookClaudeDoctorIdentity $doctor '2.1.314' $path | Should Be $true
    Test-NookClaudeDoctorIdentity $doctor '2.1.315' $path | Should Be $false
    Test-NookClaudeDoctorIdentity $doctor.Replace('No installation issues found.', 'Doctor output changed') '2.1.314' $path | Should Be $false
    Test-NookClaudeContextSnapshot 'sid-a' 'config-a' 'C:\Claude\claude.cmd' 'sid-a' 'config-a' 'C:\Claude\claude.cmd' | Should Be $true
    Test-NookClaudeContextSnapshot 'sid-a' 'config-a' 'C:\Claude\claude.cmd' 'sid-a' 'config-b' 'C:\Claude\claude.cmd' | Should Be $false
    Test-NookClaudeContextSnapshot 'sid-a' $null 'C:\Claude\claude.cmd' 'sid-b' $null 'C:\Claude\claude.cmd' | Should Be $false
  }

  It 'blocks user auth/provider settings that project-only sources would exclude' {
    $configDir = Join-Path $TestDrive 'claude-config'
    [System.IO.Directory]::CreateDirectory($configDir) | Out-Null
    $settingsPath = Join-Path $configDir 'settings.json'
    @{ apiKeyHelper = 'hidden'; env = @{ ANTHROPIC_BASE_URL = 'hidden'; THEME = 'dark' } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $settingsPath
    $found = @(Get-NookClaudeExcludedUserAuthOverrides $configDir)
    ($found -contains 'apiKeyHelper') | Should Be $true
    ($found -contains 'UserEnvironmentOverrides') | Should Be $true
    ($found -contains 'ANTHROPIC_BASE_URL') | Should Be $false
    [System.IO.File]::WriteAllText($settingsPath, '{invalid')
    (Get-NookClaudeExcludedUserAuthOverrides $configDir) | Should Be 'UnreadableUserSettings'
  }

  It 'creates only the reviewed seven Dev hooks and a harmless fixture in an isolated profile' {
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $scratch = New-NookClaudeScratchWorkspace $relay $TestDrive
    Test-NookClaudeHookSettings $scratch.SettingsPath $relay | Should Be $true
    Test-NookClaudeScratchWorkspace $scratch.Root $relay | Should Be $true
    $settings = Get-Content -LiteralPath $scratch.SettingsPath -Raw | ConvertFrom-Json
    @($settings.hooks.PSObject.Properties.Name | Sort-Object) -join ',' | Should Be 'PermissionRequest,PostToolUse,PreToolUse,SessionEnd,SessionStart,Stop,UserPromptSubmit'
    $settings.hooks.SessionStart[0].hooks[0].command | Should Be $relay
    $settings.hooks.UserPromptSubmit[0].hooks[0].args[0] | Should Be 'UserPromptSubmit'
    $settings.hooks.PreToolUse[0].matcher | Should Be 'Read|Bash'
    $settings.hooks.PostToolUse[0].matcher | Should Be 'Read'
    $settings.hooks.PermissionRequest[0].matcher | Should Be 'Bash'
    $settings.hooks.PermissionRequest[0].hooks[0].timeout | Should Be 120
    (Get-Content -LiteralPath $scratch.FixturePath -Raw) | Should Match 'read-only test data'
    (Get-ChildItem -LiteralPath $scratch.Profile -Force).Count | Should Be 0
  }

  It 'returns no findings when inspected machine and temp policy sources are absent' {
    $programFiles = Join-Path $TestDrive 'program-files'
    [System.IO.Directory]::CreateDirectory($programFiles) | Out-Null
    @(Get-NookClaudeLocalManagedHookFindings -ProgramFilesRoot $programFiles).Count | Should Be 0
  }

  It 'rejects a production relay, broad tool matchers, and extra hook events' {
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $config = Join-Path $TestDrive 'settings.json'
    $scratch = New-NookClaudeScratchWorkspace $relay $TestDrive
    $settings = Get-Content -LiteralPath $scratch.SettingsPath -Raw | ConvertFrom-Json
    $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $config
    Test-NookClaudeHookSettings $config $relay | Should Be $true
    $settings.hooks.SessionStart[0].hooks[0].command = 'C:\Nook\nook-hook.exe'
    $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $config
    Test-NookClaudeHookSettings $config $relay | Should Be $false
    $settings = Get-Content -LiteralPath $scratch.SettingsPath -Raw | ConvertFrom-Json
    $settings.hooks.PreToolUse[0].matcher = '*'
    $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $config
    Test-NookClaudeHookSettings $config $relay | Should Be $false
    $settings = Get-Content -LiteralPath $scratch.SettingsPath -Raw | ConvertFrom-Json
    $settings.hooks | Add-Member -NotePropertyName Notification -NotePropertyValue @(@{ hooks = @(@{ type = 'command'; command = $relay; args = @('Notification'); timeout = 10 }) }) -Force
    $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $config
    Test-NookClaudeHookSettings $config $relay | Should Be $false
  }

  It 'uses only the intended event matchers and bounded event timeouts' {
    $definitions = @(Get-NookClaudeHookDefinitions)
    @($definitions | ForEach-Object Event) -join ',' | Should Be 'SessionStart,UserPromptSubmit,PreToolUse,PostToolUse,PermissionRequest,Stop,SessionEnd'
    ($definitions | Where-Object Event -eq 'PermissionRequest').Timeout | Should Be 120
    ($definitions | Where-Object Event -eq 'PermissionRequest').Matcher | Should Be 'Bash'
    ($definitions | Where-Object Event -eq 'PostToolUse').Matcher | Should Be 'Read'
  }

  It 'detects inherited auth variables by name without exposing their values' {
    $old = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'Process')
    try {
      [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', 'must-not-be-logged', 'Process')
      $findings = @(Get-NookClaudeAuthEnvironmentOverrides)
      ($findings -contains 'ANTHROPIC_API_KEY') | Should Be $true
      ($findings -join ',') | Should Not Match 'must-not-be-logged'
    } finally {
      [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', $old, 'Process')
    }
  }

  It 'rejects profile hooks/plugins and unexpected workspace configuration' {
    $relay = Join-Path $TestDrive 'nook-hook-dev.exe'
    $scratch = New-NookClaudeScratchWorkspace $relay $TestDrive
    @{ hooks = @{ SessionStart = @() } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $scratch.Profile 'settings.json')
    Test-NookClaudeScratchWorkspace $scratch.Root $relay | Should Be $false
    Remove-Item -LiteralPath (Join-Path $scratch.Profile 'settings.json')
    Set-Content -LiteralPath (Join-Path $scratch.Workspace 'CLAUDE.md') -Value 'unexpected instructions'
    Test-NookClaudeScratchWorkspace $scratch.Root $relay | Should Be $false
  }

  It 'fails closed on unknown remote managed status or local managed hooks' {
    (Get-NookClaudeManagedHooksBlockReason) | Should Match 'refusing to launch'
    (Get-NookClaudeManagedHooksBlockReason) | Should Match 'doctor'
    (Get-NookClaudeManagedHooksBlockReason @([pscustomobject]@{ State = 'HooksPresent' }) 'Unknown') | Should Match 'Managed hooks are present'
  }

  It 'does not mutate global Claude settings or start any process when preflight is blocked' {
    $source = Get-Content (Join-Path $PSScriptRoot 'claude-dev-lifecycle.ps1') -Raw
    $source | Should Not Match 'Set-Content.*\.claude\\settings\.json'
    $source | Should Not Match 'Stop-Process|taskkill'
    $source | Should Match 'throw "FAIL CLOSED: \$managedBlock"'
    $source | Should Match 'auth login'
    $source | Should Match 'CLAUDE_CONFIG_DIR'
    $source | Should Match '--setting-sources project --strict-mcp-config --tools Read,Bash --permission-mode default'
    $source | Should Match "help -notmatch '--strict-mcp-config'"
    $source | Should Match "help -notmatch '--tools\\s\+<tools'"
    $source | Should Match 'Write-Output NOOK_DEV_PERMISSION_PROBE'
    $source | Should Match 'If it runs without a Nook card'
    $source | Should Not Match 'Copy-Item.*\.claude|Copy-Item.*credentials|Start-Process.*claude'
  }
}

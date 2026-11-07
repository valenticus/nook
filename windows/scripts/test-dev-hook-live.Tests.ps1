. (Join-Path $PSScriptRoot 'test-dev-hook-live.ps1')

Describe 'test-dev-hook-live scenario definitions' {
  It 'lists the seventeen selectable lifecycle, permission, and concurrency scenarios' {
    $names = @(Get-LiveScenarios).Keys
    $names.Count | Should Be 17
    $PauseMs | Should Be 1500
    (Resolve-ScenarioNames 'CodexInterrupt') | Should Be 'CodexInterrupt'
    (Resolve-ScenarioNames 'All').Count | Should Be 17
    (Resolve-ScenarioNames 'TwoPendingAlerts') | Should Be 'TwoPendingAlerts'
    (Resolve-ScenarioNames 'PermissionQueue') | Should Be 'PermissionQueue'
    { Resolve-ScenarioNames 'not-a-scenario' } | Should Throw
  }

  It 'assigns a distinct nook-test session id to every session in a scenario' {
    $ids = Get-ScenarioSessionIds 'TwoCodexSessions' 'fixture-run'
    @($ids.Values | Select-Object -Unique).Count | Should Be 2
    foreach ($id in $ids.Values) { $id.StartsWith('nook-test:', [StringComparison]::Ordinal) | Should Be $true }
    (Get-ScenarioSessionIds 'FiveSessionRoster' 'fixture-run').Count | Should Be 5
  }

  It 'builds valid synthetic JSON with only nook-test session ids' {
    $sid = New-TestSessionId 'codex'
    $sid.StartsWith('nook-test:', [StringComparison]::Ordinal) | Should Be $true
    $json = New-SyntheticPayload 'Interrupt' $sid @{ turn_id = 'turn-test'; permission_mode = 'default' }
    $payload = $json | ConvertFrom-Json
    $payload.hook_event_name | Should Be 'Interrupt'
    $payload.session_id | Should Be $sid
    $payload.turn_id | Should Be 'turn-test'
    { New-SyntheticPayload 'Stop' 'codex:outside-test' @{} } | Should Throw
    { New-SyntheticPayload 'UnrecognizedEvent' $sid @{} } | Should Throw
    { New-SyntheticPayload 'Stop' $sid @{ session_id = 'real-session' } } | Should Throw
  }

  It 'refuses production relay paths, production endpoints, mismatched SIDs, or absent pipes' {
    $sid = 'S-1-5-21-100-200-300-1001'
    $devPipe = "\\.\pipe\nook-dev-$sid"
    (Test-DevRelayIdentity 'C:\dev\nook-hook-dev.exe' $devPipe $sid @("nook-dev-$sid")) | Should Be $true
    (Test-DevRelayIdentity 'C:\prod\nook-hook.exe' $devPipe $sid @("nook-dev-$sid")) | Should Be $false
    (Test-DevRelayIdentity 'C:\dev\nook-hook-dev.exe' "\\.\pipe\nook-$sid" $sid @("nook-$sid")) | Should Be $false
    (Test-DevRelayIdentity 'C:\dev\nook-hook-dev.exe' $devPipe 'S-1-5-21-other' @("nook-dev-$sid")) | Should Be $false
    (Test-DevRelayIdentity 'C:\dev\nook-hook-dev.exe' $devPipe $sid @()) | Should Be $false
  }

  It 'detects stale frontend assets and incomplete relay lifecycle markers' {
    (Test-BinaryMarkers 'index island-current.js settings-current.js' @('island-current.js', 'settings-current.js')) | Should Be $true
    (Test-BinaryMarkers 'index island-old.js settings-old.js' @('island-current.js', 'settings-current.js')) | Should Be $false
    (Test-BinaryMarkers 'SessionEnd Interrupt SubagentStart SubagentStop PreCompact PostCompact PermissionRequest' @('SessionEnd', 'Interrupt', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PermissionRequest')) | Should Be $true
    (Test-BinaryMarkers 'SessionEnd Interrupt SubagentStop' @('SessionEnd', 'Interrupt', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PermissionRequest')) | Should Be $false
    (Test-DevDenyBundle (Join-Path $PSScriptRoot '..\dist-dev')) | Should Be $true
  }

  It 'limits live PermissionRequest payloads to deny-only fixture shapes' {
    $payload = New-SyntheticPayload 'PermissionRequest' 'nook-test:claude:fixture' @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } | ConvertFrom-Json
    $payload.tool_input.command | Should Be 'echo fixture-only'
    { New-SyntheticPayload 'PermissionRequest' 'nook-test:claude:fixture' @{ tool_name = 'Bash'; tool_input = @{ command = 'whoami' } } } | Should Throw
    { New-SyntheticPayload 'PermissionRequest' 'nook-test:claude:fixture' @{ tool_name = 'Bash'; permission_decision = 'allow'; tool_input = @{ command = 'echo fixture-only' } } } | Should Throw
    { New-SyntheticPayload 'PermissionRequest' 'real-session' @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } } | Should Throw
    $question = New-SyntheticPayload 'PermissionRequest' 'nook-test:claude:q' @{ tool_name = 'AskUserQuestion'; tool_input = @{ questions = @(@{ question = 'Fixture?'; options = @(@{ label = 'A' }) }) } } | ConvertFrom-Json
    $question.tool_name | Should Be 'AskUserQuestion'
  }

  It 'distinguishes explicit deny, cancellation, timeout, relay failure, and invalid replies' {
    $deny = '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Nook"}}}'
    $skip = '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"The user skipped this question from Nook, without answering it."}}}'
    (Get-PermissionRelayResult 0 $deny) | Should Be 'ExplicitDeny'
    (Get-PermissionRelayResult 0 '') | Should Be 'Cancelled'
    (Get-PermissionRelayResult 0 $skip) | Should Be 'Cancelled'
    (Get-PermissionRelayResult 0 '{not-json') | Should Be 'InvalidResponse'
    (Get-PermissionRelayResult 0 '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}') | Should Be 'InvalidResponse'
    (Get-PermissionRelayResult 1 '') | Should Be 'RelayFailed'
    (Get-PermissionRelayResult 0 '' $true) | Should Be 'TimedOut'
    (Test-DenyOnlyPermissionReply ($deny | ConvertFrom-Json)) | Should Be $true
    $source = Get-Content (Join-Path $PSScriptRoot 'test-dev-hook-live.ps1') -Raw
    $source.Contains('WaitForExit(6000)') | Should Be $true
    $source.Contains('$process.Kill()') | Should Be $true
    $source.Contains('short-lived test child was stopped') | Should Be $true
    $source.Contains('RelayDeliveryConfirmed') | Should Be $true
    $source.Contains('live GUI cleanup unverified') | Should Be $true
    $source.Contains('Scenario SHA256:') | Should Be $true
  }

  It 'keeps both pending children until each has an explicit result' {
    $children = [Collections.Generic.List[object]]::new()
    $children.Add([pscustomobject]@{ Agent = 'claude'; Completed = $false; Outcome = '' })
    $children.Add([pscustomobject]@{ Agent = 'codex'; Completed = $false; Outcome = '' })
    (Get-PendingPermissionChildren $children).Count | Should Be 2
    $children[0].Completed = $true
    $children[0].Outcome = 'ExplicitDeny'
    (Get-PendingPermissionChildren $children).Count | Should Be 1
    (Get-PendingPermissionChildren $children)[0].Agent | Should Be 'codex'
    $source = Get-Content (Join-Path $PSScriptRoot 'test-dev-hook-live.ps1') -Raw
    $source.Contains('WAITING FOR USER DENY (2/2)') | Should Be $true
    $source.Contains('WAITING FOR USER DENY (1/2)') | Should Be $true
    $source.Contains("Write-Host (`"[{0}] send {1}/PermissionRequest") | Should Be $true
    $startBody = [regex]::Match($source, '(?s)function Start-PermissionRelay\b.*?\n  }').Value
    $startBody.Contains('Write-Output') | Should Be $false
  }

  It 'stays alive while one synthetic response is still pending and exits only after both' {
    $scriptPath = Join-Path $PSScriptRoot 'test-dev-hook-live.ps1'
    $probePath = Join-Path $TestDrive 'two-pending-probe.ps1'
    $probe = @"
. '$scriptPath' -ListScenarios
`$children = [Collections.Generic.List[object]]::new()
`$children.Add([pscustomobject]@{ Completed = `$false; Outcome = ''; Agent = 'claude' })
`$children.Add([pscustomobject]@{ Completed = `$false; Outcome = ''; Agent = 'codex' })
if ((Get-PendingPermissionChildren `$children).Count -ne 2) { exit 11 }
Start-Sleep -Milliseconds 1200
`$children[0].Completed = `$true
`$children[0].Outcome = 'ExplicitDeny'
if ((Get-PendingPermissionChildren `$children).Count -ne 1) { exit 12 }
Start-Sleep -Milliseconds 1800
`$children[1].Completed = `$true
`$children[1].Outcome = 'ExplicitDeny'
if ((Get-PendingPermissionChildren `$children).Count -ne 0) { exit 13 }
Write-Output 'TwoPendingAlerts: SUCCESS'
exit 0
"@
    [IO.File]::WriteAllText($probePath, $probe)
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$probePath`"") -PassThru -WindowStyle Hidden
    try {
      ( $process.WaitForExit(500) ) | Should Be $false
      ( $process.WaitForExit(1100) ) | Should Be $false
      $process.WaitForExit(5000) | Should Be $true
      $process.ExitCode | Should Be 0
    } finally {
      if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
      $process.Dispose()
    }
  }

  It 'runs SessionEnd for both IDs from finally and always reports a terminal status' {
    $source = Get-Content (Join-Path $PSScriptRoot 'test-dev-hook-live.ps1') -Raw
    $source.Contains('Invoke-SessionEndCleanup $ids') | Should Be $true
    $source.Contains("finally {") | Should Be $true
    $source.Contains("'TwoPendingAlerts: SUCCESS") | Should Be $true
    $source.Contains("'TwoPendingAlerts: FAILED'") | Should Be $true
    $source.Contains("'TwoPendingAlerts: TIMEOUT'") | Should Be $true
    $source.IndexOf("Write-Output 'TwoPendingAlerts: SUCCESS") | Should BeGreaterThan $source.IndexOf('} finally {')
    $source.Contains('exit $script:LiveTestExitCode') | Should Be $true
    $source.Contains("$scenarioFailure -like '*270-second*'") | Should Be $true
  }

  It 'attempts both exact SessionEnd IDs and preserves a delivery failure' {
    $ids = @{
      'claude:alert-a' = 'nook-test:two-pending-alerts:claude:fixture:alert-a'
      'codex:alert-b' = 'nook-test:two-pending-alerts:codex:fixture:alert-b'
    }
    $sent = [Collections.Generic.List[string]]::new()
    $result = Invoke-SessionEndCleanup $ids {
      param($agent, $event, $sessionId, $fields)
      $sent.Add("$agent/$event/$sessionId")
      if ($agent -eq 'claude') { throw 'synthetic IPC failure' }
    }
    $sent.Count | Should Be 2
    ($sent -contains 'claude/SessionEnd/nook-test:two-pending-alerts:claude:fixture:alert-a') | Should Be $true
    ($sent -contains 'codex/SessionEnd/nook-test:two-pending-alerts:codex:fixture:alert-b') | Should Be $true
    $result.Results['claude:alert-a'] | Should Be 'Failed'
    $result.Results['codex:alert-b'] | Should Be 'RelayDeliveryConfirmed'
    $result.Errors.Count | Should Be 1
    $result.Errors[0] | Should Match 'synthetic IPC failure'
  }

  It 'returns an explicit zero exit code from the outer PowerShell process for list mode' {
    $scriptPath = Join-Path $PSScriptRoot 'test-dev-hook-live.ps1'
    $output = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ListScenarios 2>&1
    $LASTEXITCODE | Should Be 0
    (@($output | Where-Object { $_ -match '^TwoPendingAlerts\s' }).Count) | Should Be 1
  }
  It 'sends a supported SessionEnd cleanup for every scenario session' {
    foreach ($entry in (Get-LiveScenarios).GetEnumerator()) {
      if ($entry.Key -eq 'TwoPendingAlerts') {
        @($entry.Value | Where-Object Event -eq 'SessionEnd').Count | Should Be 0
        continue
      }
      foreach ($session in @($entry.Value | ForEach-Object { "$($_.Agent):$($_.Session)" } | Select-Object -Unique)) {
        $agent, $sessionKey = $session.Split(':', 2)
        @($entry.Value | Where-Object { $_.Agent -eq $agent -and $_.Session -eq $sessionKey -and $_.Event -eq 'SessionEnd' }).Count | Should BeGreaterThan 0
      }
    }
    $duplicate = (Get-LiveScenarios).DuplicateLifecycle | Where-Object Event -eq 'SessionEnd'
    @($duplicate).Count | Should Be 2
  }

  It 'keeps Notification separate from PermissionRequest and cleans every pending scenario' {
    $permissionNames = @('PermissionShow', 'PermissionCancel', 'PermissionInterrupt', 'PermissionQueue', 'PermissionIsolation', 'PermissionQuestion')
    foreach ($name in $permissionNames) {
      @((Get-LiveScenarios)[$name] | Where-Object Event -eq 'PermissionRequest').Count | Should BeGreaterThan 0
      @((Get-LiveScenarios)[$name] | Where-Object Event -eq 'SessionEnd').Count | Should BeGreaterThan 0
    }
    $notification = (Get-LiveScenarios).NotificationReply
    @($notification | Where-Object Event -eq 'PermissionRequest').Count | Should Be 0
    @($notification | Where-Object Event -eq 'Notification').Count | Should Be 1
    @($notification | Where-Object Event -eq 'SessionEnd').Count | Should Be 1
    @((Get-LiveScenarios).PermissionInterrupt | Where-Object Event -eq 'Interrupt').Count | Should Be 1
    @((Get-LiveScenarios).PermissionQueue | Where-Object Event -eq 'PermissionRequest').Count | Should Be 2
    @((Get-LiveScenarios).PermissionIsolation | Where-Object Event -eq 'SessionEnd').Count | Should Be 2
  }

  It 'keeps TwoPendingAlerts open for manual deny and has a bounded SessionEnd cleanup path' {
    $scenario = (Get-LiveScenarios).TwoPendingAlerts
    @($scenario | Where-Object Event -eq 'PermissionRequest').Count | Should Be 2
    @($scenario | Where-Object Event -eq 'SessionStart').Count | Should Be 2
    $requests = @($scenario | Where-Object Event -eq 'PermissionRequest')
    $requests[0].Agent | Should Be 'claude'
    $requests[1].Agent | Should Be 'codex'
    @($scenario | Where-Object Event -eq 'SessionEnd').Count | Should Be 0
    $source = Get-Content (Join-Path $PSScriptRoot 'test-dev-hook-live.ps1') -Raw
    $source.Contains('AddSeconds(270)') | Should Be $true
    $source.Contains('Invoke-SessionEndCleanup $ids') | Should Be $true
    $source.Contains('cleanupErrors.Add') | Should Be $true
    $source.Contains('Synthetic session cleanup failed:') | Should Be $true
    $source.Contains('Wait-TwoPendingAlerts $permissionChildren') | Should Be $true
    $source.Contains("$child.Outcome -ne 'ExplicitDeny'") | Should Be $true
    $source.Contains('newer Codex request completed before the older Claude request') | Should Be $true
    $source.Contains('configured auto-close') | Should Be $true
    $islandSource = Get-Content (Join-Path $PSScriptRoot '..\src\island\island.ts') -Raw
    $islandSource.Contains('foldManualTestAlerts') | Should Be $false
    $islandSource.Contains('3_500') | Should Be $false
    $hookSource = Get-Content (Join-Path $PSScriptRoot '..\hook\src\main.rs') -Raw
    $hookSource.Contains('MANUAL_ALERT_DECISION_BUDGET: Duration = Duration::from_secs(290)') | Should Be $true
    $ids = Get-ScenarioSessionIds 'TwoPendingAlerts' 'fixture-run'
    @($ids.Values | Where-Object { $_.StartsWith('nook-test:two-pending-alerts:', [StringComparison]::Ordinal) }).Count | Should Be 2
    $ids['claude:alert-a'] | Should Be 'nook-test:two-pending-alerts:claude:fixture-run:alert-a'
    $ids['codex:alert-b'] | Should Be 'nook-test:two-pending-alerts:codex:fixture-run:alert-b'
  }

  It 'uses only documented lifecycle event names and fields in Codex scenarios' {
    $allowed = @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd', 'Interrupt', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact')
    foreach ($scenario in (Get-LiveScenarios).Values) {
      foreach ($step in $scenario | Where-Object Agent -eq 'codex') {
        ($allowed -contains $step.Event) | Should Be $true
        ($step.Fields.Keys -notcontains 'permission_decision') | Should Be $true
      }
    }
  }
}

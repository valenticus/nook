param(
  [ValidateRange(0, 10000)]
  [int] $PauseMs = 1500,
  [ValidateSet('All', 'CodexTurn', 'CodexInterrupt', 'CodexSubagent', 'CodexCompaction', 'TwoCodexSessions', 'ClaudeAndCodex', 'FiveSessionRoster', 'DuplicateLifecycle', 'LatePostToolUse', 'PermissionShow', 'PermissionCancel', 'PermissionInterrupt', 'PermissionQueue', 'PermissionIsolation', 'PermissionQuestion', 'NotificationReply', 'TwoPendingAlerts')]
  [string] $Scenario = 'All',
  [switch] $ListScenarios
)

$ErrorActionPreference = 'Stop'
$script:CurrentScenario = ''

function Get-LiveScenarios {
  [ordered]@{
    CodexTurn = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'main'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'main'; Fields = @{ turn_id = 'turn-main'; prompt = 'Synthetic Codex lifecycle check.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'main'; Fields = @{ turn_id = 'turn-main'; stop_hook_active = $false; last_assistant_message = 'Synthetic turn complete.' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } }
    )
    CodexInterrupt = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'main'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'main'; Fields = @{ turn_id = 'turn-interrupt'; prompt = 'Synthetic interrupt check.' } },
      @{ Agent = 'codex'; Event = 'PreToolUse'; Session = 'main'; Fields = @{ turn_id = 'turn-interrupt'; tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'codex'; Event = 'Interrupt'; Session = 'main'; Fields = @{ turn_id = 'turn-interrupt'; permission_mode = 'default' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } }
    )
    CodexSubagent = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'main'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'main'; Fields = @{ turn_id = 'turn-subagent'; prompt = 'Synthetic subagent lifecycle check.' } },
      @{ Agent = 'codex'; Event = 'SubagentStart'; Session = 'main'; Fields = @{ turn_id = 'turn-subagent'; agent_id = 'nook-test-agent'; agent_type = 'general'; permission_mode = 'default' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'main'; Fields = @{ turn_id = 'turn-subagent'; stop_hook_active = $false; last_assistant_message = 'Synthetic delegated work.' } },
      @{ Agent = 'codex'; Event = 'SubagentStop'; Session = 'main'; Fields = @{ turn_id = 'turn-subagent'; agent_id = 'nook-test-agent'; agent_type = 'general'; permission_mode = 'default'; last_assistant_message = 'Synthetic child complete.' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } }
    )
    CodexCompaction = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'main'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'main'; Fields = @{ turn_id = 'turn-compact'; prompt = 'Synthetic compaction check.' } },
      @{ Agent = 'codex'; Event = 'PreCompact'; Session = 'main'; Fields = @{ turn_id = 'turn-compact'; trigger = 'auto' } },
      @{ Agent = 'codex'; Event = 'PostCompact'; Session = 'main'; Fields = @{ turn_id = 'turn-compact'; trigger = 'auto' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'main'; Fields = @{ turn_id = 'turn-compact'; stop_hook_active = $false; last_assistant_message = 'Synthetic compacted turn complete.' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } }
    )
    TwoCodexSessions = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex-a'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex-a'; Fields = @{ turn_id = 'turn-a'; prompt = 'Synthetic first Codex session.' } },
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex-b'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex-b'; Fields = @{ turn_id = 'turn-b'; prompt = 'Synthetic second Codex session.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex-a'; Fields = @{ turn_id = 'turn-a'; stop_hook_active = $false; last_assistant_message = 'Synthetic first session complete.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex-b'; Fields = @{ turn_id = 'turn-b'; stop_hook_active = $false; last_assistant_message = 'Synthetic second session complete.' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex-a'; Fields = @{ reason = 'other' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex-b'; Fields = @{ reason = 'other' } }
    )
    ClaudeAndCodex = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'claude'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'UserPromptSubmit'; Session = 'claude'; Fields = @{ prompt = 'Synthetic Claude session alongside Codex.' } },
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex'; Fields = @{ turn_id = 'turn-codex'; prompt = 'Synthetic Codex session alongside Claude.' } },
      @{ Agent = 'claude'; Event = 'Stop'; Session = 'claude'; Fields = @{ last_assistant_message = 'Synthetic Claude complete.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex'; Fields = @{ turn_id = 'turn-codex'; stop_hook_active = $false; last_assistant_message = 'Synthetic Codex complete.' } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'claude'; Fields = @{ reason = 'other' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex'; Fields = @{ reason = 'other' } }
    )
    FiveSessionRoster = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex-a'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex-a'; Fields = @{ turn_id = 'roster-a'; prompt = 'Synthetic roster session A.' } },
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex-b'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex-b'; Fields = @{ turn_id = 'roster-b'; prompt = 'Synthetic roster session B.' } },
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex-c'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex-c'; Fields = @{ turn_id = 'roster-c'; prompt = 'Synthetic roster session C.' } },
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'codex-d'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'codex-d'; Fields = @{ turn_id = 'roster-d'; prompt = 'Synthetic roster session D.' } },
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'claude-e'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'UserPromptSubmit'; Session = 'claude-e'; Fields = @{ prompt = 'Synthetic roster session E.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex-a'; Fields = @{ turn_id = 'roster-a'; stop_hook_active = $false; last_assistant_message = 'Synthetic session A complete.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex-b'; Fields = @{ turn_id = 'roster-b'; stop_hook_active = $false; last_assistant_message = 'Synthetic session B complete.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex-c'; Fields = @{ turn_id = 'roster-c'; stop_hook_active = $false; last_assistant_message = 'Synthetic session C complete.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'codex-d'; Fields = @{ turn_id = 'roster-d'; stop_hook_active = $false; last_assistant_message = 'Synthetic session D complete.' } },
      @{ Agent = 'claude'; Event = 'Stop'; Session = 'claude-e'; Fields = @{ last_assistant_message = 'Synthetic session E complete.' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex-a'; Fields = @{ reason = 'other' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex-b'; Fields = @{ reason = 'other' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex-c'; Fields = @{ reason = 'other' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'codex-d'; Fields = @{ reason = 'other' } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'claude-e'; Fields = @{ reason = 'other' } }
    )
    DuplicateLifecycle = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'main'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'main'; Fields = @{ turn_id = 'turn-duplicate'; prompt = 'Synthetic duplicate lifecycle check.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'main'; Fields = @{ turn_id = 'turn-duplicate'; stop_hook_active = $false; last_assistant_message = 'Synthetic completion.' } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'main'; Fields = @{ turn_id = 'turn-duplicate'; stop_hook_active = $false; last_assistant_message = 'Synthetic duplicate completion.' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } }
    )
    LatePostToolUse = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'main'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'main'; Fields = @{ turn_id = 'turn-late'; prompt = 'Synthetic late event check.' } },
      @{ Agent = 'codex'; Event = 'PreToolUse'; Session = 'main'; Fields = @{ turn_id = 'turn-late'; tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'codex'; Event = 'Stop'; Session = 'main'; Fields = @{ turn_id = 'turn-late'; stop_hook_active = $false; last_assistant_message = 'Synthetic completion before delayed tool event.' } },
      @{ Agent = 'codex'; Event = 'PostToolUse'; Session = 'main'; Fields = @{ turn_id = 'turn-late'; tool_name = 'Bash'; tool_response = @{ stdout = 'late synthetic result' } } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'main'; Fields = @{ reason = 'other' } }
    )
    PermissionShow = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'show'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'show'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'show'; Fields = @{ reason = 'other' } }
    )
    PermissionCancel = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'cancel'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'cancel'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'cancel'; Fields = @{ reason = 'other' } }
    )
    PermissionInterrupt = @(
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'interrupt'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'UserPromptSubmit'; Session = 'interrupt'; Fields = @{ turn_id = 'permission-turn'; prompt = 'Synthetic permission interrupt.' } },
      @{ Agent = 'codex'; Event = 'PermissionRequest'; Session = 'interrupt'; Fields = @{ turn_id = 'permission-turn'; tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'codex'; Event = 'Interrupt'; Session = 'interrupt'; Fields = @{ turn_id = 'permission-turn'; permission_mode = 'default' } },
      @{ Agent = 'codex'; Event = 'SessionEnd'; Session = 'interrupt'; Fields = @{ reason = 'other' } }
    )
    PermissionQueue = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'queue'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'queue'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'queue'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only second request' } } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'queue'; Fields = @{ reason = 'other' } }
    )
    PermissionIsolation = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'isolation-a'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'isolation-b'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'isolation-a'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only A' } } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'isolation-b'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only B' } } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'isolation-a'; Fields = @{ reason = 'other' } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'isolation-b'; Fields = @{ reason = 'other' } }
    )
    PermissionQuestion = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'question'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'question'; Fields = @{ tool_name = 'AskUserQuestion'; tool_input = @{ questions = @(@{ question = 'Synthetic fixture question?'; header = 'Fixture'; options = @(@{ label = 'A'; description = 'Synthetic option' }, @{ label = 'B'; description = 'Synthetic option' }); multiSelect = $false }) } } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'question'; Fields = @{ reason = 'other' } }
    )
    NotificationReply = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'notification'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'Notification'; Session = 'notification'; Fields = @{ notification_type = 'permission_prompt'; message = 'Synthetic notification question?' } },
      @{ Agent = 'claude'; Event = 'SessionEnd'; Session = 'notification'; Fields = @{ reason = 'other' } }
    )
    TwoPendingAlerts = @(
      @{ Agent = 'claude'; Event = 'SessionStart'; Session = 'alert-a'; Fields = @{ source = 'startup' } },
      @{ Agent = 'claude'; Event = 'PermissionRequest'; Session = 'alert-a'; Fields = @{ tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only' } } },
      @{ Agent = 'codex'; Event = 'SessionStart'; Session = 'alert-b'; Fields = @{} },
      @{ Agent = 'codex'; Event = 'PermissionRequest'; Session = 'alert-b'; Fields = @{ turn_id = 'two-alerts-turn'; tool_name = 'Bash'; tool_input = @{ command = 'echo fixture-only B' } } }
    )
  }
}

function Resolve-ScenarioNames([string] $Name) {
  $names = @(Get-LiveScenarios).Keys
  if ($Name -eq 'All') { return $names }
  if ($Name -notin $names) { throw "Unknown scenario '$Name'. Use -ListScenarios to see valid names." }
  return @($Name)
}

function New-TestSessionId([string] $Agent) {
  "nook-test:${Agent}:$([Guid]::NewGuid().ToString('N'))"
}

function New-SyntheticPayload([string] $Event, [string] $SessionId, [hashtable] $Fields = @{}) {
  if (-not $SessionId.StartsWith('nook-test:', [StringComparison]::Ordinal)) { throw 'Refusing a session id outside the nook-test: namespace.' }
  if ($Event -eq 'PermissionRequest') {
    $command = $Fields.tool_input.command
    if ($Fields.Keys | Where-Object { $_ -in @('permission_decision', 'request_id', 'nook_test_deny_only') }) { throw 'Permission fixture fields cannot set a decision, request id, or safety marker.' }
    if ($Fields.tool_name -notin @('Bash', 'AskUserQuestion') -or ($Fields.tool_name -eq 'Bash' -and $command -notin @('echo fixture-only', 'echo fixture-only second request', 'echo fixture-only A', 'echo fixture-only B'))) {
      throw 'Live PermissionRequest fixtures are limited to a deny-only fixture command or the documented AskUserQuestion schema.'
    }
  }
  $supportedEvents = @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd', 'Interrupt', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PermissionRequest', 'Notification')
  if ($Event -notin $supportedEvents) { throw "Unsupported live hook event '$Event'." }
  if (@('hook_event_name', 'session_id') | Where-Object { $Fields.ContainsKey($_) }) { throw 'Scenario fields cannot replace event or session identity.' }
  $payload = [ordered]@{ hook_event_name = $Event; session_id = $SessionId; cwd = 'C:\NookTestFixture' }
  foreach ($key in $Fields.Keys) { $payload[$key] = $Fields[$key] }
  $json = $payload | ConvertTo-Json -Depth 12 -Compress
  $parsed = $json | ConvertFrom-Json
  if ($parsed.hook_event_name -ne $Event -or $parsed.session_id -ne $SessionId) { throw 'Synthetic JSON failed its round-trip check.' }
  return $json
}

function Test-DenyOnlyPermissionReply($Response) {
  return $Response.hookSpecificOutput.hookEventName -eq 'PermissionRequest' -and $Response.hookSpecificOutput.decision.behavior -eq 'deny'
}

function Get-PermissionRelayResult([int] $ExitCode, [string] $Stdout, [bool] $TimedOut = $false) {
  if ($TimedOut) { return 'TimedOut' }
  if ($ExitCode -ne 0) { return 'RelayFailed' }
  if ([string]::IsNullOrWhiteSpace($Stdout)) { return 'Cancelled' }
  try { $response = $Stdout.Trim() | ConvertFrom-Json -ErrorAction Stop }
  catch { return 'InvalidResponse' }
  if ($response.hookSpecificOutput.decision.message -like '*skipped this question*') { return 'Cancelled' }
  if (Test-DenyOnlyPermissionReply $response) { return 'ExplicitDeny' }
  return 'InvalidResponse'
}

function Get-PendingPermissionChildren($Children) {
  # Unary comma keeps a one-item result as an array in Windows PowerShell 5.1;
  # otherwise scalar unrolling makes `.Count` null and the wait loop exits.
  return ,@($Children | Where-Object { -not $_.Completed })
}

function Invoke-SessionEndCleanup([hashtable] $SessionIds, [scriptblock] $SendEvent) {
  $results = @{}
  $errors = [Collections.Generic.List[string]]::new()
  foreach ($key in $SessionIds.Keys) {
    $agent = $key.Split(':')[0]
    try {
      & $SendEvent $agent 'SessionEnd' $SessionIds[$key] @{ reason = 'other' }
      $results[$key] = 'RelayDeliveryConfirmed'
    } catch {
      $results[$key] = 'Failed'
      $errors.Add("SessionEnd failed for $($SessionIds[$key]): $($_.Exception.Message)")
    }
  }
  return [pscustomobject]@{ Results = $results; Errors = $errors }
}

function Test-DevRelayIdentity([string] $RelayPath, [string] $Endpoint, [string] $Sid, [string[]] $PipeNames) {
  if ([IO.Path]::GetFileName($RelayPath) -ine 'nook-hook-dev.exe') { return $false }
  $expected = "nook-dev-$Sid"
  $prefix = '\\.\pipe\'
  if ($Endpoint -ine ($prefix + $expected)) { return $false }
  return $PipeNames -contains $expected
}

function Test-BinaryMarkers([string] $BinaryText, [string[]] $Markers) {
  foreach ($marker in $Markers) { if (-not $BinaryText.Contains($marker)) { return $false } }
  return $true
}

function Get-FrontendBundleMarkers([string] $DistRoot) {
  $markers = @()
  foreach ($page in @('index.html', 'settings.html', 'agents.html')) {
    $pagePath = Join-Path $DistRoot $page
    if (-not (Test-Path -LiteralPath $pagePath -PathType Leaf)) { throw "Missing Dev frontend page: $pagePath" }
    $html = Get-Content -LiteralPath $pagePath -Raw
    foreach ($match in [regex]::Matches($html, '/assets/([^"''?]+)')) { $markers += $match.Groups[1].Value }
  }
  return @($markers | Select-Object -Unique)
}

function Test-DevDenyBundle([string] $DistRoot) {
  $bundleText = (Get-ChildItem -LiteralPath (Join-Path $DistRoot 'assets') -Filter '*.js' -File | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
  return $bundleText.Contains('nook_test_deny_only') -and $bundleText.Contains('nook_test_manual_alert') -and $bundleText.Contains('Dev test request')
}

function Read-BinaryText([string] $Path) {
  [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($Path))
}

function Get-ScenarioSessionIds([string] $ScenarioName, [string] $RunId) {
  $ids = @{}
  foreach ($step in (Get-LiveScenarios)[$ScenarioName]) {
    $key = "$($step.Agent):$($step.Session)"
    if (-not $ids.ContainsKey($key)) {
      $agentPart = if ($step.Agent -eq 'codex') { 'codex' } else { 'claude' }
      $ids[$key] = if ($ScenarioName -eq 'TwoPendingAlerts') {
        "nook-test:two-pending-alerts:${agentPart}:${RunId}:$($step.Session)"
      } else {
        "nook-test:${agentPart}:${RunId}:$($step.Session)"
      }
    }
  }
  return $ids
}

function Invoke-LiveTest {
  if ($ListScenarios) {
    foreach ($entry in (Get-LiveScenarios).GetEnumerator()) { Write-Output ("{0}`t{1} events" -f $entry.Key, $entry.Value.Count) }
    return
  }

  $windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $relayCandidates = @(
    (Join-Path $windowsRoot 'target-nook-dev\release\nook-hook-dev.exe'),
    (Join-Path $windowsRoot 'dev-release\bin\nook-hook-dev.exe')
  )
  $relay = $relayCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $relay) { throw 'Dev relay executable not found. Build Nook Dev first.' }
  $relayPath = (Resolve-Path -LiteralPath $relay).Path
  if ([IO.Path]::GetFileName($relayPath) -ine 'nook-hook-dev.exe') { throw 'Only nook-hook-dev.exe is allowed.' }

  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $endpoint = (& $relayPath '--test-endpoint' | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $endpoint.StartsWith('\\.\pipe\nook-dev-', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Relay did not report its compile-time Dev endpoint; refusing to send fixtures.'
  }
  $runningDev = Get-Process -Name 'nook-dev' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and ([IO.Path]::GetFileName($_.Path) -ieq 'nook-dev.exe') }
  if (-not $runningDev) { throw 'No Nook Dev process is running; this script will not start an IPC server.' }
  $distDev = Join-Path $windowsRoot 'dist-dev'
  $frontendMarkers = Get-FrontendBundleMarkers $distDev
  if (-not (Test-DevDenyBundle $distDev)) { throw 'Current dist-dev assets do not include the deny-only/manual-alert PermissionRequest UI; no fixtures were sent.' }
  $requiredLifecycle = @('PermissionRequest', 'SessionEnd', 'Interrupt', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact')
  foreach ($process in $runningDev) {
    $appText = Read-BinaryText $process.Path
    if (-not (Test-BinaryMarkers $appText $frontendMarkers)) {
      throw "Running Nook Dev ($($process.Path)) does not embed the current dist-dev assets. Rebuild and manually relaunch Dev before testing; no fixtures were sent."
    }
  }
  $relayText = Read-BinaryText $relayPath
  if (-not (Test-BinaryMarkers $relayText $requiredLifecycle)) {
    throw "The selected nook-hook-dev.exe does not contain all required Codex lifecycle events. Rebuild Dev before testing; no fixtures were sent."
  }
  $pipeNames = @(Get-ChildItem '\\.\pipe\' -ErrorAction SilentlyContinue | ForEach-Object Name)
  if (-not (Test-DevRelayIdentity $relayPath $endpoint $sid $pipeNames)) {
    throw "The exact current-user Dev pipe is not listening ($endpoint). No fixtures were sent. Start Nook Dev as this Windows user; the script will not start or close it."
  }
  Write-Output 'Dev binary embeds current dist-dev assets; relay contains the full Codex lifecycle; exact SID pipe is present.'

  function Send-SyntheticEvent([string] $Agent, [string] $Event, [string] $SessionId, [hashtable] $Fields = @{}) {
    $json = New-SyntheticPayload $Event $SessionId $Fields
    Write-Output ("[{0}] send {1}/{2} session={3}" -f $script:CurrentScenario, $Agent, $Event, $SessionId)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $relayPath
    $start.Arguments = if ($Agent -eq 'codex') { "--agent codex $Event" } else { $Event }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Could not start Dev relay for $Agent/$Event." }
    $process.StandardInput.WriteLine($json)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(8000)) {
      $process.Kill()
      throw "Dev relay timed out for $Agent/$Event. Only the short-lived relay child was stopped; Nook Dev remains untouched."
    }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    if ($process.ExitCode -ne 0) { throw "Dev relay failed for ${Agent}/${Event}: $stderr" }
    if (-not [string]::IsNullOrWhiteSpace($stdout)) { throw "Unexpected output from $Agent/$Event; only PermissionRequest may return a decision." }
    $process.Dispose()
    if ($PauseMs -gt 0) { Start-Sleep -Milliseconds $PauseMs }
  }

  function Start-PermissionRelay([string] $Agent, [string] $SessionId, [hashtable] $Fields) {
    $json = New-SyntheticPayload 'PermissionRequest' $SessionId $Fields
    # This function is assigned to $child. Keep diagnostics off the success
    # pipeline so the assignment receives only the child record.
    Write-Host ("[{0}] send {1}/PermissionRequest session={2} (deny-only, waiting for lifecycle cleanup)" -f $script:CurrentScenario, $Agent, $SessionId)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $relayPath
    $start.Arguments = if ($Agent -eq 'codex') { '--agent codex PermissionRequest' } else { 'PermissionRequest' }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $output = [Collections.Concurrent.ConcurrentQueue[string]]::new()
    $errors = [Collections.Concurrent.ConcurrentQueue[string]]::new()
    $outputHandler = [Diagnostics.DataReceivedEventHandler] { param($sender, $eventArgs) if ($eventArgs.Data) { $output.Enqueue($eventArgs.Data) } }.GetNewClosure()
    $errorHandler = [Diagnostics.DataReceivedEventHandler] { param($sender, $eventArgs) if ($eventArgs.Data) { $errors.Enqueue($eventArgs.Data) } }.GetNewClosure()
    $process.add_OutputDataReceived($outputHandler)
    $process.add_ErrorDataReceived($errorHandler)
    if (-not $process.Start()) { throw "Could not start deny-only relay for $Agent/PermissionRequest." }
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    $process.StandardInput.WriteLine($json)
    $process.StandardInput.Close()
    return [pscustomobject]@{ Agent = $Agent; SessionId = $SessionId; Process = $process; Output = $output; Errors = $errors; Completed = $false; Outcome = '' }
  }

  function Complete-PermissionRelay($child) {
    $process = $child.Process
    if (-not $process.WaitForExit(6000)) {
      $process.Kill()
      $process.WaitForExit()
      $child.Completed = $true
      $child.Outcome = 'TimedOut'
      $process.Dispose()
      throw 'Permission relay exceeded its bounded wait; only its short-lived test child was stopped.'
    }
    # Flush asynchronous redirected output after the process has exited.
    $process.WaitForExit()
    $stdoutLines = @($child.Output.ToArray())
    $stderrLines = @($child.Errors.ToArray())
    $exitCode = $process.ExitCode
    $child.Completed = $true
    $process.Dispose()
    $stdout = $stdoutLines -join "`n"
    $child.Outcome = Get-PermissionRelayResult $exitCode $stdout
    if ($child.Outcome -eq 'RelayFailed') { throw "Permission relay failed: $($stderrLines -join ' ')" }
    if ($child.Outcome -eq 'InvalidResponse') { throw "Permission relay returned an invalid or non-deny response: $stdout" }
    Write-Output ("[{0}] relay completed safely ({1})" -f $script:CurrentScenario, $child.Outcome)
  }

  function Wait-TwoPendingAlerts($children) {
    $deadline = [DateTime]::UtcNow.AddSeconds(270)
    Write-Output 'WAITING FOR USER DENY (2/2): Deny the Claude card, wait for the configured auto-close, then open Codex and Deny it. No Allow action exists.'
    while ((Get-PendingPermissionChildren $children).Count -gt 0) {
      $unfinished = Get-PendingPermissionChildren $children
      if ($unfinished.Count -gt 1 -and $unfinished[1].Process.HasExited -and -not $unfinished[0].Process.HasExited) {
        throw 'The newer Codex request completed before the older Claude request; aborting to preserve the intended 2-to-1 UX order.'
      }
      foreach ($child in $children) {
        if (-not $child.Completed -and $child.Process.WaitForExit(1)) {
          Complete-PermissionRelay $child
          if ($child.Outcome -ne 'ExplicitDeny') { throw "A test request ended as $($child.Outcome), not with an explicit Deny. Check the Dev window and relay status." }
          $left = (Get-PendingPermissionChildren $children).Count
          Write-Output ("[{0}] ExplicitDeny confirmed; {1} relay request(s) remain pending" -f $script:CurrentScenario, $left)
          if ($left -eq 1) { Write-Output 'WAITING FOR USER DENY (1/2): one request remains pending.' }
          if ($left -eq 1) { Write-Output 'Let the Island fold using the current Settings autoCloseInterval, verify bell 1, then click it to open Codex and Deny that request.' }
          if ($left -eq 0) { Write-Output 'Both requests received explicit Deny replies. SessionEnd cleanup follows; move the pointer away and wait autoCloseInterval to inspect the neutral compact bell at 0.' }
        }
      }
      if ((Get-PendingPermissionChildren $children).Count -eq 0) { break }
      if ([DateTime]::UtcNow -ge $deadline) { throw 'TwoPendingAlerts exceeded its bounded 270-second manual window; SessionEnd cleanup will run.' }
      Start-Sleep -Milliseconds 200
    }
  }

  foreach ($scenarioName in (Resolve-ScenarioNames $Scenario)) {
    $script:CurrentScenario = $scenarioName
    $runId = [Guid]::NewGuid().ToString('N')
    $ids = Get-ScenarioSessionIds $scenarioName $runId
    $ended = @{}
    $permissionChildren = [Collections.Generic.List[object]]::new()
    $permissionResults = @{}
    $sessionEndResults = @{}
    $scenarioFailure = $null
    Write-Output "=== Scenario: $scenarioName ==="
    $scriptPath = (Resolve-Path -LiteralPath $PSCommandPath).Path
    $scriptHash = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash
    if ($scenarioName -eq 'TwoPendingAlerts') {
      Write-Output "Scenario script: $scriptPath"
      Write-Output "Scenario SHA256: $scriptHash"
      Write-Output "Claude session ID: $($ids['claude:alert-a'])"
      Write-Output "Codex session ID: $($ids['codex:alert-b'])"
    }
    try {
      foreach ($step in (Get-LiveScenarios)[$scenarioName]) {
        $key = "$($step.Agent):$($step.Session)"
        if ($step.Event -eq 'PermissionRequest') {
          $child = Start-PermissionRelay $step.Agent $ids[$key] $step.Fields
          $child | Add-Member -NotePropertyName ResultKey -NotePropertyValue $key
          $permissionChildren.Add($child)
          if ($PauseMs -gt 0) { Start-Sleep -Milliseconds $PauseMs }
        } else {
          Send-SyntheticEvent $step.Agent $step.Event $ids[$key] $step.Fields
        }
        if ($step.Event -eq 'SessionEnd') { $ended[$key] = $true }
        if ($scenarioName -eq 'PermissionIsolation' -and $step.Event -eq 'SessionEnd' -and $step.Session -eq 'isolation-a') {
          $childA = $permissionChildren | Where-Object SessionId -eq $ids['claude:isolation-a'] | Select-Object -First 1
          $childB = $permissionChildren | Where-Object SessionId -eq $ids['claude:isolation-b'] | Select-Object -First 1
          if ($childA -and -not $childA.Process.HasExited) { throw 'SessionEnd did not release its own synthetic PermissionRequest.' }
          if ($childB -and $childB.Process.HasExited) { throw 'Ending one synthetic session unexpectedly released the other session request.' }
        }
      }
      if ($scenarioName -eq 'TwoPendingAlerts') { Wait-TwoPendingAlerts $permissionChildren }
    } catch {
      $scenarioFailure = $_.Exception.Message
    } finally {
      # SessionEnd is idempotent and is sent for both IDs after either explicit
      # denies or timeout/interruption. Do not report success if the relay rejects it.
      $cleanupErrors = [Collections.Generic.List[string]]::new()
      $sessionCleanup = Invoke-SessionEndCleanup $ids { param($agent, $event, $sessionId, $fields) Send-SyntheticEvent $agent $event $sessionId $fields }
      foreach ($key in $sessionCleanup.Results.Keys) {
        $sessionEndResults[$key] = $sessionCleanup.Results[$key]
        if ($sessionCleanup.Results[$key] -eq 'RelayDeliveryConfirmed') { $ended[$key] = $true }
      }
      foreach ($errorText in $sessionCleanup.Errors) { $cleanupErrors.Add($errorText) }
      foreach ($child in $permissionChildren) {
        if (-not $child.Completed) {
          try {
            if (-not $child.Process.HasExited) {
              $child.Process.Kill()
              $child.Process.WaitForExit()
              $child.Completed = $true
              $child.Outcome = if ($scenarioFailure -like '*270-second*') { 'TimedOut' } else { 'Cancelled' }
              $child.Process.Dispose()
              throw 'Scenario ended while its owned PermissionRequest relay was still pending; only that child was stopped.'
            }
            Complete-PermissionRelay $child
          }
          catch {
            $permissionResults[$child.ResultKey] = $child.Outcome
            $cleanupErrors.Add("Permission relay cleanup failed for $($child.SessionId): $($_.Exception.Message)")
          }
        }
        if (-not $permissionResults.ContainsKey($child.ResultKey)) { $permissionResults[$child.ResultKey] = $child.Outcome }
      }
      if ($scenarioName -eq 'TwoPendingAlerts') {
        foreach ($key in @('claude:alert-a', 'codex:alert-b')) {
          $label = if ($key.StartsWith('claude:')) { 'Claude' } else { 'Codex' }
          $permissionResult = if ($permissionResults.ContainsKey($key)) { $permissionResults[$key] } else { 'NotStarted' }
          $endResult = if ($sessionEndResults.ContainsKey($key)) { $sessionEndResults[$key] } else { 'Failed' }
          Write-Output "$label permission result: $permissionResult"
          Write-Output "$label SessionEnd $($ids[$key]): $endResult"
        }
      }
      Write-Output "=== Scenario finished: $scenarioName ==="
      if ($cleanupErrors.Count -gt 0) {
        $detail = $cleanupErrors -join ' | '
        if ($scenarioFailure) { $detail = "Scenario failed ($scenarioFailure); cleanup also failed: $detail" }
        $scenarioFailure = if ($scenarioFailure) { "$scenarioFailure; cleanup failed: $detail" } else { "Synthetic session cleanup failed: $detail" }
      }
    }
    if ($scenarioName -eq 'TwoPendingAlerts') {
      if (-not $scenarioFailure -and $permissionResults.Count -eq 2 -and $sessionEndResults.Count -eq 2 -and @($permissionResults.Values | Where-Object { $_ -ne 'ExplicitDeny' }).Count -eq 0 -and @($sessionEndResults.Values | Where-Object { $_ -ne 'RelayDeliveryConfirmed' }).Count -eq 0) {
        Write-Output 'TwoPendingAlerts: SUCCESS (relay delivery confirmed; live GUI cleanup unverified)'
      } elseif ($scenarioFailure -like '*270-second*' -or @($permissionResults.Values | Where-Object { $_ -eq 'TimedOut' }).Count -gt 0) {
        Write-Output 'TwoPendingAlerts: TIMEOUT'
        $script:LiveTestExitCode = 1
      } else {
        Write-Output 'TwoPendingAlerts: FAILED'
        if ($scenarioFailure) { Write-Output "TwoPendingAlerts failure: $scenarioFailure" }
        $script:LiveTestExitCode = 1
      }
    } elseif ($scenarioFailure) {
      $script:LiveTestExitCode = 1
      [Console]::Error.WriteLine($scenarioFailure)
    }
  }
}

# Pester dot-sources this file to exercise its pure scenario/identity helpers.
if ($MyInvocation.InvocationName -ne '.') {
  $script:LiveTestExitCode = 0
  try { Invoke-LiveTest }
  catch {
    if ($Scenario -eq 'TwoPendingAlerts') { Write-Output 'TwoPendingAlerts: FAILED' }
    $script:LiveTestExitCode = 1
    [Console]::Error.WriteLine($_.ToString())
  }
  exit $script:LiveTestExitCode
}

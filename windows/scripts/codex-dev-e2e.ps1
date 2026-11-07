param(
  [ValidateSet('Prepare', 'Run')]
  [string] $Action = 'Prepare'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$homePath = Join-Path $env:LOCALAPPDATA 'Nook\Codex-Dev-E2E'
$hooksPath = Join-Path $PSScriptRoot 'codex-dev-home\hooks.json'
$relayPath = Join-Path $repoRoot 'windows\target-nook-dev\release\nook-hook-dev.exe'

if (-not (Test-Path -LiteralPath $relayPath)) { throw "Dev relay missing: $relayPath. Build Nook Dev first." }
if (-not (Test-Path -LiteralPath $hooksPath)) { throw "Dev hook config missing: $hooksPath" }

New-Item -ItemType Directory -Path $homePath -Force | Out-Null
$hooks = Get-Content -LiteralPath $hooksPath -Raw | ConvertFrom-Json
$relayCommand = '"{0}" --agent codex' -f $relayPath
foreach ($event in @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop')) {
  foreach ($entry in $hooks.hooks.$event) {
    foreach ($hook in $entry.hooks) { $hook.command = $relayCommand }
  }
}
$hooks | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $homePath 'hooks.json') -Encoding utf8
$env:CODEX_HOME = $homePath

if ($Action -eq 'Prepare') {
  Write-Output "Isolated CODEX_HOME: $homePath"
  Write-Output 'No credentials or secrets were copied. This CODEX_HOME contains only hooks.json.'
  Write-Output ('Start Codex manually in this same PowerShell window with: codex -C "{0}"' -f $repoRoot)
  Write-Output 'In Codex, run /hooks, inspect and trust the five nook-hook-dev.exe entries, then send the E2E prompt described in windows/scripts/CODEX-DEV-E2E.md.'
  Write-Output 'The normal Codex auth/config is not inherited. Log in only if you intentionally want to use this isolated Codex home.'
  return
}

throw 'Run action intentionally does not start Codex. Use Prepare, then start the session manually.'

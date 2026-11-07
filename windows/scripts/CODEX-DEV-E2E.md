# Codex CLI → Nook Dev manual E2E

This test uses a separate Codex home at `%LOCALAPPDATA%\Nook\Codex-Dev-E2E`. It does not read, copy, or edit `%USERPROFILE%\.codex`, and it does not send events to the production relay.

## Prepare

1. Build and manually launch **Nook Dev** as the same Windows user. Do not close it during the test.
2. In a fresh PowerShell window, from the repository root, run:

   ```powershell
   .\windows\scripts\codex-dev-e2e.ps1 -Action Prepare
   ```

3. Keep that PowerShell window open. It sets `CODEX_HOME` only in that process environment. Start Codex manually in that same window:

   ```powershell
   codex -C "<checkout-root>"
   ```

   The isolated home has no copied credentials or general `config.toml`. If Codex requires authentication, sign in explicitly within this isolated home only if you intend to use your account there. Do not copy credential files.

4. In Codex, enter `/hooks`. Review the five `nook-hook-dev.exe --agent codex` entries and trust them. Hook trust is required; do not use `--dangerously-bypass-hook-trust`. If the entries are absent, stop and report the Codex version and `/hooks` output.

## Exercise the events

Send this prompt:

> In this workspace, inspect the README and tell me the first heading after the title. Use a read-only shell command if needed; do not edit files.

Expected lifecycle: `SessionStart` when the thread starts; `UserPromptSubmit` for the prompt; `PreToolUse` and `PostToolUse` around a shell/read tool invocation; `Stop` when Codex finishes. If Codex answers without a tool call, send a follow-up asking it to run `Get-Content README.md -TotalCount 3` in PowerShell, still without editing files.

## Verify in Nook Dev

- The Codex session appears in the Dev island with the prompt/working status.
- A tool activity indicator appears while the read-only tool runs and clears after completion.
- The completed response appears and the session returns to its idle/completed state.
- The relay binary used by the config is `nook-hook-dev.exe`; its Dev pipe is `\\.\pipe\nook-dev-<current SID>`.
- This test covers only the listed lifecycle events. It does not test `PermissionRequest`, Approve or Deny.

To rerun, open a new PowerShell window and repeat Prepare. The persistent hook trust is stored only in the isolated Codex home. To remove this test home afterward, remove `%LOCALAPPDATA%\Nook\Codex-Dev-E2E` manually after Codex is closed.
Removing it also deletes any Codex sign-in and hook-trust data created specifically in this test home.

## Safety and limitations

`CODEX_HOME` is an officially supported Codex CLI environment override, and hook discovery reads `hooks.json` from that home. The local CLI help on this machine reports 0.164.0-alpha, not the stated 0.154.0, so the exact target-version behavior and `/hooks` display must be confirmed by the user during the manual test. Do not use this setup with Codex Desktop; it is for CLI launched from the prepared PowerShell process.

The script resolves the checkout root from its own location and substitutes the
Dev relay at `windows\target-nook-dev\release\nook-hook-dev.exe` into the
portable `codex-dev-home/hooks.json` template. This works from checkout paths
that contain spaces; use the quoted `codex -C` command printed by Prepare. The
isolated home does not inherit the normal Codex authentication/configuration
and can require a separate login.

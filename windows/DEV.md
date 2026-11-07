# Nook Dev (Windows)

Build Nook Dev from `windows/`:

```powershell
npm run tauri:build:dev
```

The build script uses an isolated Cargo target directory at
`windows/target-nook-dev`, enables the `nook-dev` feature, supplies the Dev
Tauri config, disables bundling, and checks the executable metadata. It does
not clear or reuse `windows/target`, and it does not create an installer.

The executable is `windows/target-nook-dev/release/nook-dev.exe`. Before first
launch, verify `ProductName` and `FileDescription` are both `Nook Dev`:

```powershell
$exe = Resolve-Path .\target-nook-dev\release\nook-dev.exe
$info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
$info | Select-Object ProductName, FileDescription
if ($info.ProductName -ne 'Nook Dev' -or $info.FileDescription -ne 'Nook Dev') { throw 'Unexpected executable identity' }
```

## Isolation and first launch

- Tauri identifier: `io.github.zubairbinshaukat.nook.dev`.
- Settings: `%APPDATA%\NookDev`; logs and app data: `%LOCALAPPDATA%\NookDev`.
- Windows relay pipe: `\\.\pipe\nook-dev-<user SID>`.
- Linux relay socket: `$XDG_RUNTIME_DIR/nook-dev.sock`; this is deliberately
  separate from production's `nook.sock`.
- Nook Dev does not enable autostart, register global shortcuts, check for
  updates, copy `nook-hook.exe`, or alter Claude, Codex, or Cursor hooks, the
  Claude status line, or reply-format configuration.
- The original Claude hooks, statusLine relay, quota events, and UI remain the
  existing Nook integration; this Dev build adds no separate Claude quota IPC
  receiver, adapter, or wrapper.
- Its NSIS pre-uninstall hook is deliberately empty. Do not switch the Dev
  config to bundled installation without reviewing that hook and its identity.

After verifying the metadata, run the executable manually. Nook Dev may launch
external programs in response to user actions, including an editor, Windows
Terminal with Claude Code, the Claude desktop app, a file manager, or a browser
for links. It does not install or configure those programs. Avoid clicking
actions that launch external programs if that is not wanted.

Nook Dev does not receive events from the existing production hooks. Its
separate pipe is intentionally not written into any agent configuration. Exit
it through its tray menu when finished. Do not use `npm run pack` for Nook Dev.

## Codex quota provider

The provider is off by default. Its opt-in is in Nook Dev Settings → Connect →
Codex. Enabling it starts the discovered Codex Desktop CLI's `app-server` with
the process's inherited environment, including an existing `CODEX_HOME` when
set, or Codex's normal user profile otherwise. App Server may read Codex
configuration, make network requests, and update Codex service files. Nook
does not copy or manually read credentials and does not call login/logout. A
temporary `CODEX_HOME` without existing authorization is not a live quota
substitute and is not used by automated tests.

The Windows CI workflow runs production, Dev, and Standalone feature tests,
the complete frontend suite, and the isolated no-bundle Dev build with its
executable metadata check.

The expanded Home usage card shows separate Claude and Codex usage sections.
Codex's section is available in Dev and Standalone when quota access is enabled
in Connect. The compact Island rotates available Claude and Codex quota pairs
every five seconds; unavailable quota data is not shown as zero.

## Developer diagnostics: GSMTC sessions

From `windows/`, run `./scripts/diagnose-gsmtc-sessions.ps1` to inspect the
current user's Windows media sessions and playback metadata. The script is
read-only: it does not start or stop applications or change settings. Its
output includes the current user's SID, application IDs, and session metadata;
review it locally and do not post full output publicly.

## Synthetic hook event simulator

The Nook Dev build has a compact **Dev event simulator** section at the bottom
of **Settings → Connect**. These controls emit allowlisted synthetic payloads
directly to the Dev Island webview through a Dev-only Tauri command. They do
not use the relay pipe and do not start Claude Code, Codex, or a model turn.

- **Start Claude / Start Codex** sends `SessionStart` with a unique
  `nook-sim:<agent>:<run-id>` session ID.
- **Start both** creates one independent session for each agent.
- **Claude: prompt + tool / Codex: prompt + tool** sends
  `UserPromptSubmit`, `PreToolUse`, and `PostToolUse` for that agent's current
  simulated session (starting one first if needed).
- **Claude: permission (8 s) / Codex: permission (8 s)** shows the ordinary
  Island permission card. Click Allow or Deny to exercise the UI; the reserved
  `nook-sim:req:` request ID is blocked by the frontend bridge, so neither
  choice can reach an agent. Leaving it unanswered clears the simulated card
  after eight seconds.
- **Stop Claude turn / Stop Codex turn** sends `Stop`. It ends the turn and
  leaves the session visible, as a real `Stop` does.
- **End Claude session / End Codex session** sends `SessionEnd` and removes
  that simulated session.
- **Clear simulated sessions** ends all simulator sessions currently tracked
  by the control.

The control is injected only when both the frontend was built with
`NOOK_DEV_BUILD=1` and Rust reports `nookDev: true`. The Rust command is
compiled and registered only with the `nook-dev` feature. Production frontend
builds tree-shake the simulator module and its stylesheet, and production Rust
does not expose the command.

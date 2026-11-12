# Nook Personal Edition 0.2.0

Nook Personal Edition is an independent Windows fork of [Original Nook](https://github.com/zubairbinshaukat/nook). This release adds event-driven Codex quota refresh and context-aware compact usage selection while keeping Personal Edition's separate application identity and per-user data paths.

Release tag: `personal-v0.2.0`. The Personal Edition tag is separate from inherited Original Nook `v*` tags.

## Highlights

- Connect Claude Code through its supported lifecycle hooks and status line. View Claude sessions, permission requests, completions, errors, and 5-hour/7-day usage.
- Connect Codex through its supported hooks. Codex 5-hour/7-day quota access is optional and uses the local Codex App Server `account/rateLimits/read` transport.
- Real Codex turn lifecycle events request quota updates. While Codex is active, a shared scheduler limits ordinary refreshes to once every three minutes; Stop and other turn endings can request a final refresh. Idle Codex does not trigger quota polling or retries.
- In the compact Island, a sole active Claude or Codex agent gets priority. If both are active or both are idle, usable providers rotate every five seconds. Hover freezes the displayed provider. When only one provider has usable quota data, it remains selected.
- Quiet sessions stop counting as active after ten minutes without lifecycle events. This updates compact selection without starting a quota read.
- Improved handling of concurrent Codex sessions, delayed and duplicate lifecycle events, stale quota snapshots, failures, and turn completion.

## Privacy and local processing

Nook has no Nook account or telemetry. Claude integration uses Claude Code's local hooks and status line. Codex hooks deliver events locally, and Codex quota reads use the local Codex App Server. Nook does not send prompts, hook payloads, or quota data to a Nook service. Codex quota access is opt-in in Settings.

## Requirements

- 64-bit Windows with WebView2 Runtime. Windows 11 is the tested platform. Windows 10 has not been tested for this edition.
- Claude Code and/or Codex installed separately for the integrations you use.
- Codex quota access requires Codex CLI 0.165.0 or newer, an available Codex account/session, and the opt-in setting in Nook.
- Claude usage requires Claude Code's status line to be connected to Nook.

## Install or update

1. Download `Nook-Personal-Edition-0.2.0-setup.exe` and `SHA256SUMS.txt` from this GitHub Release.
2. In PowerShell, verify the installer hash:

   ```powershell
   Get-FileHash .\Nook-Personal-Edition-0.2.0-setup.exe -Algorithm SHA256
   ```

   Compare it with the installer entry in `SHA256SUMS.txt`.
3. Exit Nook, then run the installer and follow its prompts. Do not uninstall first; Personal Edition preferences and relay data are stored in per-user locations outside the program directory.
4. Open **Settings → Connect**, choose Claude Code or Codex, review the preview, and confirm the integrations you want. Codex may separately ask you to approve hook trust in Codex itself.

Do not edit or remove hook entries manually. Use **Settings → Connect** to manage Nook's integrations. Personal Edition updates are installed manually; the in-app Original Nook updater is disabled.

The installer is unsigned. Windows may show a SmartScreen warning or unknown-publisher prompt. Verify the download source and checksum, and follow your organization's Windows security policy.

## Known limitations

- Quota values are available only when the corresponding provider returns usable data; unavailable values are not shown as zero.
- Codex hook events begin only after any trust approval Codex requests.
- Claude project or managed status-line settings may take precedence; Connect reports scope conflicts for review.
- The battery provider does not supply a reliable time-to-full estimate.

## Credits and license

Nook was created by **Zubair Bin Shaukat**. Personal Edition is a fork of [Original Nook](https://github.com/zubairbinshaukat/nook). Original project credits and notices are preserved in [`NOTICE`](NOTICE); the code is distributed under the MIT License ([`LICENSE`](LICENSE)). Asset attribution is documented in [`LICENSE-ASSETS.md`](LICENSE-ASSETS.md).

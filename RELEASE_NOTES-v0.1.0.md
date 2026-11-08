# Nook Personal Edition 0.1.0

Nook Personal Edition is an independent Windows fork of [Original Nook](https://github.com/zubairbinshaukat/nook), created by Zubair Bin Shaukat. This first Personal Edition release uses a separate app identity, relay location, and per-user data paths.

## Highlights

- Claude Code and Codex session activity in the compact island and expanded Home.
- Permission requests, important errors, completion cards, completion sounds, and session navigation.
- Claude Code 5-hour and 7-day usage through Claude's status line.
- Opt-in Codex 5-hour and 7-day usage through the local Codex App Server provider.
- A compact quota indicator that rotates between available Claude and Codex data every five seconds.
- Clock and battery status in the compact island after five minutes without relevant activity.
- Gullu, themes and colors, English and Ukrainian localization, and optional Windows sign-in startup.
- Settings → Connect previews Claude Code and Codex configuration changes and backs up files before confirmed changes.

## Requirements

- Windows 10 or Windows 11, 64-bit, with WebView2 Runtime.
- Claude Code and/or Codex installed separately to use the corresponding integration.
- Codex usage quotas require Codex CLI 0.165.0 or newer, an available Codex session/quota response, and the quota opt-in in Settings.
- Claude usage requires Claude Code's status line to be connected to Nook.

## Install

1. Download `Nook-Personal-Edition-0.1.0-setup.exe` and `SHA256SUMS.txt` from this GitHub Release.
2. Verify the installer with the SHA-256 listed in `SHA256SUMS.txt` before running it.
3. Run the installer and follow its prompts.
4. In Nook, open **Settings → Connect**, choose Claude Code or Codex, review the preview, and confirm the desired changes. Codex may separately ask you to approve its hook trust; that approval must happen in Codex.

Do not edit or delete Claude/Codex hook entries manually. Use **Settings → Connect** to manage Nook's integration.

## Updating from an earlier Personal Edition

Personal Edition has no in-app updater. Download the newer installer and checksum from the `valenticus/nook` Releases page, verify the hash, exit Nook, and run the installer over the existing Personal Edition installation. Avoid uninstalling first. Preferences and relay data are stored in per-user application data locations outside the program files directory.

## Known limitations

- The battery provider does not supply a reliable time-to-full estimate, so Nook does not display one.
- Claude project or managed status-line settings may take precedence. Connect reports scope conflicts; those settings are not silently changed.
- Codex hooks require Codex's own trust approval when requested. Nook does not bypass that approval.
- Quota data is shown only when the relevant provider returns usable data; unavailable values are not treated as zero.
- Updates must be downloaded and installed manually from the Personal Edition Releases page.

## Windows security

The installer is currently **unsigned**. Windows may display a SmartScreen warning or an unknown-publisher prompt. Verify the download source and checksum before running it. Managed Windows policy may prevent unsigned software from running.

## Credits and license

Nook was created by **Zubair Bin Shaukat**. Personal Edition is a fork of [Original Nook](https://github.com/zubairbinshaukat/nook); Original Nook's history and credits are preserved in [NOTICE](https://github.com/valenticus/nook/blob/develop/NOTICE). The code is distributed under the MIT License ([LICENSE](https://github.com/valenticus/nook/blob/develop/LICENSE)). Asset attribution is documented in [LICENSE-ASSETS.md](https://github.com/valenticus/nook/blob/develop/LICENSE-ASSETS.md).

# Nook Personal Edition

**Nook Personal Edition 0.1.0** is a personal fork of [Nook](https://github.com/zubairbinshaukat/nook), the Windows desktop island created by **Zubair Bin Shaukat**. It has its own application identity and per-user data paths, so it can be installed separately from Original Nook.

Nook brings Claude Code and Codex sessions, usage limits, permission requests, and completion status into a compact Windows island. Connect agents from **Settings → Connect**; Nook previews configuration changes and creates backups before applying them.

See the [0.1.0 release notes](RELEASE_NOTES-v0.1.0.md).

[![Download](https://img.shields.io/github/v/release/valenticus/nook?style=for-the-badge&label=Download&color=3ddc97&labelColor=0b0d10)](https://github.com/valenticus/nook/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-3ddc97?style=flat-square)](LICENSE)
[![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4?style=flat-square&logo=windows11&logoColor=white)](#requirements)

Nook Personal Edition is an independent fork and is not affiliated with or endorsed by Anthropic, OpenAI, or the original Nook author.

## Features

- **Claude Code and Codex sessions:** see activity, waiting requests, errors, and completed turns in the island.
- **Permission requests:** review and answer supported requests from Nook. Codex may require a separate trust approval in Codex itself.
- **Usage limits:** Claude Code 5-hour and 7-day limits through Claude's status line; Codex 5-hour and 7-day limits through the local Codex App Server provider. Codex quota access is opt-in in Settings.
- **Compact quota indicators:** when both providers have usable data, the compact island rotates between Claude and Codex every five seconds. Missing values are not shown as zero.
- **Idle clock and battery:** after five minutes without relevant activity, the compact island can show local time and available battery/charging status. Nook does not estimate time to full charge when Windows provides no reliable value.
- **Gullu, themes, and colors:** the animated companion and appearance options are available in Settings.
- **Completion and important alerts:** completed turns use a temporary card and sound; permission requests and important errors remain visible for attention.
- **English and Ukrainian:** choose a language in Settings or follow the system language.
- **Windows sign-in startup:** enable automatic startup from Settings if desired.

## Requirements

- Windows 10 or Windows 11, 64-bit.
- WebView2 Runtime, included with supported Windows installations.
- Claude Code and/or Codex installed separately for the corresponding agent integration.
- For Codex usage quotas, Codex CLI 0.165.0 or newer and an available Codex account/session. Quota access must be enabled in Nook Settings.
- Claude usage limits require Claude Code's status line to be connected to Nook. A project or managed status-line override may take precedence; Connect reports scope conflicts for review.

Nook does not require an account of its own. It does not provide Claude or Codex access or credentials.

## Install

1. Download `Nook-Personal-Edition-0.1.0-setup.exe` and `SHA256SUMS.txt` from the [Nook Personal Edition releases](https://github.com/valenticus/nook/releases/latest).
2. Verify the installer hash in PowerShell:

   ```powershell
   Get-FileHash .\Nook-Personal-Edition-0.1.0-setup.exe -Algorithm SHA256
   ```

   Compare the SHA-256 value with the installer entry in `SHA256SUMS.txt`.
3. Run the installer and follow its prompts. The installer is currently unsigned; see [Windows security notice](#windows-security-notice).
4. Open **Settings → Connect**, choose Claude Code or Codex, review the preview, and confirm only the changes you want. Nook handles its hook configuration; do not edit or delete hook entries manually.
5. Codex can ask you to trust its newly detected hooks. Review and approve that request in Codex itself; Nook does not bypass Codex trust.
6. To start Nook when you sign in to Windows, enable **Start Nook with your computer** in Settings.

Claude sessions and usage statistics are separate Connect options. Claude usage requires its status line; the preview explains any scope conflict before changes are applied. Third-party and unknown configuration entries are preserved.

## Updating

The Original Nook updater is disabled in Personal Edition. Updates are manual:

1. Download the newer Personal Edition installer and its checksum from the [Personal Edition Releases page](https://github.com/valenticus/nook/releases/latest).
2. Verify the installer hash before running it.
3. Exit Nook, then run the new installer over the existing Personal Edition installation. Do not uninstall first if you want to keep the existing installation and settings.

Personal Edition stores its settings and relay data in separate per-user application data folders rather than inside the program files directory.

## Known limitations

- Nook cannot show a trustworthy estimated time to full charge unless Windows supplies one; the current battery provider does not provide that estimate.
- Codex hook delivery starts only after Codex's own trust approval when requested. Codex usage quotas require the supported CLI, an available quota response, and the opt-in setting.
- Claude usage can be affected by a higher-priority project or managed status-line configuration. Nook shows the conflict for review and does not silently modify those settings.
- There is no in-app updater. Check the Personal Edition Releases page for updates and verify each download with its published checksum.
- Windows may warn about the unsigned installer. See below.

## Windows security notice

The installer is not digitally signed. Windows SmartScreen may show **“Windows protected your PC”** or identify the publisher as unknown. Verify that the installer came from the `valenticus/nook` Personal Edition release page and that its SHA-256 matches the release checksum. Follow your organization’s security policy; Nook does not ask you to bypass managed Windows protections.

## Privacy and configuration safety

Nook runs locally and connects to agent integrations through their supported hooks and local Codex App Server. Connect shows a preview and takes a backup before applying supported changes. Use **Settings → Connect** to connect or disconnect Nook; do not remove hook entries by hand. Codex usage access is optional.

## Credits and license

Nook was created by **Zubair Bin Shaukat**. Personal Edition is a separate fork of the [Original Nook repository](https://github.com/zubairbinshaukat/nook). Original project credits and third-party notices are preserved in [`NOTICE`](NOTICE), and the code is distributed under the MIT License in [`LICENSE`](LICENSE). Asset notices are in [`LICENSE-ASSETS.md`](LICENSE-ASSETS.md).

# Codex in VS Code: Dev hook connection proposal

The installed VS Code extension (`openai.chatgpt` 26.1021.22027) starts its bundled `codex.exe` as an `app-server` child process. Its process inherits `CODEX_HOME`; if unset, Codex resolves the normal `%USERPROFILE%\.codex` home. The extension bundle subscribes to `hook/started` and `hook/completed` app-server events. It does not expose the CLI `/hooks` command or the app-server hooks list RPC in its bundled UI code, so trust and execution in VS Code still need a manual confirmation.

## Proposed isolated delivery

Codex loads hooks from both the user home and trusted project `.codex` layer. Those sources are additive. A project hook layer in this repository can therefore deliver one copy to `nook-hook-dev.exe` while leaving the existing global production hook entry in place. The production relay continues to receive its normal copy; Dev has its own `nook-dev-<SID>` pipe. No global config or production files need modification.

The inactive portable template is `codex-dev-home/hooks.json`. It is outside
the project `.codex/` directory, so it does not activate when a repository
opens. It contains the `__NOOK_DEV_RELAY__` placeholder; substitute it with the
quoted, locally resolved relay executable path before any explicit opt-in.
Then copy the rendered file to `<workspace>/.codex/hooks.json` and review/trust
those project hooks in a Codex-supported UI. The five configured events are
SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and Stop.

## Checks required before enabling

1. Confirm the VS Code workspace root is the intended checkout and the Dev relay exists at the configured path.
2. Confirm the extension's hook trust UI for this exact version. Do not assume `/hooks` exists in its UI; the extension bundle inspected here contains app-server hook event subscriptions but no `hooks/list` string or `/hooks` command surface.
3. Review the five commands. They only invoke `nook-hook-dev.exe`; after trust, ordinary VS Code Codex use should run them from the extension's app-server process without manually launching a CLI or changing `CODEX_HOME`.
4. Confirm Nook Dev is running as the same Windows user. The Dev relay itself is fixed at build time to `\\.\pipe\nook-dev-<SID>`.
5. Observe a real VS Code session before calling the integration complete. The template is inactive until explicitly rendered and copied; do not change a real project configuration without approval.

If the extension offers no supported way to trust project hooks, do not add the project config as a workaround: a global dual-delivery opt-in would need separate user approval and an explicit review flow.

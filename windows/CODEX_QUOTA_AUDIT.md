# Codex Quota Provider — audit notes

## Scope and isolation

The quota provider, polling task, opt-in setting, and Tauri snapshot command
are compiled with either the `nook-dev` or `nook-standalone` Cargo feature. Polling is disabled by
default and starts only after explicit opt-in. Tests use in-memory streams or
the Rust test executable as a local mock child; they do not launch Codex CLI or
App Server, contact a Codex backend, start model turns, read credentials or
real sessions, or write to application data or agent configuration.

The original Claude integration is unchanged: its production hooks, statusLine
relay, quota events, and existing UI remain in place. The experimental
Dev-only Claude quota receiver, adapter, wrapper, settings UI, and installer
helper have been removed. No production hooks, authorization, or agent
configuration were changed for the Codex provider.

When enabled, Codex App Server inherits the Nook Dev or Standalone process environment and
may use an existing `CODEX_HOME` or Codex's normal user profile. It may read
Codex configuration, make network requests, and update Codex service files.
Nook does not copy tokens, inspect auth files, or run login/logout. A temporary
`CODEX_HOME` without authorization is not a live quota substitute. The setting
remains off until the user opts in.

## Protocol and behavior

- JSONL handshake uses `initialize`, `initialized`, and
  `account/rateLimits/read`. The confirmed request retains `params: {}` and
  does not send a `jsonrpc` version envelope.
- Parsing follows `result.rateLimits` and its sibling
  `result.rateLimitsByLimitId.codex`. Responses are correlated by request ID;
  notifications and server-initiated requests are handled separately.
- The parser identifies 5h and 7d windows by `windowDurationMins` 300 and
  10080, not field order, and converts `resetsAt` Unix seconds to milliseconds.
- Discovery supports the version-hash Codex Desktop path under
  `%LOCALAPPDATA%\OpenAI\Codex\bin\<version-hash>\codex.exe`, retains
  candidate priorities, rejects command scripts, restricts trusted roots,
  and checks the minimum CLI version.
- Windows child process cleanup uses a kill-on-close Job Object and fails
  closed when required process isolation cannot be established. Timeout tests
  verify mock-child termination and unrelated-child survival.
- Dev's Linux relay socket is `nook-dev.sock`, deliberately distinct from the
  production `nook.sock`; the Windows named pipe also has its Dev namespace.
- Normalized snapshots have a bounded TTL, omit windows after their reset,
  and expose fresh/stale/unavailable states. Polling has a ten-minute minimum
  interval, bounded failure backoff, and a concurrency gate.
- Public errors are allowlisted reason codes. Raw protocol messages, stderr,
  account IDs, tokens, and credentials are not retained or exposed.
- `Unauthorized` currently maps the App Server error code `-32001`; this was
  tested only with synthetic protocol data and has not been confirmed against
  a real App Server response.
- The Settings diagnostic is shown in Dev and Standalone. It
  reads the existing typed `codex-quota` event and an in-memory snapshot
  command; that command cannot initiate another App Server request.

## Test coverage

The Rust tests in `codex_quota::tests` cover:

- Successful JSONL exchange, notifications, out-of-order responses by ID, and
  server-initiated requests.
- Independent protocol fixture parsing, sibling limit map, 5h/7d window
  selection, and timestamp conversion.
- Missing, malformed, out-of-range, null, and expired windows.
- Authorization refusal, early server exit, timeout, cleanup, and safe error
  reasons.
- Concurrent polling protection, minimum interval, bounded backoff,
  default-disabled behavior, and snapshot freshness/TTL.
- CLI discovery priority, Desktop version-hash paths, trusted roots, and
  minimum version.
- No secret or raw-message data in normalized snapshots or failure output.

The TypeScript UI tests cover Disabled, Loading, Fresh, Stale, and Unavailable
Codex diagnostics, local reset/update times, safe failure codes, and absent
windows. The complete supported frontend test suite is wired into Windows CI.

## Verification

Historical verification after removal of the experimental Claude quota infrastructure
(counts predate later Personal Edition tests):

- `cargo test --workspace` — passed: 236 app tests passed, 1 ignored; relay
  crate: 53 passed.
- `cargo test --workspace --features nook-dev` — passed: 253 app tests passed,
  1 ignored; relay crate: 53 passed. This includes the Codex provider mock
  protocol, lifecycle, timeout, and process cleanup tests.
- `cargo clippy --workspace --all-targets -- -D warnings` — passed.
- `cargo clippy --workspace --all-targets --features nook-dev -- -D warnings`
  — passed.
- `npm run build` — passed (TypeScript check and Vite build; no app launched).
- `npm run test:codex-quota-view` — passed: all 5 diagnostic state tests.
- `git diff --check` — passed after cleanup.

The shell invoked Cargo and npm through their installed executables because
the interactive PowerShell PATH did not expose those commands. No global PATH
or project configuration was changed.

## Residual risks

- Live interoperability with real Codex Desktop/App Server is intentionally
  not tested in automated verification. Protocol tests use mock data.
- Executable discovery checks canonical trusted paths and version, but does
  not validate Authenticode signatures.
- The Windows Job Object process-assignment boundary and long-running behavior
  across suspend/resume and system clock changes remain outside automated
  integration coverage.
- An explicit live opt-in can cause App Server network activity and changes to
  the user's own Codex service files, as described above.

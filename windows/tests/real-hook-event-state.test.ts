import assert from "node:assert/strict";
import test from "node:test";

const timers = new Map<number, { run: () => void; delay: number }>();
let timerId = 1;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    setTimeout(fn: () => void, delay = 0) { const id = timerId++; timers.set(id, { run: fn, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener() {},
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { addEventListener() {}, visibilityState: "visible" },
});
Object.defineProperty(globalThis, "__nookDevBuildFlag", { configurable: true, value: true });

const [{ handleHook }, { State, CLAUDE_ID }, { waitingCount }, { TOOL_NAME }, completionEvents, { reading }, { navigateToSessionTarget }, { Sound }] = await Promise.all([
  import("../src/island/hooks.ts"),
  import("../src/core/state.ts"),
  import("../src/views/roster.ts"),
  import("../src/views/tool.ts"),
  import("../src/core/completion-events.ts"),
  import("../src/island/compact.ts"),
  import("../src/core/session-navigation.ts"),
  import("../src/core/sound.ts"),
]);

const island = { alert() {}, reveal() {}, setView() {}, afterRequest() {} };

function reset() {
  State.sessions.splice(0);
  State.changes.clear();
  State.tasks.splice(0);
  State.frontId = "";
  State.focusId = CLAUDE_ID;
  State.mode = "compact";
  State.view = "overview";
  State.paused = false;
  State.settings.showCodexSessions = true;
  timers.clear();
  State.loadIntegrationTasks();
}

function deliver(agent: "claude" | "codex", event: string, sessionId: string, extra: Record<string, unknown> = {}, targetIsland = island) {
  handleHook(targetIsland as never, {
    hook_event_name: event,
    session_id: agent === "codex" ? `codex:${sessionId}` : sessionId,
    nook_tool: agent,
    cwd: "C:\\NookFixture",
    ...extra,
  });
}

test("normalized Claude and Codex events maintain independent lifecycle state", () => {
  reset();
  deliver("claude", "SessionStart", "fixture-c-1");
  deliver("codex", "SessionStart", "fixture-x-1");
  deliver("claude", "UserPromptSubmit", "fixture-c-1", { prompt: "synthetic prompt" });
  deliver("codex", "UserPromptSubmit", "fixture-x-1", { prompt: "synthetic prompt" });
  deliver("claude", "PreToolUse", "fixture-c-1", { tool_name: "Read", tool_input: { file_path: "fixture.txt" } });
  deliver("codex", "PreToolUse", "fixture-x-1", { tool_name: "Bash", tool_input: { command: "echo fixture-only" } });
  deliver("claude", "PostToolUse", "fixture-c-1", { tool_name: "Read" });
  deliver("codex", "PostToolUse", "fixture-x-1", { tool_name: "Bash" });

  assert.deepEqual(State.sessions.map((session) => [session.id, session.agent]), [
    ["fixture-c-1", "claude"],
    ["codex:fixture-x-1", "codex"],
  ]);
  assert.ok(State.sessions.every((session) => session.state === "working"));

  deliver("claude", "Stop", "fixture-c-1", { last_message: "synthetic completion" });
  deliver("codex", "Stop", "fixture-x-1", { last_assistant_message: "synthetic completion" });
  assert.ok(State.sessions.every((session) => session.state === "finished"));
  deliver("claude", "SessionEnd", "fixture-c-1", { reason: "other" });
  assert.deepEqual(State.sessions.map((session) => session.id), ["codex:fixture-x-1"]);
});

test("same external session id cannot merge Claude, Codex, or unknown agents", () => {
  reset();
  handleHook(island as never, { hook_event_name: "SessionStart", session_id: "same-id", nook_tool: "claude" });
  handleHook(island as never, { hook_event_name: "SessionStart", session_id: "same-id", nook_tool: "codex" });
  handleHook(island as never, { hook_event_name: "SessionStart", session_id: "same-id" });
  assert.deepEqual(State.sessions.map((session) => session.agent), ["claude", "codex", "unknown"]);
});

test("completion survives folding, deduplicates Stop, and clears on new prompt", () => {
  reset();
  const play = Sound.play.bind(Sound);
  const finishSounds: string[] = [];
  Sound.play = (name: string) => { if (name === "finish") finishSounds.push(name); return true; };
  deliver("codex", "SessionStart", "fixture-completion");
  deliver("codex", "UserPromptSubmit", "fixture-completion", { turn_id: "turn-1", prompt: "work" });
  deliver("codex", "Stop", "fixture-completion", { turn_id: "turn-1", last_message: "done" });
  const session = State.session;
  assert.equal(session.completionPending, true);
  assert.equal(State.defaultView(), "finished");
  const stepCount = session.steps.length;
  deliver("codex", "Stop", "fixture-completion", { turn_id: "turn-1", last_message: "done" });
  assert.equal(session.steps.length, stepCount);
  assert.equal(session.completionPending, true);
  assert.deepEqual(finishSounds, ["finish"]);
  deliver("codex", "UserPromptSubmit", "fixture-completion", { turn_id: "turn-2", prompt: "again" });
  assert.equal(session.completionPending, false);
  assert.equal(State.defaultView(), "overview");
  Sound.play = play;
});

test("a Stop without tool identity remains Unknown", () => {
  reset();
  handleHook(island as never, { hook_event_name: "SessionStart", session_id: "unknown-agent" });
  handleHook(island as never, { hook_event_name: "Stop", session_id: "unknown-agent", last_message: "done" });
  assert.equal(State.session.agent, "unknown");
  assert.equal(TOOL_NAME[State.session.agent], "Unknown");
  assert.equal(State.defaultView(), "finished");
});

test("completion does not affect the bell count, which remains for pending requests", () => {
  reset();
  deliver("claude", "SessionStart", "same-session-id");
  deliver("codex", "SessionStart", "same-session-id");
  deliver("claude", "UserPromptSubmit", "same-session-id", { prompt: "Claude task" });
  deliver("codex", "UserPromptSubmit", "same-session-id", { turn_id: "codex-turn", prompt: "Codex task" });
  deliver("claude", "Stop", "same-session-id", { last_message: "Claude done" });
  deliver("codex", "Stop", "same-session-id", { turn_id: "codex-turn", last_message: "Codex done" });

  assert.equal(reading("waiting", { usage: null, waiting: 4 }).text, "4");
  assert.equal(State.sessions.every((session) => session.completionPending), true);
});

test("completion metadata is memory-only and legacy inbox storage is cleared without touching other keys", () => {
  reset();
  const legacyKey = "nook.completion-notifications.dev.v1";
  const productionLegacyKey = "nook.completion-notifications.production.v1";
  const otherKey = "nook.settings.dev.v1";
  const stored = new Map([[legacyKey, "old completion data"], [productionLegacyKey, "old completion data"], [otherKey, "settings"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { removeItem: (key: string) => stored.delete(key) } });
  completionEvents.clearLegacyCompletionNotifications();
  assert.equal(stored.has(legacyKey), false);
  assert.equal(stored.has(productionLegacyKey), false);
  assert.equal(stored.get(otherKey), "settings");
  assert.equal(completionEvents.hasCompletionEvent("codex", "s", "turn"), false);
  completionEvents.recordCompletionEvent("codex", "s", "turn");
  assert.equal(completionEvents.hasCompletionEvent("codex", "s", "turn"), true);
  assert.equal(completionEvents.recordCompletionEvent("codex", "s", "turn"), false);
  completionEvents.beginCompletionTurn("codex", "s");
  assert.equal(completionEvents.hasCompletionEvent("codex", "s", "turn"), false);
});

test("target navigation opens the exact session without completion read state", async () => {
  reset();
  deliver("claude", "SessionStart", "open-target", { target: { kind: "vscode", label: "VS Code", tabbed: false } });
  deliver("claude", "Stop", "open-target", { last_message: "completion reply" });
  const session = State.sessions[0];
  const navigated: string[] = [];
  assert.equal(await navigateToSessionTarget(session, async (id) => { navigated.push(id); return true; }), true);
  assert.deepEqual(navigated, ["open-target"]);
  assert.equal(session.completionPending, true);
});

test("failed target navigation leaves session state available", async () => {
  reset();
  deliver("codex", "SessionStart", "failed-target");
  deliver("codex", "Stop", "failed-target", { last_message: "completion reply" });
  const session = State.sessions[0];
  assert.equal(await navigateToSessionTarget(session, async () => false), false);
  assert.equal(session.completionPending, true);
});

test("duplicate target clicks share one in-flight navigation", async () => {
  reset();
  deliver("claude", "SessionStart", "duplicate-target", { target: { kind: "vscode", label: "VS Code", tabbed: false } });
  deliver("claude", "Stop", "duplicate-target", { last_message: "completion reply" });
  const session = State.sessions[0];
  let finish!: (succeeded: boolean) => void;
  let calls = 0;
  const navigation = new Promise<boolean>((resolve) => { finish = resolve; });
  const first = navigateToSessionTarget(session, async () => { calls++; return navigation; });
  const duplicate = await navigateToSessionTarget(session, async () => { calls++; return true; });
  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  finish(true);
  assert.equal(await first, true);
});

test("agent lifecycle events reset Idle while quota refresh does not", () => {
  reset();
  State.lastAgentEventAt = 1234;
  State.setCodexQuota(null);
  State.setUsage(null);
  assert.equal(State.lastAgentEventAt, 1234);
  deliver("claude", "SessionStart", "fixture-idle-clock");
  assert.ok(State.lastAgentEventAt > 1234);
  const last = State.lastAgentEventAt;
  deliver("claude", "SessionEnd", "fixture-idle-clock");
  assert.ok(State.lastAgentEventAt >= last);
});

test("synthetic permission payload is represented as waiting without performing an action", () => {
  reset();
  deliver("codex", "SessionStart", "fixture-x-permission");
  deliver("codex", "PermissionRequest", "fixture-x-permission", {
    request_id: "test-request-only",
    tool_name: "Bash",
    tool_input: { command: "echo fixture-only" },
    nook_test_deny_only: true,
  });
  assert.equal(waitingCount(), 1);
  assert.equal(State.session.approval?.requestId, "test-request-only");
  assert.equal(State.session.approval?.command, "Bash · echo fixture-only");
  assert.equal(State.session.approval?.denyOnly, true);
  // With no Tauri runtime the bridge command is a no-op; this test never
  // approves or executes the fixture command.
  assert.equal(timers.size, 1);
  reset();
});

test("TwoPendingAlerts keeps independent deny-only requests and counts 2 to 1 to 0", () => {
  reset();
  deliver("claude", "SessionStart", "nook-test:two-pending-alerts:claude:run-1");
  deliver("claude", "PermissionRequest", "nook-test:two-pending-alerts:claude:run-1", {
    request_id: "manual-claude", tool_name: "Bash", tool_input: { command: "echo fixture-only" },
    nook_test_deny_only: true, nook_test_manual_alert: true,
  });
  assert.equal(waitingCount(), 1);

  deliver("codex", "SessionStart", "nook-test:two-pending-alerts:codex:run-1");
  deliver("codex", "PermissionRequest", "nook-test:two-pending-alerts:codex:run-1", {
    turn_id: "manual-turn", request_id: "manual-codex", tool_name: "Bash", tool_input: { command: "echo fixture-only" },
    nook_test_deny_only: true, nook_test_manual_alert: true,
  });
  const claude = State.sessions.find((session) => session.id === "nook-test:two-pending-alerts:claude:run-1")!;
  const codex = State.sessions.find((session) => session.id === "codex:nook-test:two-pending-alerts:codex:run-1")!;
  assert.equal(waitingCount(), 2);
  assert.equal(claude.approval?.denyOnly, true);
  assert.equal(codex.approval?.denyOnly, true);
  assert.deepEqual([...timers.values()].map((timer) => timer.delay), [270_000, 270_000]);

  // Model the original Island's Deny action settling only the front request;
  // the other session remains pending and contributes to the actual roster metric.
  claude.approval = null;
  State.present();
  assert.equal(waitingCount(), 1);
  assert.equal(codex.approval?.requestId, "manual-codex");
  codex.approval = null;
  State.present();
  assert.equal(waitingCount(), 0);
  assert.equal(State.sessions.length, 2);
  assert.equal(timers.size, 2, "visual presentation does not resolve or shorten the bounded test requests");

  // A Deny only resolves each request. The two supported SessionEnd events
  // remove precisely this run's sessions and cancel their remaining timers.
  deliver("claude", "SessionEnd", "nook-test:two-pending-alerts:claude:run-1");
  deliver("codex", "SessionEnd", "nook-test:two-pending-alerts:codex:run-1");
  assert.equal(waitingCount(), 0);
  assert.equal(State.sessions.some((session) => session.id.startsWith("nook-test:two-pending-alerts:")), false);
  reset();
});

test("TwoPendingAlerts timeout cleanup ends both normalized synthetic sessions only", () => {
  reset();
  deliver("claude", "SessionStart", "nook-test:two-pending-alerts:claude:timeout-run");
  deliver("codex", "SessionStart", "nook-test:two-pending-alerts:codex:timeout-run");
  deliver("claude", "PermissionRequest", "nook-test:two-pending-alerts:claude:timeout-run", {
    request_id: "timeout-claude", tool_name: "Bash", tool_input: { command: "echo fixture-only" }, nook_test_deny_only: true,
  });
  deliver("codex", "PermissionRequest", "nook-test:two-pending-alerts:codex:timeout-run", {
    turn_id: "timeout-turn", request_id: "timeout-codex", tool_name: "Bash", tool_input: { command: "echo fixture-only" }, nook_test_deny_only: true,
  });
  deliver("claude", "SessionStart", "real-session-must-stay");
  assert.equal(waitingCount(), 2);

  // The relay normalizes Codex IDs before both start and end reach the reducer.
  deliver("claude", "SessionEnd", "nook-test:two-pending-alerts:claude:timeout-run");
  deliver("codex", "SessionEnd", "nook-test:two-pending-alerts:codex:timeout-run");
  assert.equal(waitingCount(), 0);
  assert.deepEqual(State.sessions.map((session) => session.id), ["real-session-must-stay"]);
  assert.equal(timers.size, 0);
});

test("Notification question text is not a permission card and SessionEnd clears its state", () => {
  reset();
  deliver("claude", "SessionStart", "fixture-notification");
  deliver("claude", "Notification", "fixture-notification", { message: "Synthetic notification question?" });
  assert.equal(State.sessions[0].state, "question");
  assert.equal(State.sessions[0].approval, null);
  assert.equal(State.sessions[0].question, null);
  assert.equal(waitingCount(), 0);
  deliver("claude", "SessionEnd", "fixture-notification");
  assert.equal(State.sessions.length, 0);
});

test("deny-only Dev request timeout drops the card and its waiting count", () => {
  reset();
  deliver("claude", "SessionStart", "fixture-timeout");
  deliver("claude", "PermissionRequest", "fixture-timeout", {
    request_id: "timeout-request", tool_name: "Bash", tool_input: { command: "echo fixture-only" }, nook_test_deny_only: true,
  });
  assert.equal(waitingCount(), 1);
  assert.equal(timers.size, 1);
  const expire = [...timers.values()][0]!.run;
  expire();
  assert.equal(waitingCount(), 0);
  assert.equal(State.session.approval, null);
  assert.equal(timers.size, 0);
  reset();
});

test("Codex Stop closes only its turn and rejects late events without ending the session", () => {
  reset();
  deliver("codex", "SessionStart", "fixture-stop");
  deliver("codex", "UserPromptSubmit", "fixture-stop", { turn_id: "turn-1", prompt: "first" });
  deliver("codex", "Stop", "fixture-stop", { turn_id: "turn-1", last_message: "done" });
  const session = State.sessions[0];
  assert.equal(session.state, "finished");
  assert.equal(session.codexTurnId, null);
  assert.deepEqual(session.closedCodexTurns, ["turn-1"]);
  const stepCount = session.steps.length;
  deliver("codex", "PreToolUse", "fixture-stop", { turn_id: "turn-1", tool_name: "Bash", tool_input: { command: "stale" } });
  assert.equal(session.steps.length, stepCount);
  // A later turn reuses the same session and becomes active independently.
  deliver("codex", "UserPromptSubmit", "fixture-stop", { turn_id: "turn-2", prompt: "second" });
  assert.equal(session.codexTurnId, "turn-2");
  assert.equal(State.sessions.length, 1);
});

test("Codex Interrupt neutralizes only its turn and its pending permission", () => {
  reset();
  deliver("codex", "SessionStart", "fixture-interrupt");
  deliver("codex", "UserPromptSubmit", "fixture-interrupt", { turn_id: "turn-a", prompt: "working" });
  deliver("codex", "PreToolUse", "fixture-interrupt", { turn_id: "turn-a", tool_name: "Bash", tool_input: { command: "fixture-only" } });
  deliver("codex", "PermissionRequest", "fixture-interrupt", {
    turn_id: "turn-a", request_id: "interrupt-request", tool_name: "Bash", tool_input: { command: "fixture-only" },
  });
  assert.equal(waitingCount(), 1);
  deliver("codex", "Interrupt", "fixture-interrupt", { turn_id: "turn-a" });
  const session = State.sessions[0];
  assert.equal(waitingCount(), 0);
  assert.equal(session.codexTurnId, null);
  assert.equal(session.state, "idle");
  assert.ok(session.steps.some((step) => step.turnId === "turn-a" && step.state === "interrupted"));
  assert.equal(session.state === "finished", false);
});

test("Codex compaction never creates or completes a session, and SessionEnd removes only its session", () => {
  reset();
  deliver("codex", "PreCompact", "unknown-compaction", { turn_id: "turn-0", trigger: "auto" });
  assert.equal(State.sessions.length, 0);
  deliver("codex", "SessionStart", "fixture-end-a");
  deliver("codex", "SessionStart", "fixture-end-b");
  deliver("codex", "UserPromptSubmit", "fixture-end-a", { turn_id: "turn-a", prompt: "active" });
  deliver("codex", "PreCompact", "fixture-end-a", { turn_id: "turn-a", trigger: "auto" });
  assert.equal(State.sessions.find((session) => session.id === "codex:fixture-end-a")?.state, "thinking");
  deliver("codex", "SessionEnd", "fixture-end-a");
  assert.deepEqual(State.sessions.map((session) => session.id), ["codex:fixture-end-b"]);
  deliver("codex", "UserPromptSubmit", "fixture-end-a", { turn_id: "turn-late", prompt: "late" });
  assert.deepEqual(State.sessions.map((session) => session.id), ["codex:fixture-end-b"]);
});

test("SessionEnd removes only its session, releases its interactions, and closes its card path", () => {
  reset();
  const cardTransitions: boolean[] = [];
  const sessionIsland = { ...island, afterRequest(show: boolean) { cardTransitions.push(show); } };
  deliver("codex", "SessionStart", "fixture-clean-a");
  deliver("codex", "UserPromptSubmit", "fixture-clean-a", { turn_id: "turn-clean-a", prompt: "waiting A" });
  deliver("codex", "SessionStart", "fixture-clean-b");
  deliver("codex", "UserPromptSubmit", "fixture-clean-b", { turn_id: "turn-clean-b", prompt: "waiting B" });
  deliver("claude", "SessionStart", "fixture-clean-claude");
  const a = State.sessions.find((session) => session.id === "codex:fixture-clean-a")!;
  const b = State.sessions.find((session) => session.id === "codex:fixture-clean-b")!;
  State.frontId = a.id;
  State.view = "approval";
  deliver("codex", "PermissionRequest", "fixture-clean-a", {
    turn_id: "turn-clean-a", request_id: "request-clean-a", tool_name: "Bash", tool_input: { command: "fixture-only" },
  }, sessionIsland);
  deliver("codex", "PermissionRequest", "fixture-clean-b", {
    turn_id: "turn-clean-b", request_id: "request-clean-b", tool_name: "Bash", tool_input: { command: "fixture-only" },
  }, sessionIsland);
  assert.equal(waitingCount(), 2);
  assert.equal(timers.size, 2);

  deliver("codex", "SessionEnd", "fixture-clean-a", {}, sessionIsland);
  assert.deepEqual(State.sessions.map((session) => session.id).sort(), ["codex:fixture-clean-b", "fixture-clean-claude"].sort());
  assert.equal(waitingCount(), 1);
  assert.equal(b.approval?.requestId, "request-clean-b");
  assert.equal(timers.size, 1);
  assert.equal(State.frontId, b.id);
  assert.deepEqual(cardTransitions, [true]);

  // Duplicate end and delayed hooks from A cannot restore it or affect B.
  deliver("codex", "SessionEnd", "fixture-clean-a", {}, sessionIsland);
  deliver("codex", "PostToolUse", "fixture-clean-a", { turn_id: "turn-clean-a", tool_name: "Bash" }, sessionIsland);
  assert.equal(State.sessions.some((session) => session.id === a.id), false);
  assert.equal(b.approval?.requestId, "request-clean-b");
  assert.equal(waitingCount(), 1);

  deliver("codex", "SessionEnd", "fixture-clean-b", {}, sessionIsland);
  assert.equal(State.sessions.some((session) => session.id === b.id), false);
  assert.equal(waitingCount(), 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(cardTransitions, [true, true]);
  assert.ok(State.sessions.some((session) => session.id === "fixture-clean-claude"));
});

test("Codex subagent events deduplicate, preserve parent association, and settle a parked turn", () => {
  reset();
  deliver("codex", "SessionStart", "fixture-subagent");
  deliver("codex", "UserPromptSubmit", "fixture-subagent", { turn_id: "turn-child", prompt: "delegate" });
  deliver("codex", "SubagentStart", "fixture-subagent", { turn_id: "turn-child", agent_id: "agent-01", agent_type: "general" });
  deliver("codex", "SubagentStart", "fixture-subagent", { turn_id: "turn-child", agent_id: "agent-01", agent_type: "general" });
  const session = State.sessions[0];
  assert.equal(session.subagents.length, 1);
  deliver("codex", "Stop", "fixture-subagent", { turn_id: "turn-child", last_message: "delegated" });
  assert.equal(session.parked, true);
  deliver("codex", "SubagentStop", "fixture-subagent", { turn_id: "turn-child", agent_id: "agent-01", agent_type: "general", last_message: "child done" });
  assert.equal(session.subagents[0].state, "done");
  assert.equal(session.parked, false);
  assert.equal(session.state, "finished");
  const count = session.subagents.length;
  deliver("codex", "SubagentStart", "fixture-subagent", { turn_id: "turn-child", agent_id: "agent-01", agent_type: "general" });
  assert.equal(session.subagents.length, count);
});

test("Codex SubagentStop arriving before SubagentStart leaves no stale child", () => {
  reset();
  deliver("codex", "SessionStart", "fixture-reordered-child");
  deliver("codex", "SubagentStop", "fixture-reordered-child", { turn_id: "turn-child", agent_id: "agent-early", agent_type: "general" });
  deliver("codex", "SubagentStart", "fixture-reordered-child", { turn_id: "turn-child", agent_id: "agent-early", agent_type: "general" });
  assert.equal(State.sessions[0].subagents.length, 0);
});

test("Codex child start delivered after parent Stop keeps the turn active until child Stop", () => {
  reset();
  deliver("codex", "SessionStart", "fixture-late-child");
  deliver("codex", "UserPromptSubmit", "fixture-late-child", { turn_id: "turn-late-child", prompt: "delegate" });
  deliver("codex", "Stop", "fixture-late-child", { turn_id: "turn-late-child", last_message: "delegated" });
  const session = State.sessions[0];
  assert.equal(session.state, "finished");
  deliver("codex", "SubagentStart", "fixture-late-child", { turn_id: "turn-late-child", agent_id: "agent-late-child", agent_type: "general" });
  assert.equal(session.parked, true);
  assert.equal(session.state, "working");
  deliver("codex", "PreToolUse", "fixture-late-child", {
    turn_id: "turn-late-child", agent_id: "agent-late-child", agent_type: "general", tool_name: "Bash", tool_input: { command: "fixture-only" },
  });
  assert.equal(session.subagents[0].steps.length, 1);
  deliver("codex", "SubagentStop", "fixture-late-child", { turn_id: "turn-late-child", agent_id: "agent-late-child", agent_type: "general" });
  assert.equal(session.parked, false);
  assert.equal(session.state, "finished");
});

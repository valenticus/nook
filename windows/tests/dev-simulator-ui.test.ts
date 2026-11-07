import assert from "node:assert/strict";
import test from "node:test";

Object.defineProperty(globalThis, "__nookDevBuildFlag", { configurable: true, value: true });

const timers = new Map<number, { fn: () => void; ms: number }>();
let timerId = 1;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    setTimeout(fn: () => void, ms: number) { const id = timerId++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener() {},
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { addEventListener() {}, visibilityState: "visible" },
});

const [{ handleHook }, { State, CLAUDE_ID }, { compactPlan, compactSlots }, { roster, waitingCount }, { isSimulatedRequest }] = await Promise.all([
  import("../src/island/hooks.ts"),
  import("../src/core/state.ts"),
  import("../src/island/compact.ts"),
  import("../src/views/roster.ts"),
  import("../src/core/bridge.ts"),
]);

const batteryFixtureCalls: unknown[][] = [];
const island = {
  alert() {}, reveal() {}, setView() {}, afterRequest() {},
  simulateBattery(action: string, sample: unknown) { batteryFixtureCalls.push([action, sample]); },
};

function reset() {
  for (const session of State.sessions) {
    for (const request of [session.approval, session.question, ...session.queued]) {
      if (request) timers.delete(Number(request.requestId));
    }
  }
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

const event = (agent: "claude" | "codex", name: string, id: string, extra: Record<string, unknown> = {}) =>
  handleHook(island as never, {
    hook_event_name: name,
    session_id: `nook-sim:${agent}:${id}`,
    cwd: `C:\\NookDevSim\\${agent}`,
    nook_tool: agent,
    nook_simulated: true,
    ...extra,
  });

test("synthetic Claude and Codex identities stay independent on the real handler and compact roster", () => {
  reset();
  event("claude", "SessionStart", "same-test-id");
  event("codex", "SessionStart", "same-test-id");
  assert.deepEqual(State.sessions.map((s) => [s.id, s.agent]), [
    ["nook-sim:claude:same-test-id", "claude"],
    ["nook-sim:codex:same-test-id", "codex"],
  ]);
  const slots = compactSlots(compactPlan(), { usage: null, waiting: 0 });
  assert.equal(slots.dots.length, 2);
  assert.ok(slots.dots.some((dot) => dot.title.includes("Claude Code")));
  assert.ok(slots.dots.some((dot) => dot.title.includes("Codex")));
});

test("battery Dev fixture uses the isolated monitor route without creating agent sessions", () => {
  reset();
  batteryFixtureCalls.length = 0;
  const sessionsBefore = State.sessions.length;
  handleHook(island as never, {
    hook_event_name: "BatteryTest20",
    session_id: "nook-sim:battery:battery-test-run",
    nook_battery_simulator: true,
    nook_battery_action: "BatteryTest20",
    battery_sample: { percent: 20, ac_connected: false, charging: false, battery_present: true },
  });
  assert.equal(State.sessions.length, sessionsBefore);
  assert.equal(batteryFixtureCalls.length, 1);
  assert.deepEqual(batteryFixtureCalls[0], ["BatteryTest20", { percent: 20, acConnected: false, charging: false, batteryPresent: true }]);
});

test("parallel sessions appear in the shared active roster", () => {
  reset();
  for (const [agent, id] of [["claude", "a"], ["codex", "b"]] as const) {
    event(agent, "SessionStart", id);
    event(agent, "UserPromptSubmit", id, { prompt: "Synthetic prompt" });
    event(agent, "PreToolUse", id, { tool_name: "Read", tool_input: { file_path: "sample.txt" } });
  }
  assert.equal(roster().live.length, 2);
  assert.ok(roster().live.every((entry) => entry.state === "working"));
});

test("compact keeps four most urgent session dots and folds the remainder into +N", () => {
  reset();
  for (const id of ["approval", "question", "work-a", "work-b", "done-a", "done-b"]) event("claude", "SessionStart", id);
  event("claude", "PermissionRequest", "approval", {
    request_id: "nook-sim:req:claude:approval", tool_name: "Bash", tool_input: { command: "echo inert" }, nook_simulated_timeout_ms: 8_000,
  });
  event("claude", "PermissionRequest", "question", {
    request_id: "nook-sim:req:claude:question", tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question: "Choose?", options: [{ label: "A" }] }] }, nook_simulated_timeout_ms: 8_000,
  });
  for (const id of ["work-a", "work-b", "done-a", "done-b"]) {
    event("claude", "UserPromptSubmit", id, { prompt: "Synthetic" });
    event("claude", "PreToolUse", id, { tool_name: "Read", tool_input: { file_path: "sample.txt" } });
  }
  for (const id of ["done-a", "done-b"]) event("claude", "Stop", id, { last_message: "Synthetic finish" });

  const ordered = roster().live;
  const plan = compactPlan();
  const slots = compactSlots(plan, { usage: null, waiting: waitingCount() });
  assert.equal(plan.dots, 4);
  assert.deepEqual(slots.dots.map((dot) => dot.id), ordered.slice(0, 4).map((entry) => entry.id));
  assert.deepEqual(ordered.slice(0, 4).map((entry) => entry.state), ["approval", "question", "working", "working"]);
  assert.equal(slots.dots.filter((dot) => dot.calls).length, 2);
  assert.deepEqual(slots.more && [slots.more.count, slots.more.calls], [2, false]);
  assert.equal(waitingCount(), 2);
});

test("permission requests take priority and waiting count includes both sessions", () => {
  reset();
  event("claude", "SessionStart", "perm-a");
  event("codex", "SessionStart", "perm-b");
  event("claude", "PermissionRequest", "perm-a", { request_id: "nook-sim:req:claude:perm-a", tool_name: "Bash", tool_input: { command: "echo inert" }, nook_simulated_timeout_ms: 8_000 });
  event("codex", "PermissionRequest", "perm-b", { request_id: "nook-sim:req:codex:perm-b", tool_name: "Bash", tool_input: { command: "echo inert" }, nook_simulated_timeout_ms: 8_000 });
  assert.equal(waitingCount(), 2);
  assert.equal(State.session.approval?.requestId, "nook-sim:req:claude:perm-a");
  assert.equal(State.waiting[0]?.approval?.requestId, "nook-sim:req:codex:perm-b");
  assert.equal(roster().live[0]?.state, "approval");
});

test("Stop ends the turn while preserving the session; SessionEnd removes it", () => {
  reset();
  event("codex", "SessionStart", "stop-test");
  event("codex", "UserPromptSubmit", "stop-test", { prompt: "Synthetic" });
  event("codex", "Stop", "stop-test", { last_message: "Finished." });
  assert.equal(State.sessions.length, 1);
  assert.equal(State.session.state, "finished");
  event("codex", "SessionEnd", "stop-test");
  assert.equal(State.sessions.length, 0);
});

test("simulated permission times out on the short Dev timer and clears its UI wait", () => {
  reset();
  event("claude", "SessionStart", "timeout-test");
  event("claude", "PermissionRequest", "timeout-test", {
    request_id: "nook-sim:req:claude:timeout-test", tool_name: "Bash", tool_input: { command: "echo inert" },
    nook_simulated_timeout_ms: 8_000,
  });
  assert.equal(waitingCount(), 1);
  assert.equal(timers.size, 1);
  const timeout = [...timers.values()][0]!;
  assert.equal(timeout.ms, 8_000);
  timers.clear();
  timeout.fn();
  assert.equal(waitingCount(), 0);
  assert.equal(State.session.approval, null);
  assert.equal(State.sessions.length, 1);
});

test("synthetic sessions are ignored when Codex tracking is disabled", () => {
  reset();
  State.settings.showCodexSessions = false;
  event("codex", "SessionStart", "disabled-test");
  assert.equal(State.sessions.length, 0);
});

test("only reserved simulator permission ids are classified as local UI decisions", () => {
  assert.equal(isSimulatedRequest("nook-sim:req:codex:run-12345678"), true);
  assert.equal(isSimulatedRequest("pid-42-1"), false);
});

test("a marked synthetic event cannot attach to a real session id", () => {
  reset();
  handleHook(island as never, {
    hook_event_name: "SessionStart", session_id: "a-real-agent-session", nook_tool: "codex", nook_simulated: true,
  });
  assert.equal(State.sessions.length, 0);
  handleHook(island as never, {
    hook_event_name: "PermissionRequest", session_id: "nook-sim:codex:run-12345678", nook_tool: "codex",
    nook_simulated: true, request_id: "real-request-id", tool_name: "Bash", tool_input: { command: "echo" },
  });
  assert.equal(State.sessions.length, 0);
});

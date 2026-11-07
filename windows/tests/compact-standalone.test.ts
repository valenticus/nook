import assert from "node:assert/strict";
import test from "node:test";

Object.assign(globalThis, { __nookDevBuildFlag: false, __nookStandaloneBuildFlag: true });
const { availableCompactUsageAgents, compactPlan, reading } = await import("../src/island/compact.ts");
const { State } = await import("../src/core/state.ts");
const { readFile } = await import("node:fs/promises");

const now = 1_800_000_000_000;
const snapshot = {
  generation: 1,
  quotas: {
    fiveHour: { usedPercent: 0, resetsAt: now + 3_600_000 },
    sevenDay: { usedPercent: 8, resetsAt: now + 86_400_000 },
  },
  updatedAt: now,
  stale: false,
  available: true,
  failureReason: null,
};

test("Standalone compact quotas accept Codex's confirmed 0% and 8% windows after opt-in", () => {
  const gauges = { usage: null, waiting: 0, codexQuota: snapshot, codexEnabled: true, usageAgent: "codex" as const, now };
  assert.deepEqual(availableCompactUsageAgents(gauges), ["codex"]);
  assert.equal(reading("usage5h", gauges).text, "0%");
  assert.equal(reading("usage7d", gauges).text, "8%");
});

test("Standalone enables the shared quota rotation and idle clock lifecycle", async () => {
  const source = await readFile(new URL("../src/island/compact.ts", import.meta.url), "utf8");
  assert.match(source, /const USAGE_ROTATION_BUILD = NOOK_DEV_BUILD \|\| STANDALONE_BUILD/);
  assert.match(source, /const IDLE_CLOCK_BUILD = USAGE_ROTATION_BUILD/);
  assert.match(source, /const cycle = USAGE_ROTATION_BUILD/);
});

test("Standalone enters idle exactly after five minutes and returns to active mode on user activity", () => {
  const wallNow = Date.now();
  const monotonicNow = performance.now();
  State.lastAgentEventAt = wallNow - 299_000;
  State.mode = "compact";
  State.lastActivity = monotonicNow - 299_000;
  State.sessions = [];
  State.batteryAlert = null;
  assert.equal(compactPlan().idle, false);
  State.lastAgentEventAt = wallNow - 300_000;
  State.lastActivity = monotonicNow - 300_000;
  assert.equal(compactPlan().idle, true);
  State.lastActivity = performance.now();
  assert.equal(compactPlan().idle, false);
  State.mode = "expanded";
  assert.equal(compactPlan().idle, false, "the clock must not replace an expanded Home or completion card");
});

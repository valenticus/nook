import assert from "node:assert/strict";
import test from "node:test";

const { availableCompactUsageAgents, compactMetricLayout, compactPlan, reading } = await import("../src/island/compact.ts");
const { compactLayout, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W } = await import("../src/core/layout.ts");
const { State } = await import("../src/core/state.ts");

const now = 1_800_000_000_000;
const codexQuota = {
  generation: 1,
  quotas: {
    fiveHour: { usedPercent: 9, resetsAt: now + 60_000 },
    sevenDay: { usedPercent: 8, resetsAt: now + 86_400_000 },
  },
  updatedAt: now,
  stale: false,
  available: true,
  failureReason: null,
};

test("production compact quota path remains Claude-only", () => {
  const gauges = {
    usage: { fiveHour: { usedPercent: 31, resetsAt: now + 60_000 }, sevenDay: null, updatedAt: now },
    codexQuota,
    codexEnabled: true,
    usageAgent: "codex" as const,
    waiting: 0,
    now,
  };
  assert.deepEqual(availableCompactUsageAgents(gauges), ["claude"]);
  assert.equal(reading("usage5h", gauges).text, "31%");
});

test("production Compact Island never enters the Dev-only Idle mode", () => {
  State.lastAgentEventAt = 0;
  assert.equal(compactPlan().idle, false);
});

test("compact width keeps quota windows as a pair or hides both", () => {
  const oneCellRoom = compactMetricLayout(["usage5h", "usage7d"], 0, "top", 180);
  assert.deepEqual(oneCellRoom.kinds, [], "the layout never exposes one half of the quota pair");
  const pairAndWaiting = compactMetricLayout(["usage5h", "usage7d", "waiting"], 0, "top", 230);
  assert.deepEqual(pairAndWaiting.kinds, ["usage5h", "usage7d"]);
  const narrowWithWaiting = compactMetricLayout(["usage5h", "usage7d", "waiting"], 0, "top", 180);
  assert.deepEqual(narrowWithWaiting.kinds, ["waiting"]);
  assert.equal(compactLayout(0, [COMPACT_USAGE_CELL_W, COMPACT_USAGE_CELL_W], "top", 230, 0).metrics, 2);
  assert.ok(COMPACT_WAITING_CELL_W > 0);
});

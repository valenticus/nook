import assert from "node:assert/strict";
import test from "node:test";

import { COMPACT_METRICS, DEFAULT_SETTINGS, compactMetrics } from "../src/core/state.ts";

test("compact island offers only Claude usage and waiting cells", () => {
  assert.deepEqual(COMPACT_METRICS, ["usage5h", "usage7d", "waiting"]);
});

test("a chosen quota window selects both quota windows, preserving non-quota choices", () => {
  assert.deepEqual(
    compactMetrics({ compactMetrics: ["usage7d", "waiting"] }),
    ["usage5h", "usage7d", "waiting"],
  );
  assert.deepEqual(compactMetrics({ compactMetrics: ["waiting", "usage7d"] }), ["waiting", "usage5h", "usage7d"]);
  assert.deepEqual(compactMetrics({ compactMetrics: [] }), []);
  assert.deepEqual(compactMetrics({ compactMetrics: ["usage5h"] }), ["usage5h", "usage7d"]);
  assert.deepEqual(compactMetrics({ compactMetrics: ["obsolete"] }), ["usage5h", "usage7d", "waiting"]);
});

test("the default compact cells include both quota windows and the waiting bell", () => {
  assert.deepEqual(compactMetrics(DEFAULT_SETTINGS), ["usage5h", "usage7d", "waiting"]);
});

test("old system-metric-only settings migrate to the new defaults", () => {
  assert.deepEqual(compactMetrics({ compactMetrics: ["cpu", "ram", "gpu"] }), ["usage5h", "usage7d", "waiting"]);
});

test("quota pair and explicit ordering without waiting are preserved", () => {
  assert.deepEqual(compactMetrics({ compactMetrics: ["usage5h", "usage7d"] }), ["usage5h", "usage7d"]);
  assert.deepEqual(compactMetrics({ compactMetrics: [] }), []);
});

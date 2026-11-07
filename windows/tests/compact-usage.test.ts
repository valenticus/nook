import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { COMPACT_AGENT_ICON_W, COMPACT_CELL_H, COMPACT_MAX_VISIBLE, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W, compactLayout } from "../src/core/layout.ts";
import { CLAUDE_BRAND_MARK, OPENAI_BRAND_MARK } from "../src/views/iconset.ts";
import type { QuotaProviderSnapshot } from "../src/settings/codex-quota-view.ts";

Object.assign(globalThis, { __nookDevBuildFlag: true });
const { availableCompactUsageAgents, compactAgentName, compactAgentPath, compactReducedMotion, reading, waitingSignal } = await import("../src/island/compact.ts");
const { COMPACT_USAGE_ROTATION_MS, createCompactUsageCycle } = await import("../src/island/compact-usage-cycle.ts");

const NOW = 1_800_000_000_000;
const codex = (patch: Partial<QuotaProviderSnapshot> = {}): QuotaProviderSnapshot => ({
  generation: 3,
  quotas: {
    fiveHour: { usedPercent: 59.4, resetsAt: NOW + 2 * 60 * 60_000 },
    sevenDay: { usedPercent: 85, resetsAt: NOW + 3 * 24 * 60 * 60_000 },
  },
  updatedAt: NOW,
  stale: false,
  available: true,
  failureReason: null,
  ...patch,
});

test("compact agent brand paths are the Claude symbol and OpenAI mark", () => {
  assert.match(CLAUDE_BRAND_MARK, /^m4\.7144 15\.9555/);
  assert.match(OPENAI_BRAND_MARK, /^M22\.282 9\.821/);
  assert.notEqual(CLAUDE_BRAND_MARK, OPENAI_BRAND_MARK);
  assert.ok(CLAUDE_BRAND_MARK.length > 1_000);
  assert.ok(OPENAI_BRAND_MARK.length > 1_000);
  assert.equal(compactAgentPath("claude"), CLAUDE_BRAND_MARK);
  assert.equal(compactAgentPath("codex"), OPENAI_BRAND_MARK);
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /\.ci-metric-agent\s*\{[^}]*color:\s*var\(--ink\)/s);
  assert.doesNotMatch(css, /\.ci-metric-agent\[data-agent="claude"\]\s*\{[^}]*#d97757/s);
  assert.match(css, /\.ci-metric\[data-kind="waiting"\]\.waiting-active[\s\S]*?color:\s*var\(--amber\)/);
  assert.match(css, /\.ci-metric\s*\{[^}]*justify-content:\s*center/s);
  assert.match(css, /\.ci-metric-reading\s*\{[^}]*gap:\s*var\(--compact-reading-gap\)/s);
  assert.match(css, /\.ci-metric\[data-kind="usage5h"\] b,[\s\S]*?flex:\s*0 0 30px/);
  assert.match(css, /\.ci-metric\[data-kind="waiting"\] b\s*\{[^}]*flex:\s*0 0 14px/s);
});

function fakeClock() {
  let nextId = 1;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  return {
    pending,
    cycle: createCompactUsageCycle(
      () => {},
      (callback, delay) => { const id = nextId++; pending.set(id, { callback, delay }); return id; },
      (id) => { pending.delete(id); },
    ),
  };
}

test("both available providers rotate Claude → Codex → Claude every 5 seconds", () => {
  const clock = fakeClock();
  const changed: string[] = [];
  clock.cycle.destroy();
  const cycle = createCompactUsageCycle((agent) => changed.push(agent), (callback, delay) => {
    const id = changed.length + 1;
    clock.pending.set(id, { callback, delay });
    return id;
  }, (id) => { clock.pending.delete(id); });
  cycle.configure(["claude", "codex"], true, false);
  assert.equal(cycle.current(), "claude");
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0]?.delay, COMPACT_USAGE_ROTATION_MS);
  const first = [...clock.pending.entries()][0]!;
  clock.pending.delete(first[0]); first[1].callback();
  assert.equal(cycle.current(), "codex");
  assert.equal(changed.at(-1), "codex");
  assert.equal(clock.pending.size, 1);
  const second = [...clock.pending.entries()][0]!;
  clock.pending.delete(second[0]); second[1].callback();
  assert.equal(cycle.current(), "claude");
  assert.equal(changed.at(-1), "claude");
  cycle.destroy();
  assert.equal(clock.pending.size, 0);
});

test("single-provider and no-provider availability never create empty rotation intervals", () => {
  const clock = fakeClock();
  clock.cycle.configure(["claude"], true, false);
  assert.equal(clock.cycle.current(), "claude");
  assert.equal(clock.pending.size, 0);
  clock.cycle.configure(["codex"], true, false);
  assert.equal(clock.cycle.current(), "codex");
  assert.equal(clock.pending.size, 0);
  clock.cycle.configure([], true, false);
  assert.equal(clock.cycle.current(), "claude");
  assert.equal(clock.pending.size, 0);
  clock.cycle.destroy();
});

test("hover pauses the one timer and resume starts one fresh interval without catch-up", () => {
  const clock = fakeClock();
  clock.cycle.configure(["claude", "codex"], true, false);
  assert.equal(clock.pending.size, 1);
  for (let i = 0; i < 10; i++) clock.cycle.configure(["claude", "codex"], true, false);
  assert.equal(clock.pending.size, 1, "repeated renders must not accumulate timers");
  clock.cycle.configure(["claude", "codex"], true, true);
  assert.equal(clock.pending.size, 0);
  assert.equal(clock.cycle.current(), "claude");
  clock.cycle.configure(["claude", "codex"], true, false);
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0]?.delay, COMPACT_USAGE_ROTATION_MS);
  clock.cycle.destroy();
  assert.equal(clock.pending.size, 0);
});

test("provider opt-out mid-cycle clears Codex and its pending timer", () => {
  const clock = fakeClock();
  clock.cycle.configure(["claude", "codex"], true, false);
  assert.equal(clock.pending.size, 1);
  clock.cycle.configure(["claude"], true, false);
  assert.equal(clock.cycle.current(), "claude");
  assert.equal(clock.pending.size, 0);
  clock.cycle.destroy();
});

test("expanded view stops rotation and re-entering compact starts a single timer", () => {
  const clock = fakeClock();
  clock.cycle.configure(["claude", "codex"], true, false);
  clock.cycle.configure(["claude", "codex"], false, false);
  assert.equal(clock.pending.size, 0);
  clock.cycle.configure(["claude", "codex"], true, false);
  assert.equal(clock.pending.size, 1);
  clock.cycle.destroy();
  assert.equal(clock.pending.size, 0);
});

test("agent name and both readings use the same selected provider snapshot", () => {
  const gauges = { usage: null, waiting: 0, codexQuota: codex(), codexEnabled: true, usageAgent: "codex" as const, now: NOW };
  assert.equal(compactAgentName(gauges.usageAgent), "Codex");
  assert.equal(gauges.codexQuota.quotas?.fiveHour?.usedPercent, 59.4, "source quota precision is preserved");
  assert.equal(reading("usage5h", gauges).text, "59%");
  assert.equal(reading("usage7d", gauges).text, "85%");
  assert.equal(compactAgentName("claude"), "Claude");
});

test("Claude compact cells show both independently reported 1% windows", () => {
  const usage = {
    fiveHour: { usedPercent: 1, resetsAt: NOW + 2 * 60 * 60_000 },
    sevenDay: { usedPercent: 1, resetsAt: NOW + 3 * 24 * 60 * 60_000 },
    updatedAt: NOW,
  };
  const five = reading("usage5h", { usage, waiting: 0, usageAgent: "claude", now: NOW });
  const seven = reading("usage7d", { usage, waiting: 0, usageAgent: "claude", now: NOW });
  assert.equal(five.text, "1%");
  assert.equal(seven.text, "1%");
});

test("rotation eligibility skips loading/unavailable values and accepts fresh or stale windows", () => {
  const claudeOnly = { fiveHour: { usedPercent: 3, resetsAt: NOW + 60_000 }, sevenDay: null, updatedAt: NOW };
  const claudeUsage = { fiveHour: null, sevenDay: null, updatedAt: NOW };
  assert.deepEqual(availableCompactUsageAgents({ usage: claudeOnly, waiting: 0, codexQuota: null, codexEnabled: false, now: NOW }), ["claude"]);
  assert.deepEqual(availableCompactUsageAgents({ usage: claudeOnly, waiting: 0, codexQuota: codex(), codexEnabled: true, now: NOW }), ["claude", "codex"]);
  assert.deepEqual(availableCompactUsageAgents({ usage: null, waiting: 0, codexQuota: codex(), codexEnabled: false, now: NOW }), []);
  assert.deepEqual(availableCompactUsageAgents({ usage: null, waiting: 0, codexQuota: codex(), codexEnabled: true, now: NOW }), ["codex"]);
  assert.deepEqual(availableCompactUsageAgents({ usage: null, waiting: 0, codexQuota: codex({ stale: true }), codexEnabled: true, now: NOW }), ["codex"]);
  assert.deepEqual(availableCompactUsageAgents({ usage: null, waiting: 0, codexQuota: null, codexEnabled: true, now: NOW }), []);
  assert.deepEqual(availableCompactUsageAgents({ usage: claudeUsage, waiting: 0, codexQuota: codex(), codexEnabled: true, now: NOW }), ["codex"]);
  const bothUnavailable = codex({ quotas: null, updatedAt: null, available: false, failureReason: "timeout" });
  assert.deepEqual(availableCompactUsageAgents({ usage: null, waiting: 0, codexQuota: bothUnavailable, codexEnabled: true, now: NOW }), []);
  assert.equal(reading("usage5h", { usage: null, waiting: 0, codexQuota: bothUnavailable, codexEnabled: true, usageAgent: "claude", now: NOW }).text, "—");
});

test("Codex reuses the original calm/warm/hot thresholds and independent windows", () => {
  const five = reading("usage5h", { usage: null, waiting: 0, codexQuota: codex(), codexEnabled: true, usageAgent: "codex", now: NOW });
  const seven = reading("usage7d", { usage: null, waiting: 0, codexQuota: codex(), codexEnabled: true, usageAgent: "codex", now: NOW });
  assert.equal(five.text, "59%");
  assert.equal(five.level, "calm");
  assert.equal(seven.text, "85%");
  assert.equal(seven.level, "warm");
  for (const [percent, expected] of [[59, "calm"], [60, "warm"], [85, "warm"], [86, "hot"]] as const) {
    const result = reading("usage5h", {
      usage: null, waiting: 0,
      codexQuota: codex({ quotas: { fiveHour: { usedPercent: percent, resetsAt: NOW + 60_000 }, sevenDay: null } }),
      codexEnabled: true, usageAgent: "codex", now: NOW,
    });
    assert.equal(result.level, expected, `${percent}%`);
  }
});

test("Codex provider-confirmed zero use remains 0% in the compact five-hour cell", () => {
  const zero = codex({ quotas: {
    fiveHour: { usedPercent: 0, resetsAt: NOW + 3 * 60 * 60_000, windowDurationMins: 300 },
    sevenDay: { usedPercent: 8, resetsAt: NOW + 5 * 24 * 60 * 60_000, windowDurationMins: 10_080 },
  } });
  assert.equal(reading("usage5h", { usage: null, waiting: 0, codexQuota: zero, codexEnabled: true, usageAgent: "codex", now: NOW }).text, "0%");
  assert.equal(reading("usage7d", { usage: null, waiting: 0, codexQuota: zero, codexEnabled: true, usageAgent: "codex", now: NOW }).text, "8%");
});

test("each quota window remains independent when the other one is missing", () => {
  const fiveOnly = codex({ quotas: {
    fiveHour: { usedPercent: 0, resetsAt: NOW + 60_000, windowDurationMins: 300 },
    sevenDay: null,
  } });
  const five = reading("usage5h", { usage: null, waiting: 0, codexQuota: fiveOnly, codexEnabled: true, usageAgent: "codex", now: NOW });
  const missingSeven = reading("usage7d", { usage: null, waiting: 0, codexQuota: fiveOnly, codexEnabled: true, usageAgent: "codex", now: NOW });
  assert.equal(five.text, "0%");
  assert.equal(missingSeven.text, "—");
  assert.deepEqual(availableCompactUsageAgents({ usage: null, waiting: 0, codexQuota: fiveOnly, codexEnabled: true, now: NOW }), ["codex"]);
});

test("Codex loading, failure, stale and reset never render missing usage as zero", () => {
  const loading = reading("usage5h", { usage: null, waiting: 0, codexQuota: null, codexEnabled: true, usageAgent: "codex", now: NOW });
  assert.equal(loading.text, "—");
  assert.match(loading.more ?? "", /Loading/);

  const failed = reading("usage5h", {
    usage: null, waiting: 0,
    codexQuota: codex({ quotas: null, updatedAt: null, available: false, failureReason: "timeout" }),
    codexEnabled: true, usageAgent: "codex", now: NOW,
  });
  assert.equal(failed.text, "—");
  assert.match(failed.more ?? "", /Unavailable/);

  const stale = reading("usage7d", { usage: null, waiting: 0, codexQuota: codex({ stale: true }), codexEnabled: true, usageAgent: "codex", now: NOW });
  assert.equal(stale.text, "85%");
  assert.equal(stale.dim, true);

  const oneReset = codex({ quotas: {
    fiveHour: { usedPercent: 99, resetsAt: NOW },
    sevenDay: { usedPercent: 31, resetsAt: NOW + 86_400_000 },
  } });
  assert.equal(reading("usage5h", { usage: null, waiting: 0, codexQuota: oneReset, codexEnabled: true, usageAgent: "codex", now: NOW }).text, "—");
  assert.equal(reading("usage7d", { usage: null, waiting: 0, codexQuota: oneReset, codexEnabled: true, usageAgent: "codex", now: NOW }).text, "31%");
  const bothReset = codex({ quotas: {
    fiveHour: { usedPercent: 99, resetsAt: NOW },
    sevenDay: { usedPercent: 31, resetsAt: NOW - 1 },
  } });
  assert.equal(reading("usage5h", { usage: null, waiting: 0, codexQuota: bothReset, codexEnabled: true, usageAgent: "codex", now: NOW }).text, "—");
  assert.equal(reading("usage7d", { usage: null, waiting: 0, codexQuota: bothReset, codexEnabled: true, usageAgent: "codex", now: NOW }).text, "—");
});

test("waiting cell retains 0, 1 and multiple request counts", () => {
  assert.equal(reading("waiting", { usage: null, waiting: 0 }).text, "0");
  assert.equal(reading("waiting", { usage: null, waiting: 1 }).text, "1");
  assert.equal(reading("waiting", { usage: null, waiting: 2 }).text, "2");
  assert.equal(reading("waiting", { usage: null, waiting: 4 }).text, "4");
  assert.equal(reading("waiting", { usage: null, waiting: 99 }).text, "99");
  assert.equal(reading("waiting", { usage: null, waiting: 100 }).text, "99");
});

test("waiting indicator is amber only while active and animates once per increase unless motion is reduced", () => {
  assert.deepEqual(waitingSignal(0, 0, false), { active: false, animate: false });
  assert.deepEqual(waitingSignal(1, 0, false), { active: true, animate: true });
  assert.deepEqual(waitingSignal(2, 1, false), { active: true, animate: true });
  assert.deepEqual(waitingSignal(2, 2, false), { active: true, animate: false });
  assert.deepEqual(waitingSignal(1, 2, false), { active: true, animate: false });
  assert.deepEqual(waitingSignal(1, 0, true), { active: true, animate: false });
  assert.equal(compactReducedMotion("on", false), true);
  assert.equal(compactReducedMotion("off", true), false);
  assert.equal(compactReducedMotion("system", true), true);
  assert.equal(compactReducedMotion("system", false), false);
});

test("top and side layouts keep original cap and metric priority", () => {
  const topFit = compactLayout(2, [COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "top", 240);
  assert.equal(topFit.metrics, 2);
  assert.equal(topFit.dots, 2);
  const topTight = compactLayout(2, [COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "top", 210);
  assert.equal(topTight.metrics, 1, "the last metric folds away before session dots");
  assert.equal(topTight.dots, 2);
  const sideFit = compactLayout(2, [COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "left", 220);
  assert.equal(sideFit.metrics, 2);
  assert.equal(sideFit.dots, 2);
  assert.equal(sideFit.width, 46);
});

test("Compact Island caps visible dots at four and budgets a 16 px inline provider mark", () => {
  assert.equal(COMPACT_MAX_VISIBLE, 4);
  assert.equal(COMPACT_AGENT_ICON_W, 16);
  const top = compactLayout(8, [COMPACT_USAGE_CELL_W, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "top", 420, 0);
  assert.equal(top.dots, 4);
  assert.equal(top.metrics, 3);
  assert.equal(top.width, 340, "fixed metric cells, 16 px provider mark, and 8 px gaps are counted in the width");
  const side = compactLayout(8, [COMPACT_WAITING_CELL_W, COMPACT_USAGE_CELL_W, COMPACT_USAGE_CELL_W], "right", 420, 1);
  assert.equal(side.width, 46, "provider title must never widen the side column");
  assert.equal(side.dots, 4);
  assert.equal(side.metrics, 3);
  assert.equal(side.height, COMPACT_CELL_H * 3 + 10 + 3 * 8 + 12 + 34 + 10 + 76 + 10 + 12);
  for (let sessions = 0; sessions <= 8; sessions++) {
    const plan = compactLayout(sessions, [COMPACT_USAGE_CELL_W, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "top", 420, 0);
    assert.equal(plan.dots, Math.min(sessions, COMPACT_MAX_VISIBLE), `${sessions} active sessions`);
    assert.equal(plan.metrics, 3, `${sessions} active sessions retain the same fixed metric groups`);
  }
});

test("tight layouts drop trailing metrics and then reduce dots under the existing cap", () => {
  const top = compactLayout(8, [COMPACT_USAGE_CELL_W, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "top", 300, 0);
  assert.equal(top.metrics, 1);
  assert.equal(top.dots, 4);
  const narrower = compactLayout(8, [COMPACT_USAGE_CELL_W, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W], "top", 140, 0);
  assert.equal(narrower.metrics, 0);
  assert.equal(narrower.dots, 1);
});

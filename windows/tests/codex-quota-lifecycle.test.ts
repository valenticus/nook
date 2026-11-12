import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

Object.assign(globalThis, { __nookDevBuildFlag: false, __nookStandaloneBuildFlag: true });
const { reading, availableCompactUsageAgents } = await import("../src/island/compact.ts");
const { quotaProviderDisplay, formatQuotaPercent } = await import("../src/settings/codex-quota-view.ts");
const { setLanguage } = await import("../src/core/i18n.ts");
// The words below are checked in English; the numbers do not depend on the language.
setLanguage("en");

// What the screen shows for a snapshot the provider emitted: the compact cell and the expanded view,
// which must agree (both come from `quotaProviderDisplay`).
const NOW = 1_800_000_000_000;
const MIN = 60_000;
type Win = { usedPercent: number; resetsAt: number; windowDurationMins?: number };
const win = (usedPercent: number, resetsInMs: number, mins = 300): Win => ({ usedPercent, resetsAt: NOW + resetsInMs, windowDurationMins: mins });

const snap = (five: Win | null, seven: Win | null, over: Record<string, unknown> = {}) => ({
  generation: 1,
  quotas: { fiveHour: five, sevenDay: seven },
  updatedAt: NOW,
  stale: false,
  available: true,
  failureReason: null as string | null,
  ...over,
});

function screen(snapshot: ReturnType<typeof snap> | null, at = NOW) {
  const gauges = { usage: null, waiting: 0, codexQuota: snapshot, codexEnabled: true, usageAgent: "codex" as const, now: at };
  const expanded = quotaProviderDisplay(true, snapshot, at);
  return {
    compact5: reading("usage5h", gauges),
    compact7: reading("usage7d", gauges),
    expanded,
    // The expanded rows say the same number, or nothing, as the compact cells.
    expanded5: expanded.fiveHour && expanded.fiveHour.state !== "unavailable" ? formatQuotaPercent(expanded.fiveHour.percent) : null,
    expanded7: expanded.sevenDay && expanded.sevenDay.state !== "unavailable" ? formatQuotaPercent(expanded.sevenDay.percent) : null,
    agents: availableCompactUsageAgents(gauges, at),
  };
}

const AHEAD = 5 * 60 * MIN;
const WEEK = 4 * 24 * 60 * MIN;

test("0% used with a valid reset time shows 0% in the compact cell and the expanded view (100% remaining)", () => {
  const s = screen(snap(win(0, AHEAD), win(13, WEEK, 10_080)));
  assert.equal(s.compact5.text, "0%");
  assert.equal(s.expanded5, "0%");
  assert.equal(s.compact7.text, "13%");
  assert.equal(s.expanded7, "13%");
  assert.equal(s.expanded.status, "Fresh");
  assert.deepEqual(s.agents, ["codex"]);
  assert.match(s.compact5.more ?? "", /resets in 5h 0m/i, "the reset time is kept");
});

test("1%, 50% and 100% used, and a zero that only rounds to zero", () => {
  for (const [used, text] of [[0.4, "0%"], [0.5, "1%"], [1, "1%"], [50, "50%"], [99.6, "100%"], [100, "100%"]] as const) {
    const s = screen(snap(win(used, AHEAD), null));
    assert.equal(s.compact5.text, text, `used ${used}`);
    assert.equal(s.expanded5, text, `used ${used} (expanded)`);
  }
});

test("a missing window is a dash, never a zero — and a valid zero is never a dash", () => {
  const missing5 = screen(snap(null, win(13, WEEK, 10_080)));
  assert.equal(missing5.compact5.text, "—");
  assert.equal(missing5.expanded5, null);
  assert.equal(missing5.compact7.text, "13%");
  const zero5 = screen(snap(win(0, AHEAD), null));
  assert.equal(zero5.compact5.text, "0%");
  assert.equal(zero5.compact7.text, "—", "the other window is simply not there");
});

test("5h and 7d are independent: one window over, the other still shown", () => {
  // The five-hour window reset a minute ago; the weekly one has days left.
  const s = screen(snap(win(40, -MIN), win(13, WEEK, 10_080)));
  assert.equal(s.compact5.text, "—");
  assert.equal(s.compact7.text, "13%");
  assert.equal(s.expanded.fiveHour?.state, "unavailable");
  assert.equal(s.expanded7, "13%");
  // And the other way round.
  const t = screen(snap(win(0, AHEAD), win(80, -MIN, 10_080)));
  assert.equal(t.compact5.text, "0%");
  assert.equal(t.compact7.text, "—");
});

test("a window reset passing is a dash that says why, and the refresh that follows brings the zero", () => {
  const before = snap(win(40, 2 * MIN), win(13, WEEK, 10_080));
  assert.equal(screen(before, NOW).compact5.text, "40%");
  // The reset passes while the old snapshot is all there is.
  const during = screen(before, NOW + 3 * MIN);
  assert.equal(during.compact5.text, "—");
  assert.match(during.compact5.more ?? "", /Reset, waiting for new data/);
  assert.equal(during.compact7.text, "13%");
  // The provider reads again just after the reset (codex_quota.rs `reset_wait`) and the new window is 0% used.
  const after = snap(win(0, AHEAD), win(13, WEEK - 3 * MIN, 10_080), { updatedAt: NOW + 3 * MIN });
  const refreshed = screen(after, NOW + 3 * MIN + 5_000);
  assert.equal(refreshed.compact5.text, "0%");
  assert.equal(refreshed.expanded5, "0%");
});

test("a temporary provider failure keeps the last values, dimmed — it does not clear a zero", () => {
  const failed = screen(snap(win(0, AHEAD), win(13, WEEK, 10_080), { stale: true, failureReason: "timeout" }));
  assert.equal(failed.compact5.text, "0%");
  assert.equal(failed.compact5.dim, true);
  assert.equal(failed.expanded.status, "Stale");
  assert.equal(failed.expanded5, "0%");
});

test("a failure with nothing to keep is a dash with its reason; not a zero", () => {
  const none = snap(null, null, { quotas: null, available: false, updatedAt: null, failureReason: "timeout" });
  const s = screen(none);
  assert.equal(s.compact5.text, "—");
  assert.equal(s.compact7.text, "—");
  assert.equal(s.expanded.status, "Unavailable");
  assert.match(s.compact5.more ?? "", /Timed out/);
  assert.deepEqual(s.agents, []);
});

test("an idle provider (answered, nothing usable in it) is unavailable, not 0%", () => {
  const idle = snap(null, null, { quotas: null, available: false, stale: true, failureReason: "quotaUnavailable" });
  const s = screen(idle);
  assert.equal(s.compact5.text, "—");
  assert.equal(s.expanded.status, "Unavailable");
  assert.match(s.compact5.more ?? "", /Quota data unavailable/);
});

test("initial null response is Loading but an enabled empty provider is idle, not a zero", () => {
  const nothingYet = screen(null);
  assert.equal(nothingYet.expanded.status, "Loading");
  assert.equal(nothingYet.compact5.text, "—");
  assert.match(nothingYet.compact5.more ?? "", /Loading/);
  // The provider was just switched on: a snapshot with no quotas, no time and no reason.
  const justEnabled = screen(snap(null, null, { quotas: null, available: false, updatedAt: null, failureReason: null }));
  assert.equal(justEnabled.expanded.status, "Idle");
  assert.equal(justEnabled.compact5.text, "—");
});

test("a window whose reset time is unknown (0) still shows its percentage, without a countdown", () => {
  // Rust never sends this today (a window without a reset time is not taken); the view's contract for
  // an unknown reset is to show the number and say nothing about when.
  const s = screen(snap({ usedPercent: 0, resetsAt: 0, windowDurationMins: 300 }, null));
  assert.equal(s.compact5.text, "0%");
  assert.equal(s.expanded5, "0%");
  assert.equal(s.expanded.fiveHour?.resetCountdown, "");
});

test("the refresh scheduler waits for hooks or due event work without idle polling", async () => {
  const rust = await readFile(new URL("../src-tauri/src/codex_quota.rs", import.meta.url), "utf8");
  assert.match(rust, /fn schedule_action\(/);
  assert.match(rust, /ScheduleAction::Idle\s*=>\s*\{\s*let _ = provider\.wake\.notified\(\)\.await;/);
  assert.match(rust, /ScheduleAction::Wait\(duration\)\s*=>\s*\{\s*let _ = timeout\(duration, provider\.wake\.notified\(\)\)\.await;/);
  assert.match(rust, /ScheduleAction::Refresh\s*=>/);
  assert.doesNotMatch(rust, /timeout\(provider\.next_wait\(\), provider\.wake\.notified\(\)\)/);
  assert.match(rust, /INACTIVITY_LEASE\.saturating_sub\(/, "failed active turns wait for their lease deadline");
});
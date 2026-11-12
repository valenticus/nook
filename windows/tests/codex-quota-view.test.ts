import assert from "node:assert/strict";
import test from "node:test";
import { formatQuotaPercent, formatResetTime, quotaProviderDisplay, QuotaSnapshotGate, type QuotaProviderSnapshot } from "../src/settings/codex-quota-view.ts";
import { setLanguage } from "../src/core/i18n.ts";

const NOW = 1_800_000_000_000;
const snapshot = (patch: Partial<QuotaProviderSnapshot> = {}): QuotaProviderSnapshot => ({
  generation: 1,
  quotas: {
    fiveHour: { usedPercent: 6.4, resetsAt: NOW + 2 * 60 * 60_000 + 10 * 60_000 },
    sevenDay: { usedPercent: 2.2, resetsAt: NOW + 4 * 24 * 60 * 60_000 },
  }, updatedAt: NOW, stale: false, available: true, failureReason: null, ...patch,
});

test("Claude-only hides Codex; Codex-only exposes its two independent windows", () => {
  assert.equal(quotaProviderDisplay(false, null, NOW).status, "Disabled");
  const codex = quotaProviderDisplay(true, snapshot(), NOW);
  assert.equal(codex.status, "Fresh");
  assert.equal(codex.fiveHour?.percent, 6.4);
  assert.equal(codex.sevenDay?.percent, 2.2);
  assert.equal(codex.fiveHour?.resetCountdown, "resets in 2h 10m");
  assert.notEqual(codex.fiveHour?.resetsAt, codex.sevenDay?.resetsAt);
  assert.equal(formatQuotaPercent(snapshot().quotas!.fiveHour!.usedPercent), "6%");
});

test("idle, fresh, stale, unavailable, and disabled are distinct and never invent zeros", () => {
  const idle = quotaProviderDisplay(true, { generation: 1, quotas: null, updatedAt: null, stale: false, available: false, failureReason: null }, NOW);
  assert.equal(idle.status, "Idle");
  assert.equal(idle.fiveHour, null);
  assert.equal(quotaProviderDisplay(true, snapshot(), NOW).status, "Fresh");
  const stale = quotaProviderDisplay(true, snapshot({ stale: true }), NOW);
  assert.equal(stale.status, "Stale");
  assert.equal(stale.fiveHour?.state, "stale");
  const unavailable = quotaProviderDisplay(true, snapshot({ quotas: null, available: false, failureReason: "timeout" }), NOW);
  assert.equal(unavailable.status, "Unavailable");
  assert.equal(unavailable.fiveHour, null);
  assert.equal(quotaProviderDisplay(false, snapshot({ failureReason: "disabled" }), NOW).status, "Disabled");
});

test("Codex used percentages correctly invert remaining capacity", () => {
  assert.equal(formatQuotaPercent(2), "2%"); // 98% remaining
  assert.equal(formatQuotaPercent(1), "1%"); // 99% remaining
});

test("provider-confirmed zero use remains 0% in the visible five-hour window", () => {
  const view = quotaProviderDisplay(true, snapshot({ quotas: {
    fiveHour: { usedPercent: 0, resetsAt: NOW + 300 * 60_000, windowDurationMins: 300 },
    sevenDay: { usedPercent: 8, resetsAt: NOW + 10_080 * 60_000, windowDurationMins: 10_080 },
  } }), NOW);
  assert.equal(view.status, "Fresh");
  assert.equal(view.fiveHour?.percent, 0);
  assert.equal(formatQuotaPercent(view.fiveHour!.percent), "0%");
  assert.equal(view.sevenDay?.percent, 8);
});

test("window reset timestamps are retained exactly", () => {
  const resetAt = NOW + 2 * 60 * 60_000 + 10 * 60_000;
  const view = quotaProviderDisplay(true, snapshot({ quotas: {
    fiveHour: { usedPercent: 2, resetsAt: resetAt, windowDurationMins: 300 },
    sevenDay: { usedPercent: 1, resetsAt: NOW + 5 * 24 * 60 * 60_000, windowDurationMins: 10_080 },
  } }), NOW);
  assert.equal(view.fiveHour?.resetsAt, resetAt);
  assert.equal(view.fiveHour?.resetCountdown, "resets in 2h 10m");
  assert.equal(view.sevenDay?.resetsAt, NOW + 5 * 24 * 60 * 60_000);
});

test("a reset window is unavailable while an unexpired sibling remains displayable", () => {
  const data = snapshot({ quotas: {
    fiveHour: { usedPercent: 81.4, resetsAt: NOW },
    sevenDay: { usedPercent: 32.6, resetsAt: NOW + 86_400_000 },
  } });
  const view = quotaProviderDisplay(true, data, NOW);
  assert.equal(view.fiveHour?.state, "unavailable");
  assert.equal(view.sevenDay?.state, "fresh");
  assert.equal(view.fiveHour?.percent, 0, "expired percentage is never rendered; row state suppresses it");
  assert.equal(formatQuotaPercent(view.sevenDay!.usedPercent), "33%");
  assert.equal(data.quotas!.sevenDay!.usedPercent, 32.6, "raw provider value remains untouched");
});

test("disabled provider result cannot mask a re-enabled provider as Disabled", () => {
  const view = quotaProviderDisplay(true, snapshot({ quotas: null, available: false, updatedAt: null, failureReason: "disabled" }), NOW);
  assert.equal(view.status, "Loading");
});

test("reset snapshot waits for Codex activity without retaining the previous quota", () => {
  const reset = quotaProviderDisplay(true, { generation: 2, quotas: null, updatedAt: null, stale: false, available: false, failureReason: null }, NOW);
  assert.equal(reset.status, "Idle");
  assert.equal(reset.fiveHour, null);
  assert.equal(reset.lastSuccessfulUpdate, null);
});

test("real provider failures leave Loading and show Unavailable", () => {
  for (const failureReason of ["timeout", "unauthorized", "protocolError", "cliUnavailable"]) {
    assert.equal(quotaProviderDisplay(true, snapshot({ quotas: null, available: false, updatedAt: null, failureReason }), NOW).status, "Unavailable");
  }
});

test("last-known-good quota data keeps its update time and is marked stale", () => {
  setLanguage("en");
  const data = snapshot({ stale: true, failureReason: "timeout" });
  const view = quotaProviderDisplay(true, data, NOW);
  assert.equal(view.status, "Stale");
  assert.equal(view.lastSuccessfulUpdate, new Date(NOW).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }));
  assert.equal(view.fiveHour?.state, "stale");
  assert.equal(data.quotas!.fiveHour!.usedPercent, 6.4, "display does not rewrite cached quota values");
});

test("Codex reset countdown uses shared duration units while timestamps follow Nook language", () => {
  const data = snapshot({ quotas: {
    fiveHour: { usedPercent: 1, resetsAt: NOW + 4 * 60 * 60_000 + 53 * 60_000 },
    sevenDay: { usedPercent: 1, resetsAt: NOW + 6 * 24 * 60 * 60_000 },
  } });
  setLanguage("uk");
  const uk = quotaProviderDisplay(true, data, NOW);
  assert.equal(uk.fiveHour?.resetCountdown, "resets in 4h 53m");
  assert.equal(formatResetTime(uk.fiveHour!.resetsAt), new Date(uk.fiveHour!.resetsAt).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" }));
  setLanguage("en");
  const en = quotaProviderDisplay(true, data, NOW);
  assert.equal(en.sevenDay?.resetCountdown, "resets in 6d");
  assert.equal(formatResetTime(en.sevenDay!.resetsAt), new Date(en.sevenDay!.resetsAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }));
});

test("timeout without cached quotas remains unavailable and has no invented timestamp", () => {
  const view = quotaProviderDisplay(true, snapshot({ quotas: null, updatedAt: null, stale: false, available: false, failureReason: "timeout" }), NOW);
  assert.equal(view.status, "Unavailable");
  assert.equal(view.fiveHour, null);
  assert.equal(view.lastSuccessfulUpdate, null);
});

test("both reset windows are not Fresh", () => {
  const view = quotaProviderDisplay(true, snapshot({ quotas: {
    fiveHour: { usedPercent: 92, resetsAt: NOW },
    sevenDay: { usedPercent: 43, resetsAt: NOW - 1 },
  } }), NOW);
  assert.equal(view.status, "Unavailable");
});

test("opt-out clears the snapshot and rejects an in-flight read after opt-in", () => {
  const gate = new QuotaSnapshotGate();
  gate.setEnabled(true, 4);
  const inflight = snapshot({ generation: 4 });
  gate.setEnabled(false);
  assert.equal(gate.accept(null, inflight), null);
  gate.setEnabled(true, 6);
  assert.equal(gate.accept(null, inflight), null);
  assert.equal(gate.acceptEvent(inflight), null);
  const freshRead = snapshot({ generation: 6 });
  assert.equal(gate.prime(freshRead), true);
  assert.equal(gate.accept(null, freshRead), freshRead);
  assert.equal(gate.acceptEvent(freshRead), freshRead);
  gate.setEnabled(false);
  assert.equal(gate.acceptEvent(freshRead), null);
});

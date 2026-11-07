import assert from "node:assert/strict";
import test from "node:test";
import { advanceBatteryAlertGate, batteryLevel, batteryPollDelay, BATTERY_STATUS_POLL_MS, cancelIdleTimers, EMPTY_BATTERY_ALERT_CYCLE, EMPTY_BATTERY_ALERT_GATE, formatLocalClock, hasKnownBattery, IDLE_AFTER_MS, idleStatusExtent, isBatteryDischarging, latestActivityAt, NO_SYSTEM_BATTERY_RECHECK_MS, readBatteryStatus, shouldShowIdle, updateBatteryAlertCycle } from "../src/island/idle-mode.ts";

test("local 24-hour clock always formats HH:mm at minute precision", () => {
  for (const [hour, minute, expected] of [[0, 0, "00:00"], [9, 5, "09:05"], [12, 35, "12:35"], [17, 46, "17:46"], [23, 59, "23:59"]] as const) {
    const formatted = formatLocalClock(hour, minute);
    assert.equal(formatted, expected);
    assert.equal(formatted.length, 5);
  }
});

test("Idle begins at five minutes from the latest activity, without a real wait", () => {
  const at = 1_000_000;
  assert.equal(IDLE_AFTER_MS, 300_000);
  assert.equal(shouldShowIdle(at + IDLE_AFTER_MS - 1, at, 0), false);
  assert.equal(shouldShowIdle(at + IDLE_AFTER_MS, at, 0), true);
  assert.equal(shouldShowIdle(at + IDLE_AFTER_MS, at + 1, 0), false);
});

test("idle countdown uses the newer of agent activity and user interaction", () => {
  const wallNow = 5_000_000;
  const monotonicNow = 90_000;
  const recentUser = latestActivityAt(wallNow, monotonicNow, wallNow - 400_000, monotonicNow - 20_000);
  assert.equal(recentUser, wallNow - 20_000);
  assert.equal(shouldShowIdle(wallNow, recentUser, 0), false);

  const recentAgent = latestActivityAt(wallNow, monotonicNow, wallNow - 10_000, monotonicNow - 400_000);
  assert.equal(recentAgent, wallNow - 10_000);
  assert.equal(shouldShowIdle(wallNow, recentAgent, 0), false);
  assert.equal(shouldShowIdle(wallNow + IDLE_AFTER_MS, recentAgent, 0), true);
});

test("done or idle sessions do not hold the clock; a pending permission always does", () => {
  const eventAt = 5_000;
  assert.equal(shouldShowIdle(eventAt + IDLE_AFTER_MS, eventAt, 0), true);
  assert.equal(shouldShowIdle(eventAt + IDLE_AFTER_MS * 3, eventAt, 1), false);
  assert.equal(shouldShowIdle(eventAt + IDLE_AFTER_MS, eventAt, 0, true), false);
  assert.equal(shouldShowIdle(eventAt + IDLE_AFTER_MS, eventAt, 0, false, true), false, "important notifications interrupt idle mode");
});

test("battery percentage boundaries and full charge use the requested colors", () => {
  const level = (percent: number | null) => batteryLevel({ percent, acConnected: null, charging: null });
  assert.equal(level(19), "red");
  assert.equal(level(20), "yellow");
  assert.equal(level(49), "yellow");
  assert.equal(level(50), "green");
  assert.equal(level(100), "green");
  assert.equal(level(null), "unknown");
});

test("Windows power flags distinguish charging, AC, discharging and unknown battery", () => {
  assert.deepEqual(readBatteryStatus({ percent: 61, acLineStatus: 1, batteryFlag: 8 }), { percent: 61, acConnected: true, charging: true, batteryPresent: true });
  assert.deepEqual(readBatteryStatus({ percent: 49, acLineStatus: 0, batteryFlag: 1 }), { percent: 49, acConnected: false, charging: false, batteryPresent: true });
  assert.deepEqual(readBatteryStatus({ percent: 74, acLineStatus: 1, batteryFlag: 255 }), { percent: null, acConnected: true, charging: null, batteryPresent: null });
  assert.deepEqual(readBatteryStatus({ percent: 70, acLineStatus: 1, batteryFlag: 128 }), { percent: null, acConnected: true, charging: null, batteryPresent: false });
  assert.deepEqual(readBatteryStatus({ percent: null, acLineStatus: null, batteryFlag: null }), { percent: null, acConnected: null, charging: null, batteryPresent: null });
  assert.deepEqual(readBatteryStatus({ percent: 255, acLineStatus: 0, batteryFlag: 2 }), { percent: null, acConnected: false, charging: false, batteryPresent: true });
});

test("battery UI and warning eligibility require a confirmed system battery and known charge state", () => {
  const laptop = readBatteryStatus({ percent: 74, acLineStatus: 1, batteryFlag: 8 });
  const desktop = readBatteryStatus({ percent: 255, acLineStatus: 1, batteryFlag: 128 });
  const unknown = readBatteryStatus({ percent: 74, acLineStatus: 1, batteryFlag: 255 });
  const apiFailure = readBatteryStatus({ percent: null, acLineStatus: null, batteryFlag: null });
  const acOnly = readBatteryStatus({ percent: 255, acLineStatus: 1, batteryFlag: 128 });
  // Windows can expose a UPS as a battery; its valid flag and percentage are sufficient.
  const upsOnBattery = readBatteryStatus({ percent: 49, acLineStatus: 0, batteryFlag: 2 });

  assert.equal(hasKnownBattery(laptop), true);
  assert.equal(hasKnownBattery(desktop), false);
  assert.equal(hasKnownBattery(unknown), false);
  assert.equal(hasKnownBattery(apiFailure), false);
  assert.equal(hasKnownBattery(acOnly), false);
  assert.equal(hasKnownBattery(upsOnBattery), true);
  assert.equal(isBatteryDischarging(laptop), false);
  assert.equal(isBatteryDischarging(desktop), false);
  assert.equal(isBatteryDischarging(unknown), false);
  assert.equal(isBatteryDischarging(apiFailure), false);
  assert.equal(isBatteryDischarging(acOnly), false);
  assert.equal(isBatteryDischarging(upsOnBattery), true);
  // Missing a presence bit is not proof that Windows confirmed a system battery.
  assert.equal(isBatteryDischarging({ percent: 49, acConnected: false, charging: false }), false);
});

test("battery alert starts at 20, advances once at 10, and does not repeat during one discharge cycle", () => {
  const at = (percent: number, acConnected = false, charging = false) => ({ percent, acConnected, charging, batteryPresent: true });
  let cycle = updateBatteryAlertCycle(EMPTY_BATTERY_ALERT_CYCLE, at(55));
  assert.equal(cycle.alert, null);
  cycle = updateBatteryAlertCycle(cycle, at(20));
  assert.deepEqual(cycle.alert, { level: "low", percent: 20 });
  cycle = { ...cycle, alert: null }; // user dismissed; the threshold stays consumed
  cycle = updateBatteryAlertCycle(cycle, at(19));
  assert.equal(cycle.alert, null);
  cycle = updateBatteryAlertCycle(cycle, at(10));
  assert.deepEqual(cycle.alert, { level: "critical", percent: 10 });
  cycle = { ...cycle, alert: null };
  cycle = updateBatteryAlertCycle(cycle, at(9));
  assert.equal(cycle.alert, null);
});

test("startup at 15 shows only low; startup at 8 shows only critical", () => {
  const at = (percent: number) => ({ percent, acConnected: false, charging: false, batteryPresent: true });
  assert.deepEqual(updateBatteryAlertCycle(EMPTY_BATTERY_ALERT_CYCLE, at(15)).alert, { level: "low", percent: 15 });
  const critical = updateBatteryAlertCycle(EMPTY_BATTERY_ALERT_CYCLE, at(8));
  assert.deepEqual(critical.alert, { level: "critical", percent: 8 });
  assert.equal(critical.lowNotified, true);
});

test("threshold boundary transitions and verified charging rearm a new discharge cycle", () => {
  const at = (percent: number, acConnected = false, charging = false) => ({ percent, acConnected, charging, batteryPresent: true });
  let cycle = updateBatteryAlertCycle(EMPTY_BATTERY_ALERT_CYCLE, at(21));
  assert.equal(cycle.alert, null);
  cycle = updateBatteryAlertCycle(cycle, at(20));
  assert.equal(cycle.alert?.level, "low");
  cycle = { ...cycle, alert: null };
  cycle = updateBatteryAlertCycle(cycle, at(11));
  assert.equal(cycle.alert, null);
  cycle = updateBatteryAlertCycle(cycle, at(10));
  assert.equal(cycle.alert?.level, "critical");
  cycle = updateBatteryAlertCycle(cycle, at(10, true, false));
  cycle = updateBatteryAlertCycle(cycle, at(10, false, false));
  assert.equal(cycle.alert, null, "brief AC fluctuations must not reset consumed thresholds");
  cycle = updateBatteryAlertCycle(cycle, at(85, true, true));
  assert.equal(cycle.lowNotified, true, "one recovery sample cannot rearm a cycle");
  cycle = updateBatteryAlertCycle(cycle, at(85, true, true));
  assert.equal(cycle.lowNotified, false);
  cycle = updateBatteryAlertCycle(cycle, at(20));
  assert.equal(cycle.alert?.level, "low");
});

test("AC, charging, unknown and absent battery suppress alerts; only recovered charging rearms a cycle", () => {
  const low = updateBatteryAlertCycle(EMPTY_BATTERY_ALERT_CYCLE, { percent: 19, acConnected: false, charging: false, batteryPresent: true });
  assert.equal(updateBatteryAlertCycle(low, { percent: 19, acConnected: true, charging: false, batteryPresent: true }).alert, null);
  assert.equal(updateBatteryAlertCycle(low, { percent: 19, acConnected: true, charging: true, batteryPresent: true }).alert, null);
  assert.equal(updateBatteryAlertCycle(low, { percent: null, acConnected: null, charging: null, batteryPresent: null }).alert, null);
  assert.equal(updateBatteryAlertCycle(low, { percent: null, acConnected: true, charging: null, batteryPresent: false }).alert, null);
  const partialCharge = updateBatteryAlertCycle(low, { percent: 55, acConnected: true, charging: true, batteryPresent: true });
  assert.equal(partialCharge.lowNotified, true);
  const firstRecoverySample = updateBatteryAlertCycle(partialCharge, { percent: 80, acConnected: true, charging: true, batteryPresent: true });
  assert.equal(firstRecoverySample.lowNotified, true);
  assert.equal(updateBatteryAlertCycle(firstRecoverySample, { percent: 80, acConnected: true, charging: true, batteryPresent: true }).lowNotified, false);
});

test("AC-connected but not charging is never assumed to be discharging", () => {
  const status = { percent: 19, acConnected: true, charging: false, batteryPresent: true };
  assert.equal(isBatteryDischarging(status), false);
  assert.equal(updateBatteryAlertCycle(EMPTY_BATTERY_ALERT_CYCLE, status).alert, null);
});

test("battery monitor uses one economical interval and a longer no-system-battery recheck", () => {
  const known = { percent: 55, acConnected: false, charging: false, batteryPresent: true };
  const absent = { percent: null, acConnected: true, charging: null, batteryPresent: false };
  assert.equal(batteryPollDelay(known), BATTERY_STATUS_POLL_MS);
  assert.equal(batteryPollDelay(absent), NO_SYSTEM_BATTERY_RECHECK_MS);
  assert.equal(batteryPollDelay(null), BATTERY_STATUS_POLL_MS);
  assert.equal(idleStatusExtent(known), 138);
  assert.equal(idleStatusExtent(absent), 64);
  assert.equal(idleStatusExtent(known, true), 67);
  assert.equal(idleStatusExtent(absent, true), 20);
  assert.equal(idleStatusExtent({ percent: null, acConnected: null, charging: null, batteryPresent: null }), 64);
  assert.deepEqual([9, 10, 20, 75, 99, 100].map((percent) => idleStatusExtent({ percent, acConnected: false, charging: percent === 99 || percent === 75, batteryPresent: true })), [138, 138, 138, 138, 138, 138]);
});

test("permission cards defer an active or new battery alert and release it once", () => {
  const active = advanceBatteryAlertGate(EMPTY_BATTERY_ALERT_GATE, "low", false, false);
  assert.equal(active.present, true);
  const interrupted = advanceBatteryAlertGate(active.gate, "low", true, true);
  assert.equal(interrupted.present, false);
  const resumed = advanceBatteryAlertGate(interrupted.gate, "low", false, false);
  assert.equal(resumed.present, true);
  assert.equal(advanceBatteryAlertGate(resumed.gate, "low", false, false).present, false);
  const thresholdDuringPermission = advanceBatteryAlertGate(EMPTY_BATTERY_ALERT_GATE, "low", true, false);
  assert.equal(thresholdDuringPermission.present, false);
  assert.equal(advanceBatteryAlertGate(thresholdDuringPermission.gate, "low", false, false).present, true);
  assert.equal(advanceBatteryAlertGate(resumed.gate, "critical", false, false).present, true, "the critical threshold surfaces after a low card auto-closes");
});

test("destroy clears every armed Idle timer and ignores already-cleared handles", () => {
  const cleared: number[] = [];
  cancelIdleTimers({ activity: 11, clock: 12, battery: 13 }, (id) => cleared.push(id));
  cancelIdleTimers({ activity: null, clock: null, battery: null }, (id) => cleared.push(id));
  assert.deepEqual(cleared, [11, 12, 13]);
});

import { IDLE_BATTERY_GROUP_W, IDLE_CLOCK_BATTERY_GAP, IDLE_CLOCK_W, IDLE_SIDE_BATTERY_H, IDLE_SIDE_CLOCK_H, IDLE_SIDE_GROUP_GAP } from "../core/layout";

/** Rules shared by Compact Island and its fake-clock regression tests. */
export const IDLE_AFTER_MS = 300_000;
export const BATTERY_STATUS_POLL_MS = 60_000;
export const NO_SYSTEM_BATTERY_RECHECK_MS = 5 * 60_000;

export function formatLocalClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Convert performance.now() user activity to wall time and compare it with agent hooks. */
export function latestActivityAt(now: number, monotonicNow: number, lastAgentEventAt: number, lastUserActivityAt: number): number {
  const userAge = Math.max(0, monotonicNow - lastUserActivityAt);
  return Math.max(lastAgentEventAt, now - userAge);
}

export function cancelIdleTimers(
  timers: { activity: number | null; clock: number | null; battery: number | null },
  cancel: (id: number) => void,
): void {
  for (const id of [timers.activity, timers.clock, timers.battery]) if (id != null) cancel(id);
}

export function shouldShowIdle(now: number, lastActivityAt: number, pendingRequests: number, activeWork = false, importantNotification = false): boolean {
  return pendingRequests === 0 && !activeWork && !importantNotification && now - lastActivityAt >= IDLE_AFTER_MS;
}

export interface BatteryStatus {
  percent: number | null;
  acConnected: boolean | null;
  charging: boolean | null;
  /** null means the API could not confirm either presence or absence. */
  batteryPresent: boolean | null;
}

export function batteryPollDelay(status: BatteryStatus | null): number {
  return status?.batteryPresent === false ? NO_SYSTEM_BATTERY_RECHECK_MS : BATTERY_STATUS_POLL_MS;
}

export function idleStatusExtent(status: BatteryStatus | null, sideDock = false): number {
  const hasBattery = hasKnownBattery(status ?? { percent: null, acConnected: null, charging: null, batteryPresent: null });
  if (sideDock) return IDLE_SIDE_CLOCK_H + (hasBattery ? IDLE_SIDE_GROUP_GAP + IDLE_SIDE_BATTERY_H : 0);
  return IDLE_CLOCK_W + (hasBattery ? IDLE_CLOCK_BATTERY_GAP + IDLE_BATTERY_GROUP_W : 0);
}

export type BatteryLevel = "green" | "yellow" | "red" | "unknown";

export function batteryLevel(status: Pick<BatteryStatus, "percent">): BatteryLevel {
  if (status.percent == null || !Number.isFinite(status.percent)) return "unknown";
  if (status.percent < 20) return "red";
  if (status.percent < 50) return "yellow";
  return "green";
}

/** GetSystemPowerStatus exposes a usable battery only when both fields are known. */
export function hasKnownBattery(status: { percent: number | null; charging: boolean | null; batteryPresent?: boolean | null }): boolean {
  return status.percent != null && Number.isInteger(status.percent) && status.percent >= 0 && status.percent <= 100
    && status.charging != null && status.batteryPresent === true;
}

/** Eligibility for future battery warnings; no alert UI is implemented here. */
export function isBatteryDischarging(status: {
  percent: number | null;
  acConnected: boolean | null;
  charging: boolean | null;
  batteryPresent?: boolean | null;
}): boolean {
  return hasKnownBattery(status) && status.acConnected === false && status.charging === false;
}

/** Maps GetSystemPowerStatus values without inventing unknown fields. */
export function readBatteryStatus(raw: { percent: number | null; acLineStatus: number | null; batteryFlag: number | null }): BatteryStatus {
  const acConnected = raw.acLineStatus === 0 ? false : raw.acLineStatus === 1 ? true : null;
  const batteryPresent = raw.batteryFlag == null || raw.batteryFlag === 255
    ? null
    : (raw.batteryFlag & 128) === 0;
  const percent = batteryPresent === true && raw.percent != null && Number.isInteger(raw.percent) && raw.percent >= 0 && raw.percent <= 100
    ? raw.percent
    : null;
  const charging = batteryPresent === true ? (raw.batteryFlag! & 8) !== 0 : null;
  return { percent, acConnected, charging, batteryPresent };
}

export type BatteryAlertLevel = "low" | "critical";
export interface BatteryAlert { level: BatteryAlertLevel; percent: number }
export interface BatteryAlertCycle {
  lowNotified: boolean;
  criticalNotified: boolean;
  alert: BatteryAlert | null;
  recoverySamples: number;
}
export const EMPTY_BATTERY_ALERT_CYCLE: BatteryAlertCycle = { lowNotified: false, criticalNotified: false, alert: null, recoverySamples: 0 };

export interface BatteryAlertGate { shown: boolean; deferred: boolean; level: BatteryAlertLevel | null }
export const EMPTY_BATTERY_ALERT_GATE: BatteryAlertGate = { shown: false, deferred: false, level: null };
export function advanceBatteryAlertGate(
  gate: BatteryAlertGate,
  level: BatteryAlertLevel | null,
  permissionPending: boolean,
  batteryCardWasVisible: boolean,
): { gate: BatteryAlertGate; present: boolean } {
  if (!level) return { gate: EMPTY_BATTERY_ALERT_GATE, present: false };
  if (permissionPending) return { gate: { level, shown: gate.shown && !batteryCardWasVisible, deferred: gate.deferred || batteryCardWasVisible }, present: false };
  if (gate.level !== level && gate.shown && !batteryCardWasVisible) return { gate: { level, shown: true, deferred: false }, present: true };
  if (!gate.shown || gate.deferred) return { gate: { level, shown: true, deferred: false }, present: true };
  return { gate: { ...gate, level }, present: false };
}

/** Pure per-charge-cycle rules. Startup below both thresholds raises only the most urgent alert. */
export function updateBatteryAlertCycle(previous: BatteryAlertCycle, status: BatteryStatus): BatteryAlertCycle {
  if (status.acConnected === true || status.charging === true) {
    const recovered = status.charging === true && status.percent != null && status.percent >= 80;
    if (recovered && previous.recoverySamples >= 1) return EMPTY_BATTERY_ALERT_CYCLE;
    return { ...previous, alert: null, recoverySamples: recovered ? previous.recoverySamples + 1 : 0 };
  }
  if (status.batteryPresent === false || !hasKnownBattery(status)) return { ...previous, alert: null, recoverySamples: 0 };
  if (!isBatteryDischarging(status)) return previous;
  const percent = status.percent!;
  if (!previous.lowNotified && percent <= 20) {
    const critical = percent <= 10;
    return {
      lowNotified: true,
      criticalNotified: critical,
      alert: { level: critical ? "critical" : "low", percent },
      recoverySamples: 0,
    };
  }
  if (!previous.criticalNotified && percent <= 10) {
    return { ...previous, criticalNotified: true, alert: { level: "critical", percent }, recoverySamples: 0 };
  }
  return previous.alert ? { ...previous, alert: { ...previous.alert, percent }, recoverySamples: 0 } : { ...previous, recoverySamples: 0 };
}

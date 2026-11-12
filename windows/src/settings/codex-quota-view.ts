import { currentLanguage, message } from "../core/i18n";
import { resetCountdown } from "../core/state";

export type QuotaProviderStatus = "Disabled" | "Loading" | "Idle" | "Fresh" | "Stale" | "Unavailable";

export interface QuotaWindowValue {
  usedPercent: number;
  resetsAt: number;
  windowDurationMins?: number;
}

export interface QuotaProviderSnapshot {
  generation?: number;
  quotas: { fiveHour: QuotaWindowValue | null; sevenDay: QuotaWindowValue | null } | null;
  updatedAt: number | null;
  stale: boolean;
  available: boolean;
  failureReason: string | null;
}

export type CodexQuotaInput = Omit<QuotaProviderSnapshot, "quotas"> & {
  quotas: { fiveHour: (QuotaWindowValue & { windowDurationMins?: number }) | null; sevenDay: (QuotaWindowValue & { windowDurationMins?: number }) | null } | null;
};

export interface QuotaWindowDisplay extends QuotaWindowValue {
  percent: number;
  resetCountdown: string;
  state: "fresh" | "stale" | "unavailable";
}

export interface QuotaProviderDisplay {
  status: QuotaProviderStatus;
  fiveHour: QuotaWindowDisplay | null;
  sevenDay: QuotaWindowDisplay | null;
  updatedAt: number | null;
  lastSuccessfulUpdate: string | null;
  failureReason: string | null;
}

export const formatQuotaPercent = (value: number): string => `${Math.max(0, Math.min(100, Math.round(value)))}%`;

export function formatResetTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(currentLanguage() === "uk" ? "uk-UA" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
};

function showWindow(value: QuotaWindowValue | null | undefined, status: QuotaProviderStatus, now: number): QuotaWindowDisplay | null {
  if (!value) return null;
  if (value.resetsAt > 0 && now >= value.resetsAt) return { ...value, percent: 0, resetCountdown: "", state: "unavailable" };
  return {
    ...value,
    windowDurationMins: value.windowDurationMins,
    percent: Math.max(0, Math.min(100, value.usedPercent)),
    resetCountdown: value.resetsAt > 0 ? resetCountdown(value.resetsAt - now) : "",
    state: status === "Stale" ? "stale" : status === "Fresh" ? "fresh" : "unavailable",
  };
}

const formatLocalTime = (timestamp: number): string => new Date(timestamp).toLocaleString(currentLanguage() === "uk" ? "uk-UA" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

export function quotaFailureReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    timeout: "Timed out", unauthorized: "Not authorized", protocolError: "Unexpected provider response",
    cliUnavailable: "Codex CLI unavailable", spawnFailed: "Could not start Codex", serverExited: "Codex provider stopped",
    quotaUnavailable: "Quota data unavailable", disabled: "Provider is disabled", processIsolationUnavailable: "Process isolation unavailable",
  };
  return message(labels[reason] ?? "Unknown error");
}

/** Resolve provider state and windows using numeric timestamps; formatting belongs to the UI. */
export function quotaProviderDisplay(enabled: boolean, snapshot: CodexQuotaInput | QuotaProviderSnapshot | null, now = Date.now()): QuotaProviderDisplay {
  let status: QuotaProviderStatus;
  if (!enabled) status = "Disabled";
  else if (!snapshot) status = "Loading";
  else if (snapshot.failureReason === "disabled") status = "Loading";
  else if (snapshot.stale && (snapshot.quotas?.fiveHour || snapshot.quotas?.sevenDay)) status = "Stale";
  else if (snapshot.available && (snapshot.quotas?.fiveHour || snapshot.quotas?.sevenDay)) {
    const windows = [snapshot.quotas?.fiveHour, snapshot.quotas?.sevenDay].filter((window): window is QuotaWindowValue => !!window && (window.resetsAt <= 0 || window.resetsAt > now));
    status = windows.length ? "Fresh" : "Unavailable";
  } else if (!snapshot.failureReason && snapshot.quotas == null && snapshot.updatedAt == null) status = "Idle";
  else status = "Unavailable";

  const showWindows = enabled && (status === "Fresh" || status === "Stale");
  const win = (value: QuotaWindowValue | null | undefined) => showWindows ? showWindow(value, status, now) : null;
  return {
    status,
    fiveHour: win(snapshot?.quotas?.fiveHour),
    sevenDay: win(snapshot?.quotas?.sevenDay),
    updatedAt: snapshot?.updatedAt ?? null,
    lastSuccessfulUpdate: snapshot?.updatedAt == null ? null : formatLocalTime(snapshot.updatedAt),
    failureReason: snapshot?.failureReason ?? null,
  };
}

/** Reset a cached snapshot without letting an earlier async read repopulate it. */
export class QuotaSnapshotGate {
  private providerGeneration: number | null = null;
  private enabled = false;

  setEnabled(enabled: boolean, providerGeneration?: number): void {
    this.enabled = enabled;
    if (!enabled) this.providerGeneration = null;
    else if (providerGeneration != null) this.providerGeneration = providerGeneration;
  }

  token(): number | null { return this.enabled ? this.providerGeneration : null; }

  accept(token: number | null, snapshot: QuotaProviderSnapshot | null): QuotaProviderSnapshot | null {
    if (!this.enabled || !snapshot) return null;
    if (snapshot.generation == null) return null;
    if (token != null && snapshot.generation !== token) return null;
    if (this.providerGeneration == null) this.providerGeneration = snapshot.generation;
    if (snapshot.generation < this.providerGeneration) return null;
    if (snapshot.generation > this.providerGeneration) this.providerGeneration = snapshot.generation;
    return snapshot;
  }

  prime(snapshot: QuotaProviderSnapshot | null): boolean {
    if (!this.enabled || snapshot?.generation == null) return false;
    this.providerGeneration = snapshot.generation;
    return true;
  }

  acceptEvent(snapshot: QuotaProviderSnapshot | null): QuotaProviderSnapshot | null {
    if (!this.enabled || !snapshot) return null;
    if (this.providerGeneration == null || snapshot.generation == null) return null;
    if (snapshot.generation < this.providerGeneration) return null;
    if (snapshot.generation > this.providerGeneration) this.providerGeneration = snapshot.generation;
    return snapshot;
  }
}

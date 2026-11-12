// The folded island (plans/design-plan.md §2): fixed slots, left to right —
// the bot, which speaks for the most urgent session; a dot per session, most
// urgent first; up to three metric cells picked in Settings. Each slot has its
// own width, an empty one goes with its gap, and what does not fit under the
// cap folds away: the last metric first, then dots into "+N". On a side the
// same slots stand top to bottom in a column (style.css, layout.ts
// `compactLayout`); nothing here differs.
//
// The bot is not drawn here: island.ts places its canvas over the first slot.
// A cell's number is written when a sample comes (State.onGauges) and at no
// other time: nothing here runs a frame.

import {
  COMPACT_AGENT_ICON_H, COMPACT_AGENT_ICON_SIZE, COMPACT_AGENT_ICON_W, COMPACT_AGENT_SIDE_ADVANCE, COMPACT_BOT_SLOT, COMPACT_CELL_H, COMPACT_COLUMN_W, COMPACT_DOT, COMPACT_DOT_GAP, COMPACT_METRIC_GAP, COMPACT_MORE_W,
  COMPACT_PAD, COMPACT_READING_GAP, COMPACT_SLOT_GAP, COMPACT_USAGE_CELL_W, COMPACT_WAITING_CELL_W, IDLE_BATTERY_GROUP_W, IDLE_CLOCK_BATTERY_GAP, IDLE_CLOCK_W, IDLE_SIDE_BATTERY_H, IDLE_SIDE_CLOCK_H, IDLE_SIDE_GROUP_GAP, NOTCH_H, Room, compactLayout, type CompactLayout,
} from "../core/layout";
import {
  State, USAGE_RESET_WORDS, USAGE_SOURCE_WORDS, compactMetrics, usageLevel, usageShown,
  type CompactMetric, type Usage, type UsageLevel,
} from "../core/state";
import { clear, h } from "../views/dom";
import { message } from "../core/i18n";
import { CLAUDE_BRAND_MARK, LUCIDE, OPENAI_BRAND_MARK, brand, lucide } from "../views/iconset";
import { wear } from "../views/palette";
import { DOT_LEGEND, TOOL_NAME } from "../views/tool";
import { labelText, roster, stateWords, waitingCount, type Entry } from "../views/roster";
import { quotaFailureReasonLabel, quotaProviderDisplay } from "../settings/codex-quota-view";
import { createCompactUsageCycle, type UsageAgent } from "./compact-usage-cycle";
import { Bridge, type DevBatteryStatus } from "../core/bridge";
import { advanceBatteryAlertGate, batteryLevel, batteryPollDelay, cancelIdleTimers, EMPTY_BATTERY_ALERT_CYCLE, EMPTY_BATTERY_ALERT_GATE, formatLocalClock, hasKnownBattery, IDLE_AFTER_MS, idleStatusExtent, latestActivityAt, shouldShowIdle, updateBatteryAlertCycle, type BatteryAlert, type BatteryAlertCycle, type BatteryAlertGate } from "./idle-mode";
import { isQuiet } from "../core/state";

/** A cell's icon, and its number's size: the icons of the set, on their 24 px grid. */
const COMPACT_ICON = 14;
/** Each cell, wide enough for the worst it can say. */
const METRIC: Record<CompactMetric, { width: number; name: string; icon: string }> = {
  usage5h: { width: COMPACT_USAGE_CELL_W, name: "5-hour usage", icon: LUCIDE.timer },
  usage7d: { width: COMPACT_USAGE_CELL_W, name: "7-day usage", icon: LUCIDE.calendarDays },
  waiting: { width: COMPACT_WAITING_CELL_W, name: "Sessions waiting for you", icon: LUCIDE.bell },
};

/** A cell as it reads now: its number, what its tooltip adds, and — for usage — how it is coloured. */
export interface Reading {
  /** "—" where nothing is known yet, in the same cell. */
  text: string;
  more?: string;
  level?: UsageLevel;
  /** A usage window that has reset, or a number more than two hours old: drawn dimmed. */
  dim?: boolean;
}

/** What the cells are read from: each provider's usage and how many sessions wait. */
export interface Gauges {
  usage: Usage | null;
  waiting: number;
  codexQuota?: import("../core/bridge").CodexQuotaSnapshot | null;
  codexEnabled?: boolean;
  usageAgent?: "claude" | "codex";
  /** The time the usage is read at (Unix ms): now, when not said. */
  now?: number;
}

let usageAgent: "claude" | "codex" = "claude";
const NOOK_DEV_BUILD = __NOOK_DEV_BUILD__;
const STANDALONE_BUILD = __NOOK_STANDALONE_BUILD__;
const CODEX_QUOTA_BUILD = __NOOK_DEV_BUILD__ || __NOOK_STANDALONE_BUILD__;
const USAGE_ROTATION_BUILD = NOOK_DEV_BUILD || STANDALONE_BUILD;
const IDLE_CLOCK_BUILD = USAGE_ROTATION_BUILD;
export const compactAgentName = (agent: UsageAgent) => agent === "codex" ? "Codex" : "Claude";
export const compactAgentPath = (agent: UsageAgent) => agent === "codex" ? OPENAI_BRAND_MARK : CLAUDE_BRAND_MARK;
const compactAgentMark = (agent: UsageAgent) => brand(compactAgentPath(agent), COMPACT_AGENT_ICON_SIZE);

/** Waiting changes animate only when the count rises, and never under reduced motion. */
export function waitingSignal(waiting: number, previous: number, reducedMotion: boolean) {
  return { active: waiting > 0, animate: waiting > previous && waiting > 0 && !reducedMotion };
}

export function compactReducedMotion(choice: "system" | "on" | "off", systemReduced: boolean) {
  return choice === "on" || (choice === "system" && systemReduced);
}

/** Providers with at least one current quota window; stale values remain useful until their reset. */
export function availableCompactUsageAgents(from: Gauges, now = from.now ?? Date.now()): UsageAgent[] {
  const available: UsageAgent[] = [];
  const claude = [from.usage?.fiveHour, from.usage?.sevenDay]
    .some((window) => !!window && usageShown(window, from.usage?.updatedAt ?? now, now)?.state !== "reset");
  if (claude) available.push("claude");
  if (CODEX_QUOTA_BUILD && from.codexEnabled) {
    const codex = quotaProviderDisplay(true, from.codexQuota ?? null, now);
    if ((codex.status === "Fresh" || codex.status === "Stale") && [codex.fiveHour, codex.sevenDay].some((window) => window?.state === "fresh" || window?.state === "stale")) {
      available.push("codex");
    }
  }
  return available;
}

/** What one cell says, from the gauges alone: nothing here looks at the island. */
export function reading(kind: CompactMetric, { usage, waiting, codexQuota, codexEnabled = false, usageAgent: agent = "claude", now = Date.now() }: Gauges): Reading {
  switch (kind) {
    case "usage5h":
    case "usage7d": {
      if (CODEX_QUOTA_BUILD && agent === "codex") {
        const display = quotaProviderDisplay(codexEnabled, codexQuota ?? null, now);
        const win = kind === "usage5h" ? display.fiveHour : display.sevenDay;
        const agentName = compactAgentName("codex");
        if (!win || win.state === "unavailable") {
          const state = win?.state === "unavailable" ? message(USAGE_RESET_WORDS) : display.status === "Idle" ? message("Waiting for Codex activity") : message(display.status);
          const reason = display.failureReason ? quotaFailureReasonLabel(display.failureReason) : "";
          return { text: "—", more: [agentName, state, reason].filter(Boolean).join(" · "), dim: true };
        }
        return {
          text: `${Math.round(win.percent)}%`,
          more: [message(display.status), win.resetCountdown ? message(win.resetCountdown) : ""].filter(Boolean).join(" · "),
          level: usageLevel(win.percent),
          dim: win.state !== "fresh",
        };
      }
      const shown = usageShown(kind === "usage5h" ? usage?.fiveHour : usage?.sevenDay, usage?.updatedAt ?? now, now);
      if (!shown) return { text: "—" };
      // Past its reset the old number is not shown: 0 %, dimmed, and the tooltip says why.
      const reset = shown.state === "reset";
      return {
        text: `${shown.percent}%`,
        more: [shown.countdown ? message(shown.countdown) : "", message(USAGE_SOURCE_WORDS)].filter(Boolean).join(". "),
        level: reset ? undefined : usageLevel(shown.percent),
        dim: shown.state !== "fresh",
      };
    }
    case "waiting":
      return {
        text: String(Math.min(99, waiting)),
        more: message("{waiting} waiting", { waiting }),
      };
  }
}

const gauges = (): Gauges => ({
  usage: State.usage,
  waiting: waitingCount(),
  codexQuota: State.codexQuota,
  codexEnabled: CODEX_QUOTA_BUILD && State.settings.codexQuotaEnabled,
  usageAgent,
});

const isUsageMetric = (kind: CompactMetric) => kind === "usage5h" || kind === "usage7d";

/** Explicit, in-memory quota source for the isolated Dev rotation fixture. */
export interface CompactDevFixture {
  gauges: () => Partial<Gauges>;
  schedule?: (callback: () => void, delay: number) => number;
  cancel?: (id: number) => void;
}

/** A session's dot, as it is drawn. */
export interface SlotDot {
  id: string;
  color: string;
  /** It asks for the user: it pulses. */
  calls: boolean;
  /** At rest. */
  rest: boolean;
  /** Its last reply waits on a decision. */
  decision: boolean;
  /** A Cursor session: its dot has a hole, where Claude Code's is solid. */
  cursor: boolean;
  title: string;
}

/** A metric cell, as it is drawn. */
export interface SlotCell extends Reading {
  kind: CompactMetric;
  title: string;
}

/** Everything the folded island shows beside its bot. */
export interface CompactSlots {
  dots: SlotDot[];
  /** "+N": the sessions with no dot of their own, in the colour of the most urgent of them. */
  more: { count: number; color: string; calls: boolean } | null;
  cells: SlotCell[];
}

/**
 * What the folded island shows, as a plain function of what it is given: the
 * plan (who is on the island, which cells were picked, what fits) and the
 * gauges. It is what `sync` draws — on any change of state, and at once when
 * the island comes back from hidden — and what the wake self-check reads
 * (dev/preview-b/island-check.ts).
 */
export function compactSlots(plan: CompactPlan, from: Gauges): CompactSlots {
  const shown = plan.live.slice(0, plan.dots);
  const hidden = plan.live.slice(plan.dots);
  return {
    dots: shown.map((entry) => ({
      id: entry.id, color: entry.color, calls: entry.rank === 0, rest: entry.lane === "done",
      decision: entry.decision && entry.lane === "done",
      cursor: entry.session?.agent === "cursor",
      title: (() => {
        const legend = plan.live.some((e) => e.session?.agent === "cursor") ? DOT_LEGEND : "";
        const values = { label: labelText(entry), state: stateWords(entry), legend };
        return entry.session
          ? legend ? message("{agent} · {label} — {state}\n{legend}", { ...values, agent: TOOL_NAME[entry.session.agent] })
            : message("{agent} · {label} — {state}", { ...values, agent: TOOL_NAME[entry.session.agent] })
          : legend ? message("{label} — {state}\n{legend}", values) : message("{label} — {state}", values);
      })(),
    })),
    more: hidden.length ? { count: hidden.length, color: hidden[0].color, calls: hidden[0].rank === 0 } : null,
    cells: plan.kinds.map((kind) => {
      const read = reading(kind, from);
      const name = message(METRIC[kind].name);
      return { kind, ...read, title: read.more ? message("{name} · {detail}", { name, detail: read.more }) : name };
    }),
  };
}

export interface CompactPlan extends CompactLayout {
  /** Everything with a place, most urgent first: the first `dots` are on show. */
  live: Entry[];
  kinds: CompactMetric[];
  idle: boolean;
}

/** Plans paired quota cells together; on a narrow display, only non-quota cells may survive alone. */
export function compactMetricLayout(
  kinds: readonly CompactMetric[], sessions: number, dock = Room.dock, cap?: number,
): { layout: CompactLayout; kinds: CompactMetric[] } {
  const markBefore = kinds.findIndex(isUsageMetric);
  let layout = compactLayout(sessions, kinds.map((kind) => METRIC[kind].width), dock, cap, markBefore);
  let visible = kinds.slice(0, layout.metrics);
  if (visible.length === 1 && isUsageMetric(visible[0]!) && kinds.filter(isUsageMetric).length === 2) {
    if (kinds.includes("waiting")) {
      layout = compactLayout(sessions, [METRIC.waiting.width], dock, cap);
      visible = layout.metrics ? ["waiting"] : [];
    } else {
      layout = compactLayout(sessions, [], dock, cap);
      visible = [];
    }
  }
  return { layout, kinds: visible };
}

/** What the folded island holds now, and how wide that makes it. */
export function compactPlan(): CompactPlan {
  const { live } = roster();
  const selectedKinds = compactMetrics(State.settings);
  // Keep both quota windows ahead of optional cells under the compact width cap.
  const kinds = selectedKinds.includes("usage5h") && selectedKinds.includes("usage7d")
    ? ["usage5h", "usage7d", ...selectedKinds.filter((kind) => !isUsageMetric(kind))] as CompactMetric[]
    : selectedKinds;
  const now = Date.now();
  const lastActivityAt = latestActivityAt(now, performance.now(), State.lastAgentEventAt, State.lastActivity);
  const activeWork = IDLE_CLOCK_BUILD && State.sessions.some((session) => session.agent !== "cursor"
    && (session.state === "working" || session.state === "thinking" || session.state === "searching")
    && !session.approval && !session.question && !isQuiet(session, now));
  const importantNotification = State.batteryAlert != null || State.sessions.some((session) => session.state === "error");
  const idle = IDLE_CLOCK_BUILD && State.mode === "compact"
    && shouldShowIdle(now, lastActivityAt, waitingCount(), activeWork, importantNotification);
  if (idle) {
    const side = Room.dock === "left" || Room.dock === "right";
    const statusExtent = idleStatusExtent(State.batteryStatus, side);
    const length = COMPACT_PAD * 2 + COMPACT_BOT_SLOT + COMPACT_SLOT_GAP + statusExtent;
    return { dots: 0, metrics: 0, width: side ? COMPACT_COLUMN_W : length, height: side ? length : NOTCH_H, live, kinds: [], idle };
  }
  const planned = compactMetricLayout(kinds, live.length, Room.dock);
  return { ...planned.layout, live, kinds: planned.kinds, idle };
}

export interface CompactStrip {
  el: HTMLElement;
  /** Draws what the plan holds; nothing is rebuilt when it has not changed. */
  sync(plan: CompactPlan): void;
  /** Pauses quota rotation while the pointer reads the Island. */
  setHovered(on: boolean): void;
  /**
   * Builds every slot again, changed or not. The island comes back from hidden
   * in a window that is still the 6 px wake strip, and what was painted of the
   * slots then is what stays once the window has grown: nothing else writes to
   * them. New elements are painted in the window as it is.
   */
  redraw(plan: CompactPlan): void;
  /** Releases rotation and idle/battery timers and listeners when the UI is unmounted. */
  destroy(): void;
  dismissBatteryAlert(): void;
  startBatteryMonitor(): void;
  simulateBattery(action: string, sample: DevBatteryStatus | null): void;
  deferBatteryAlert(): void;
}

export interface CompactBatteryAlertHandlers {
  present(): void;
  alertChanged(alert: BatteryAlert): void;
  cleared(): void;
}

export function buildCompact(devFixture?: CompactDevFixture, batteryAlertHandlers?: CompactBatteryAlertHandlers): CompactStrip {
  const dots = h("div", { class: "ci-dots", style: `gap:${COMPACT_DOT_GAP}px` });
  const metrics = h("div", { class: "ci-metrics", style: `gap:${COMPACT_METRIC_GAP}px` });
  const idleTime = h("time", { class: "ci-idle-time", "aria-label": "Local time" });
  const batteryRing = h("span", { class: "ci-battery-ring", role: "img", "aria-label": "Battery status" });
  const batteryValue = h("b", { class: "ci-battery-value" });
  const batteryDisplay = h("span", { class: "ci-battery-display" }, batteryRing, batteryValue);
  const idleStatus = h("div", { class: "ci-idle-status" }, idleTime, batteryDisplay);
  // The slots' sizes, from layout.ts: style.css lays them out in a row, or in a
  // column on a side, from the same numbers — the dock can change under them.
  const el = h(
    "div",
    {
      id: "compact",
      "data-nook-action": "compact-open",
      style: `--pad:${COMPACT_PAD}px;--slot-gap:${COMPACT_SLOT_GAP}px;--bot-slot:${COMPACT_BOT_SLOT}px;` +
        `--column-w:${COMPACT_COLUMN_W}px;--cell-h:${COMPACT_CELL_H}px;--compact-reading-gap:${COMPACT_READING_GAP}px;` +
        `--idle-clock-w:${IDLE_CLOCK_W}px;--idle-clock-battery-gap:${IDLE_CLOCK_BATTERY_GAP}px;` +
        `--idle-battery-group-w:${IDLE_BATTERY_GROUP_W}px;--idle-side-clock-h:${IDLE_SIDE_CLOCK_H}px;` +
        `--idle-side-battery-h:${IDLE_SIDE_BATTERY_H}px;--idle-side-group-gap:${IDLE_SIDE_GROUP_GAP}px`,
    },
    // The bot's slot: empty, the island's own canvas sits over it.
    h("div", { class: "ci-bot" }),
    dots,
    metrics,
    idleStatus,
  );

  let dotsKey = "";
  let metricsKey = "";
  interface CellElements { cell: HTMLElement; value: HTMLElement }
  /** The cells on show, by kind. The provider mark is a separate fixed slot. */
  const values = new Map<CompactMetric, CellElements>();
  let agentLabel: HTMLElement | null = null;
  let hovered = false;
  let previousWaiting = waitingCount();
  let batteryTimer: number | null = null;
  let clockTimer: number | null = null;
  let activityTimer: number | null = null;
  let idleOn = false;
  let disposed = false;
  let batteryCycle: BatteryAlertCycle = EMPTY_BATTERY_ALERT_CYCLE;
  let batteryAlertGate: BatteryAlertGate = EMPTY_BATTERY_ALERT_GATE;
  let batterySimulated = false;
  let batteryReadGeneration = 0;
  const showTime = () => {
    const now = new Date();
    const clock = formatLocalClock(now.getHours(), now.getMinutes());
    idleTime.dateTime = clock;
    idleTime.textContent = clock;
  };
  const acceptBatterySample = (sample: DevBatteryStatus) => {
    if (NOOK_DEV_BUILD) {
      const priorAlert = batteryCycle.alert;
      batteryCycle = updateBatteryAlertCycle(batteryCycle, {
        ...sample,
        batteryPresent: sample.batteryPresent,
      });
      const currentAlert = batteryCycle.alert;
      if (priorAlert?.level !== currentAlert?.level || priorAlert?.percent !== currentAlert?.percent) {
        State.setBatteryAlert(currentAlert);
        if (currentAlert && priorAlert?.level !== currentAlert.level) batteryAlertHandlers?.alertChanged(currentAlert);
        if (!currentAlert) {
          batteryAlertGate = EMPTY_BATTERY_ALERT_GATE;
          batteryAlertHandlers?.cleared();
        }
      }
    }
    State.setBatteryStatus(sample);
    renderBattery();
  };
  const readPower = async () => {
    if (disposed || !IDLE_CLOCK_BUILD || batterySimulated) return;
    const generation = ++batteryReadGeneration;
    const battery = await Bridge.devBatteryStatus();
    if (disposed || batterySimulated || generation !== batteryReadGeneration) return;
    const sample: DevBatteryStatus = battery ?? { percent: null, acConnected: null, charging: null, batteryPresent: null };
    acceptBatterySample(sample);
    if (batteryTimer != null) window.clearTimeout(batteryTimer);
    batteryTimer = null;
    scheduleBattery();
  };
  const renderBattery = () => {
    const status = State.batteryStatus ?? { percent: null, acConnected: null, charging: null, batteryPresent: null };
    if (!hasKnownBattery(status)) {
      el.classList.remove("has-battery");
      batteryRing.replaceChildren();
      batteryValue.textContent = "";
      return;
    }
    el.classList.add("has-battery");
    const level = batteryLevel(status);
    batteryRing.dataset.level = level;
    batteryRing.dataset.charging = String(status.charging === true);
    batteryRing.style.setProperty("--battery-progress", `${status.percent}%`);
    const batteryLabel = message(status.charging === true ? "Charging" : "Not charging");
    const batteryAriaLabel = status.percent == null
      ? message(status.charging === true ? "Battery charging" : "Battery not charging")
      : message(status.charging === true
        ? "Battery {percent} percent, charging"
        : "Battery {percent} percent, not charging", { percent: status.percent });
    batteryRing.setAttribute("aria-label", batteryAriaLabel);
    batteryRing.title = batteryLabel;
    batteryRing.replaceChildren(lucide(status.charging === true ? LUCIDE.zap : LUCIDE.battery, 14));
    batteryValue.textContent = `${status.percent}%`;
  };
  const maybePresentBatteryAlert = () => {
    const batteryCardVisible = State.mode === "expanded" && State.view === "battery";
    const next = advanceBatteryAlertGate(batteryAlertGate, State.batteryAlert?.level ?? null, waitingCount() > 0, batteryCardVisible);
    batteryAlertGate = next.gate;
    if (next.present) batteryAlertHandlers?.present();
  };
  const scheduleActivityCheck = () => {
    if (activityTimer != null) window.clearTimeout(activityTimer);
    if (!IDLE_CLOCK_BUILD) { activityTimer = null; return; }
    const now = Date.now();
    const lastActivityAt = latestActivityAt(now, performance.now(), State.lastAgentEventAt, State.lastActivity);
    const due = lastActivityAt + IDLE_AFTER_MS;
    const activeWork = State.sessions.some((session) => session.agent !== "cursor"
      && (session.state === "working" || session.state === "thinking" || session.state === "searching")
      && !session.approval && !session.question && !isQuiet(session, now));
    const importantNotification = State.batteryAlert != null || State.sessions.some((session) => session.state === "error");
    if (waitingCount() > 0 || importantNotification || (now >= due && !activeWork)) { activityTimer = null; return; }
    const delay = now < due ? due - now : 60_000;
    activityTimer = window.setTimeout(() => { activityTimer = null; State.notify(); }, delay + 1);
  };
  const scheduleClock = () => {
    if (!idleOn || disposed) return;
    if (clockTimer != null) window.clearTimeout(clockTimer);
    clockTimer = window.setTimeout(() => { showTime(); scheduleClock(); }, 60_000 - (Date.now() % 60_000));
  };
  const scheduleBattery = () => {
    if (disposed || !IDLE_CLOCK_BUILD) return;
    if (batteryTimer != null) window.clearTimeout(batteryTimer);
    const status = State.batteryStatus;
    const delay = batteryPollDelay(status);
    batteryTimer = window.setTimeout(() => { batteryTimer = null; void readPower(); }, delay);
  };
  const setIdle = (idle: boolean) => {
    idleOn = idle;
    el.classList.toggle("idle", idle);
    const systemReduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.classList.toggle("reduce-motion", compactReducedMotion(State.settings.reduceMotion, systemReduced));
    if (idle) {
      showTime();
      if (clockTimer == null) scheduleClock();
    } else {
      if (clockTimer != null) window.clearTimeout(clockTimer);
      clockTimer = null;
    }
  };

  const currentGauges = (): Gauges => {
    const actual: Gauges = {
      usage: State.usage,
  waiting: waitingCount(),
      codexQuota: State.codexQuota,
      codexEnabled: CODEX_QUOTA_BUILD && State.settings.codexQuotaEnabled,
      now: Date.now(),
    };
    return NOOK_DEV_BUILD && devFixture ? { ...actual, ...devFixture.gauges() } : actual;
  };

  function writeValues() {
    const base = currentGauges();
    const systemReduced = State.settings.reduceMotion === "system" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reduced = compactReducedMotion(State.settings.reduceMotion, systemReduced);
    const waiting = waitingSignal(base.waiting, previousWaiting, reduced);
    const waitingCell = values.get("waiting")?.cell;
    if (waitingCell) {
      waitingCell.classList.toggle("waiting-active", waiting.active);
      if (waiting.animate && State.mode === "compact") {
        waitingCell.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.055)" }, { transform: "scale(1)" }],
          { duration: 360, easing: "cubic-bezier(.2,.75,.25,1)" },
        );
      }
    }
    previousWaiting = base.waiting;
    if (cycle) {
      cycle.configure(availableCompactUsageAgents(base), State.mode === "compact", hovered);
      usageAgent = cycle.current();
    }
    const from = { ...base, usageAgent };
    const agentName = compactAgentName(usageAgent);
    if (agentLabel && agentLabel.dataset.agent !== usageAgent) {
      agentLabel.dataset.agent = usageAgent;
      agentLabel.title = agentName;
      agentLabel.setAttribute("aria-label", agentName);
      agentLabel.replaceChildren(compactAgentMark(usageAgent));
    }
    for (const [kind, elements] of values) {
      const { cell, value } = elements;
      const { text, more, level, dim } = reading(kind, from);
      const metricName = message(METRIC[kind].name);
      const title = kind === "waiting"
        ? message("{name} · {detail}", { name: metricName, detail: more ?? message("{waiting} waiting", { waiting: 0 }) })
        : more ? message("{name} · {detail}", { name: `${agentName} · ${metricName}`, detail: more }) : metricName;
      if (kind === "waiting" && cell.title !== title) cell.title = title;
      else if (kind !== "waiting") {
        const detail = more ?? (usageAgent === "claude" ? message(USAGE_SOURCE_WORDS) : "");
        const fullTitle = [agentName, metricName, detail].filter(Boolean).join(" · ");
        if (cell.title !== fullTitle) cell.title = fullTitle;
      }
      if (value.dataset.level !== (level ?? "")) value.dataset.level = level ?? "";
      value.classList.toggle("dim", dim === true);
      if (value.textContent === text) continue;
      value.textContent = text;
      value.classList.toggle("blank", text === "—");
    }
  }

  const onAgentChange = (agent: UsageAgent) => {
    usageAgent = agent;
    writeValues();
  };
  const cycle = USAGE_ROTATION_BUILD
    ? devFixture?.schedule && devFixture.cancel
      ? createCompactUsageCycle(onAgentChange, devFixture.schedule, devFixture.cancel)
      : createCompactUsageCycle(onAgentChange)
    : null;

  // A new usage snapshot: only the numbers change.
  const unsubscribeGauges = State.onGauges(writeValues);
  const unsubscribeState = IDLE_CLOCK_BUILD ? State.subscribe(() => {
    writeValues();
    renderBattery();
    if (NOOK_DEV_BUILD) maybePresentBatteryAlert();
  }) : null;
  const pageHide = () => dispose();
  const refreshBatteryOnResume = () => {
    if (!IDLE_CLOCK_BUILD || disposed || batterySimulated) return;
    showTime();
    State.notify();
    if (batteryTimer != null) window.clearTimeout(batteryTimer);
    batteryTimer = null;
    void readPower();
  };
  function dispose() {
    disposed = true;
    batteryReadGeneration++;
    cycle?.destroy();
    unsubscribeGauges();
    unsubscribeState?.();
    cancelIdleTimers({ activity: activityTimer, clock: clockTimer, battery: batteryTimer }, (id) => window.clearTimeout(id));
    activityTimer = clockTimer = batteryTimer = null;
    if (IDLE_CLOCK_BUILD) {
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("focus", refreshBatteryOnResume);
      document.removeEventListener("visibilitychange", refreshBatteryOnResume);
    }
  }
  if (IDLE_CLOCK_BUILD) {
    window.addEventListener("pagehide", pageHide, { once: true });
    window.addEventListener("focus", refreshBatteryOnResume);
    document.addEventListener("visibilitychange", refreshBatteryOnResume);
  }


  return {
    el,
    sync(plan) {
      setIdle(plan.idle && State.mode === "compact");
      if (IDLE_CLOCK_BUILD) scheduleActivityCheck();
      const slots = compactSlots(plan, gauges());
      const more = slots.more;
      const nextDots = `${slots.dots.map((d) => `${d.id}:${d.color}:${d.calls}:${d.rest}:${d.decision}:${d.cursor}:${d.title}`).join("|")}#${more ? `${more.count}:${more.color}:${more.calls}` : ""}`;
      if (nextDots !== dotsKey) {
        dotsKey = nextDots;
        clear(dots);
        dots.hidden = idleOn || plan.live.length === 0;
        for (const dot of slots.dots) {
          dots.append(h("i", {
            class: `ci-dot${dot.calls ? " calls" : ""}${dot.rest ? " rest" : ""}${dot.decision ? " decide" : ""}${dot.cursor ? " cursor" : ""}`,
            style: `width:${COMPACT_DOT}px;height:${COMPACT_DOT}px;--c:${dot.color}`,
            title: dot.title,
          }));
        }
        if (more) {
          // "+N" wears the colour of the most urgent session it hides.
          const badge = h("span", {
            class: `ci-more${more.calls ? " calls" : ""}`, style: `width:${COMPACT_MORE_W}px`,
            text: `+${Math.min(99, more.count)}`, title: `${more.count} more`,
          });
          wear(badge, more.color);
          dots.append(badge);
        }
      }
      dots.hidden = idleOn || plan.live.length === 0;

      const nextMetrics = plan.kinds.join("|");
      if (nextMetrics !== metricsKey) {
        metricsKey = nextMetrics;
        clear(metrics);
        values.clear();
        agentLabel = null;
        metrics.hidden = idleOn || plan.kinds.length === 0;
        const markedIndex = plan.kinds.findIndex(isUsageMetric);
        if (markedIndex >= 0) {
          const agentName = compactAgentName(usageAgent);
          agentLabel = h("span", {
            class: "ci-metric-agent",
            style: `--agent-slot-w:${COMPACT_AGENT_ICON_W}px;--agent-slot-h:${COMPACT_AGENT_ICON_H}px;--agent-icon-size:${COMPACT_AGENT_ICON_SIZE}px;--agent-side-overlap:${COMPACT_AGENT_ICON_H - COMPACT_AGENT_SIDE_ADVANCE}px`,
            role: "img", "aria-label": agentName, title: agentName, "data-agent": usageAgent,
          }, compactAgentMark(usageAgent));
        }
        for (let index = 0; index < plan.kinds.length; index++) {
          const kind = plan.kinds[index]!;
          if (index === markedIndex && agentLabel) metrics.append(agentLabel);
          const def = METRIC[kind];
          const value = h("b");
          const readingEl = h("span", { class: "ci-metric-reading" },
            h("span", { class: "ci-metric-icon" }, lucide(def.icon, COMPACT_ICON)),
            value,
          );
          const cell = h("span", { class: "ci-metric", "data-kind": kind, style: `--w:${def.width}px`, title: def.name }, readingEl);
          values.set(kind, { cell, value });
          metrics.append(cell);
        }
      }
      metrics.hidden = idleOn || plan.kinds.length === 0;
      // Sessions waiting is not a sample: it follows the state.
      writeValues();
    },
    setHovered(on) {
      if (!USAGE_ROTATION_BUILD || hovered === on) return;
      hovered = on;
      writeValues();
    },
    redraw(plan) {
      dotsKey = "\0";
      metricsKey = "\0";
      this.sync(plan);
    },
    destroy: dispose,
    dismissBatteryAlert() {
      if (!State.batteryAlert) return;
      batteryCycle = { ...batteryCycle, alert: null };
      batteryAlertGate = EMPTY_BATTERY_ALERT_GATE;
      State.setBatteryAlert(null);
      batteryAlertHandlers?.cleared();
    },
    startBatteryMonitor() {
      if (IDLE_CLOCK_BUILD && batteryTimer == null && !disposed) void readPower();
    },
    simulateBattery(action, sample) {
      if (!NOOK_DEV_BUILD || disposed) return;
      if (action === "BatteryTestReset") {
        batterySimulated = false;
        batteryReadGeneration++;
        batteryCycle = EMPTY_BATTERY_ALERT_CYCLE;
        batteryAlertGate = EMPTY_BATTERY_ALERT_GATE;
        if (batteryTimer != null) window.clearTimeout(batteryTimer);
        batteryTimer = null;
        State.setBatteryAlert(null);
        State.setBatteryStatus(null);
        batteryAlertHandlers?.cleared();
        void readPower();
        return;
      }
      if (!sample || !["BatteryTestStart", "BatteryTest20", "BatteryTest10", "BatteryTestCharging", "BatteryTest100", "BatteryTestAbsent", "BatteryTestUnknown"].includes(action)) return;
      batterySimulated = true;
      batteryReadGeneration++;
      if (batteryTimer != null) window.clearTimeout(batteryTimer);
      batteryTimer = null;
      acceptBatterySample(sample);
      // A forgotten simulator fixture expires in memory and returns to the read-only Windows source.
      batteryTimer = window.setTimeout(() => {
        batteryTimer = null;
        batterySimulated = false;
        batteryReadGeneration++;
        batteryCycle = EMPTY_BATTERY_ALERT_CYCLE;
        batteryAlertGate = EMPTY_BATTERY_ALERT_GATE;
        State.setBatteryAlert(null);
        State.setBatteryStatus(null);
        batteryAlertHandlers?.cleared();
        void readPower();
      }, 10 * 60_000);
    },
    deferBatteryAlert() {
      if (State.batteryAlert) {
        batteryAlertGate = { level: State.batteryAlert.level, shown: false, deferred: true };
      }
    },
  };
}

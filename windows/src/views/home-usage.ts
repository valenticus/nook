import { State, USAGE_OLD_MS, USAGE_SOURCE_WORDS, usageLevel, usageShown } from "../core/state";
import { message } from "../core/i18n";
import { formatResetTime, quotaProviderDisplay, type QuotaWindowDisplay } from "../settings/codex-quota-view";
import {
  clear, h, removeAttributeIfPresent, removeStylePropertyIfPresent, setAttributeIfChanged, setHiddenIfChanged,
  setStylePropertyIfChanged, setStyleValueIfChanged, setTextIfChanged,
} from "./dom";
import { LUCIDE, lucide } from "./iconset";

const CODEX_QUOTA_BUILD = __NOOK_DEV_BUILD__ || __NOOK_STANDALONE_BUILD__;

const RES_ICON = 12;
type Row = { el: HTMLElement; resets: HTMLElement; value: HTMLElement; fill: HTMLElement };

function makeRows(): Row[] {
  return ([ ["5 h", LUCIDE.timer], ["7 d", LUCIDE.calendarDays] ] as const)
    .map(([label, icon]) => {
      const resets = h("span", { class: "res-sub" });
      const value = h("span", { class: "res-value" });
      const fill = h("i");
      const el = h("div", { class: "res-row" },
        h("div", { class: "res-head" }, lucide(icon, RES_ICON), h("b", { text: label }), resets, value),
        h("div", { class: "res-bar" }, fill));
      return { el, resets, value, fill };
    });
}

function createSection(agent: "claude" | "codex", title: string, rows: Row[]) {
  const status = h("span", { class: "res-state" });
  const heading = h("div", { class: "lane-h res-title" }, h("span", { text: message(title) }), status);
  const empty = h("div", { class: "res-none" });
  const usage = h("div", { class: "res-usage" }, rows[0].el, rows[1].el, empty);
  const ageWhat = h("span", { class: "what", text: message(agent === "claude" ? "as of last Claude Code activity" : "as of Codex quota update") });
  const ageWhen = h("span", { class: "when" });
  const age = h("div", { class: "res-age" }, ageWhat, ageWhen);
  const section = h("section", { class: `res-provider res-provider-${agent}`, "aria-label": title }, heading, usage, age);
  return { section, rows, status, empty, usage, age, ageWhat, ageWhen };
}

  function paintRow(row: Row, data: { percent: number; state: string; countdown: string; resetsAt: number } | null, missing = false) {
  setStyleValueIfChanged(row.el, "visibility", data || missing ? "visible" : "hidden");
  if (!data) {
    setTextIfChanged(row.value, missing ? message("Unavailable") : "—");
    row.value.classList.toggle("blank", !missing);
    removeAttributeIfPresent(row.value, "data-level");
    setTextIfChanged(row.resets, "");
    removeAttributeIfPresent(row.resets, "title");
    setStyleValueIfChanged(row.fill, "width", "0%");
    removeStylePropertyIfPresent(row.fill, "--used");
    row.el.classList.toggle("dim", missing);
    return;
  }
    setTextIfChanged(row.value, `${data.percent}%`);
  row.value.classList.remove("blank");
  setAttributeIfChanged(row.value, "data-level", data.state === "reset" || data.state === "unavailable" ? "" : usageLevel(data.percent));
  setTextIfChanged(row.resets, message(data.countdown));
  setAttributeIfChanged(row.resets, "title", message(data.resetsAt > 0 ? formatResetTime(data.resetsAt) : data.countdown));
  row.el.classList.toggle("dim", data.state !== "fresh");
  setStyleValueIfChanged(row.fill, "width", `${data.percent}%`);
  setStylePropertyIfChanged(row.fill, "--used", String(data.percent / 100));
}

function paintAge(age: HTMLElement, what: HTMLElement, when: HTMLElement, updatedAt: number | null, title: string, now: number, old: boolean) {
  const elapsed = updatedAt == null ? 0 : now - updatedAt;
  const ageText = elapsed < 60_000 ? message("just now")
    : elapsed < 3_600_000 ? message("{count}m ago", { count: Math.floor(elapsed / 60_000) })
    : elapsed < 86_400_000 ? message("{count}h ago", { count: Math.floor(elapsed / 3_600_000) })
    : message("{count}d ago", { count: Math.floor(elapsed / 86_400_000) });
  const text = updatedAt == null ? "" : ` · ${ageText}`;
  setStyleValueIfChanged(age, "visibility", updatedAt == null ? "hidden" : "visible");
  age.classList.toggle("old", old);
  if (when.textContent !== text) when.textContent = text;
  setAttributeIfChanged(age, "title", message(updatedAt == null ? title : `${title}${text}`));
  setTextIfChanged(what, message(title));
}

/** Claude's original usage and optional Codex quota, in the existing Home usage card. */
export function buildHomeUsage() {
  const claude = createSection("claude", message("Claude usage"), makeRows());
  const codex = CODEX_QUOTA_BUILD ? createSection("codex", message("Codex usage"), makeRows()) : null;
  claude.usage.title = USAGE_SOURCE_WORDS;
  const content = h("div", { class: "res-content" }, claude.section, codex?.section);
  const el = h("div", { class: "card home-res" }, content);

  function draw(now = Date.now()) {
    const usage = State.usage;
    const claudeWindows = [usageShown(usage?.fiveHour, usage?.updatedAt ?? now, now), usageShown(usage?.sevenDay, usage?.updatedAt ?? now, now)];
    const hasClaude = usageWindowsPresent(usage);
    setTextIfChanged(claude.status, message(!hasClaude
      ? State.usageInstalled === false ? "Unavailable" : "Loading"
      : claudeWindows.some((window) => window?.state === "fresh") ? "Fresh" : "Stale"));
    claude.rows.forEach((row, index) => {
      const window = claudeWindows[index];
      paintRow(row, window ? { percent: window.percent, state: window.state, countdown: window.countdown, resetsAt: (index === 0 ? usage?.fiveHour : usage?.sevenDay)?.resetsAt ?? 0 } : null, hasClaude);
    });
    setHiddenIfChanged(claude.empty, hasClaude);
    if (!hasClaude) {
      const state = message(State.usageInstalled === false ? "Unavailable" : "No usage data yet");
      const why = State.usageInstalled === false
        ? message("Turn on usage limits in Settings")
        : State.usageInstalled
          ? message("Appears once a session has run")
          : message("Appears once a session has run with usage limits on in Settings");
      if (claude.empty.dataset.why !== why) {
        claude.empty.dataset.why = why;
        clear(claude.empty);
        claude.empty.append(h("b", { text: state }), h("span", { text: why }));
      }
    }
    const claudeAge = usage?.updatedAt ?? null;
    const claudeOld = usage != null && now - usage.updatedAt > USAGE_OLD_MS;
    paintAge(claude.age, claude.ageWhat, claude.ageWhen, claudeAge, message("as of last Claude Code activity"), now, claudeOld);

    const enabled = CODEX_QUOTA_BUILD && State.settings.codexQuotaEnabled;
    el.classList.toggle("has-codex", enabled);
    if (!codex) return;
    setHiddenIfChanged(codex.section, !enabled);
    if (!enabled) return;

    const quota = quotaProviderDisplay(true, State.codexQuota, now);
    setTextIfChanged(codex.status, message(quota.status));
    const codexWindows: (QuotaWindowDisplay | null)[] = [quota.fiveHour, quota.sevenDay];
    const hasCodexWindow = codexWindows.some(Boolean);
    codex.rows.forEach((row, index) => {
      const window = codexWindows[index];
      const data = window?.state === "unavailable"
        ? null
        : window
          ? { percent: window.percent, state: window.state, countdown: window.resetCountdown ? `resets ${window.resetCountdown}` : "", resetsAt: window.resetsAt }
          : null;
      paintRow(row, data, hasCodexWindow && !window);
      if (window?.state === "unavailable") {
        setTextIfChanged(row.value, message("Unavailable"));
        row.value.classList.add("blank");
        removeAttributeIfPresent(row.value, "data-level");
        setTextIfChanged(row.resets, message("reset"));
        setAttributeIfChanged(row.resets, "title", window.resetsAt > 0 ? formatResetTime(window.resetsAt) : "");
        setStyleValueIfChanged(row.fill, "width", "0%");
        removeStylePropertyIfPresent(row.fill, "--used");
        row.el.classList.add("dim");
        setStyleValueIfChanged(row.el, "visibility", "visible");
      }
    });
    setHiddenIfChanged(codex.empty, hasCodexWindow);
    if (!hasCodexWindow) {
      const emptyMessage = message(quota.status === "Loading" ? "Waiting for quota update" : "Quota data is unavailable");
      if (codex.empty.dataset.why !== emptyMessage) {
        codex.empty.dataset.why = emptyMessage;
        clear(codex.empty);
        codex.empty.append(h("b", { text: message(quota.status) }), h("span", { text: emptyMessage }));
      }
    }
    paintAge(codex.age, codex.ageWhat, codex.ageWhen, quota.updatedAt, message("as of Codex quota update"), now, quota.status === "Stale");
  }

  State.onGauges(draw);
  draw();
  return { el, draw };
}

function usageWindowsPresent(usage: typeof State.usage): boolean {
  return usage != null && (usage.fiveHour != null || usage.sevenDay != null);
}

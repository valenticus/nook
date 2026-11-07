// Claude's two usage windows, as small labelled bars. They are written only
// when usage changes or when their reset/countdown advances; nothing here
// animates by itself while the island is hidden.

import { h } from "./dom";
import { LUCIDE, lucide } from "./iconset";
import { State, USAGE_SOURCE_WORDS, usageLevel, usageShown } from "../core/state";
import { message } from "../core/i18n";

const ICON = 11;

interface Item {
  el: HTMLElement;
  value: HTMLElement;
  fill: HTMLElement;
}

function item(key: string, label: string, icon: string, usage: boolean): Item {
  const value = h("span", { class: "res-value hs-value blank", text: "—" });
  const fill = h("i");
  const el = h(
    "div", { class: `hs hs-${key}${usage ? " hs-usage" : ""}` },
    h("b", { class: "hs-label", text: label }),
    h("span", { class: "hs-icon" }, lucide(icon, ICON, 1.75)),
    h("div", { class: "res-bar hs-bar" }, fill),
    value,
  );
  return { el, value, fill };
}

export function buildHeaderStats(): { el: HTMLElement; draw(): void } {
  const five = item("5h", "5h", LUCIDE.timer, true);
  const seven = item("7d", "7d", LUCIDE.calendarDays, true);
  const el = h("div", { class: "hstats" }, h("div", { class: "hs-row" }, five.el, seven.el));
  // What each cell was last written for: nothing is touched when that has not changed.
  const keys = new Map<Item, string>();

  function usage(it: Item, name: string, win: ReturnType<typeof usageShown>) {
    const key = win ? `${win.percent}|${win.state}|${win.countdown}` : "";
    if (keys.get(it) === key) return;
    keys.set(it, key);
    it.el.hidden = !win;
    if (!win) return;
    it.value.textContent = `${win.percent}%`;
    it.value.classList.remove("blank");
    it.value.dataset.level = win.state === "reset" ? "" : usageLevel(win.percent);
    it.el.classList.toggle("dim", win.state !== "fresh");
    it.fill.style.width = `${win.percent}%`;
    it.fill.style.setProperty("--used", String(win.percent / 100));
    it.el.title = message("{agent}: {percent}% used{countdown}. {source}", {
      agent: name,
      percent: win.percent,
      countdown: win.countdown ? ` · ${message(win.countdown)}` : "",
      source: USAGE_SOURCE_WORDS,
    });
  }

  return {
    el,
    draw() {
      const now = Date.now();
      const u = State.usage;
      usage(five, "Claude usage, 5 hours", usageShown(u?.fiveHour, u?.updatedAt ?? now, now));
      usage(seven, "Claude usage, 7 days", usageShown(u?.sevenDay, u?.updatedAt ?? now, now));
    },
  };
}

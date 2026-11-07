// The home view (plans/design-plan.md §1, plans/subagents-plan.md §7): three
// columns — the bot, speaking for the session that most needs attention; a
// mini bot per session, in lanes; the existing Claude usage card. On a
// side dock the three stand one above the other (style.css, layout.ts
// SIDE_LAYOUTS): the same elements, laid out by the stylesheet.
//
// The island's own bot is not drawn here: island.ts places it over the stage
// the left card keeps for it (layout.ts VIEW_LAYOUTS.overview). Nothing here
// runs on its own either: the view is drawn when the state changes, the
// gauges when a sample comes, and what depends on the time passing — a
// session fading, "updated 3 min ago" — when the island's slow timer says so.

import { createStateBot, releaseMiniBot, restMiniBot } from "../bot/minibots";
import { hexToRGB, type BotEngine } from "../bot/engine";
import { homeContentSize, HOME_SIDE_BOT_H, HOME_SIDE_SESSIONS_H, HOME_STAGE, MAX_VISIBLE, washRGBA, type BotStateName, type Wash } from "../core/layout";
import { DECISION_WORDS, State } from "../core/state";
import { currentLanguage, message, plural } from "../core/i18n";
import { shelfTrace } from "../core/shelf-trace";
import {
  clear, h, setAttributeIfChanged, setHiddenIfChanged,
  setStylePropertyIfChanged, setStyleValueIfChanged, setTextIfChanged, svg,
} from "./dom";
import { ICONS } from "./icons";
import { TOOL_NAME, toolMark } from "./tool";
import { wear } from "./palette";
import { buildHomeUsage } from "./home-usage";
import { buildClaudeHooksStatus } from "./claude-hooks-status";
import {
  MAX_CHILD_DOTS, doingOf, labelOf, labelText, roster, runningSubagents, span, stateWords, subagentColor,
  subagentWords, type Entry, type Lane,
} from "./roster";
import type { ViewActions, ViewHost } from "./views";

/** The island's entrance curve (.view.on in style.css): what moves, moves like this. */
const SPRING = "cubic-bezier(0.3, 1.2, 0.4, 1)";
const MINI_BOT = 22;

const LANES: { key: Lane; title: string }[] = [
  { key: "needs", title: "Needs you" },
  { key: "working", title: "Working" },
  { key: "done", title: "Done" },
];

const WASH: Partial<Record<BotStateName, Wash>> = {
  approval: "amber", question: "cyan", error: "red", finished: "green",
};

interface Cell {
  el: HTMLButtonElement;
  bot: { el: HTMLElement; engine: BotEngine };
  kids: HTMLElement;
  mark: HTMLElement;
  /** What it was last drawn for: nothing is touched when that has not changed. */
  key: string;
  kidsKey: string;
  state: BotStateName | null;
}

/** The icon used by the usage rows, at the size of their words. */

export function buildHome(actions: ViewActions): ViewHost {
  // ── Left: the bot's card ────────────────────────────────────────────────────
  /** The tool the session is in — its mark and its name — before the project's. */
  const whoTool = h("span", { class: "who-tool" });
  const whoName = h("b", { class: "name" });
  const whoModel = h("span", { class: "model" });
  const whoState = h("span", { class: "words" });
  const doing = h("div", { class: "hb-doing" });
  /** The session the card speaks for: what its button goes to. */
  let frontId = "";
  let shownToolKey: string | null = null;
  // Built once: rebuilt between a mouse-down and its mouse-up, it would swallow the click.
  const reviewLabel = h("span");
  const review = h("button", { class: "btn primary", onclick: () => frontId && actions.reviewRequest(frontId) }, reviewLabel);
  const actionsRow = h("div", { class: "hb-actions" }, review);
  const botCard = h(
    "div", { class: "card wash home-bot" },
    h("div", { class: "hb-stage" }),
    h("div", { class: "hb-who" }, whoTool, whoName, whoModel, whoState),
    doing,
    actionsRow,
  );
  botCard.addEventListener("click", (e) => {
    if (!frontId || (e.target as Element).closest("button")) return;
    open(frontId);
  });

  // ── Middle: the lanes ───────────────────────────────────────────────────────
  const lanes = new Map<Lane, { el: HTMLElement; count: HTMLElement; bots: HTMLElement }>();
  for (const { key, title } of LANES) {
    const count = h("i");
    const bots = h("div", { class: "lane-bots" });
    lanes.set(key, { el: h("div", { class: `lane ${key}` }, h("div", { class: "lane-h" }, message(title), " ", count), bots), count, bots });
  }
  const more = h("button", { class: "hs-more", onclick: (e: Event) => { e.stopPropagation(); toggleList(); } });
  const laneRow = h("div", { class: "hs-lanes" }, ...LANES.map((l) => lanes.get(l.key)!.el), more);
  const foot = h("div", { class: "hs-foot" });
  const empty = h("div", { class: "hs-empty" });
  const list = h("div", { class: "hs-list" });
  const integrations = buildClaudeHooksStatus(true);
  const sessionsCard = h("div", { class: "card home-sessions" }, laneRow, integrations.el, empty, foot, list);

  // ── Right: Claude usage. The rows are built once; only their words change. ──
  const usagePanel = buildHomeUsage();
  const resCard = usagePanel.el;

  // The lanes and the resources: two more columns at the top and bottom (the
  // wrapper has no box of its own there); on a side, what scrolls under the
  // bot's card when the window is too short for all three (style.css `.home-rest`).
  const rest = h("div", { class: "home-rest" }, sessionsCard, resCard);
  const el = h("div", { class: "view home-view" }, h("div", { class: "home" }, botCard, rest));
  const homeFrame = homeContentSize();
  el.style.setProperty("--home-frame-width", `${homeFrame.width}px`);
  el.style.setProperty("--home-frame-height", `${homeFrame.height}px`);
  if (__NOOK_DEV_BUILD__) shelfTrace("home-dom-created", { locale: currentLanguage(), source: "buildHome" });
  // Home upright on a side: its cards' heights and the stage's width, said once (layout.ts), read by the stylesheet.
  el.style.setProperty("--home-side-bot", `${HOME_SIDE_BOT_H}px`);
  el.style.setProperty("--home-side-sessions", `${HOME_SIDE_SESSIONS_H}px`);
  el.style.setProperty("--hb-side-stage", `${HOME_STAGE.column.w}px`);
  el.style.setProperty("--hb-stage-h", `${HOME_STAGE.column.h}px`);

  // ── What is on show ─────────────────────────────────────────────────────────
  const cells = new Map<string, Cell>();
  let entries = new Map<string, Entry>();
  let hoverId: string | null = null;
  let listOpen = false;
  /** Where each stood last time: nothing reshuffles in a lane under the pointer. */
  let lastIndex = new Map<string, number>();
  let pointerInRow = false;
  let orderKey = "";
  let footKey = "";
  let listKey = "";
  let emptyKey = "";

  laneRow.addEventListener("pointerenter", () => { pointerInRow = true; });
  laneRow.addEventListener("pointerleave", () => { pointerInRow = false; State.notify(); });
  // A click anywhere else puts the list away.
  el.addEventListener("click", (e) => {
    if (listOpen && !list.contains(e.target as Node)) {
      listOpen = false;
      State.notify();
    }
  });

  /** A session's panel — or, when it is waiting for an answer, the card that asks. Another agent's pill has neither. */
  function open(id: string) {
    const entry = entries.get(id);
    if (!entry?.session) return;
    listOpen = false;
    actions.openSessionOf(id);
  }

  function makeCell(entry: Entry): Cell {
    const bot = createStateBot(entry.state, MINI_BOT);
    // Another agent's bot keeps its pill's colour: it is not one of Claude's.
    if (entry.task) bot.engine.bodyColor = hexToRGB(entry.task.color);
    // A result nobody has opened: a dot — or, when its reply waits on a decision, a "!" in that colour.
    const mark = h("i", { class: "unseen" }, svg(ICONS.bang, 9));
    const kids = h("span", { class: "kids" });
    // Which tool it is, at the corner: the bot's colours say what it does, never whose it is.
    const tool = entry.session ? toolMark(entry.session.agent, 9) : null;
    if (tool) tool.classList.add("corner");
    const cell = h("button", { class: "agent" }, bot.el, mark, kids, tool);
    const id = entry.id;
    cell.addEventListener("pointerenter", () => { hoverId = id; drawFoot(); });
    cell.addEventListener("pointerleave", () => { if (hoverId === id) hoverId = null; drawFoot(); });
    cell.addEventListener("click", (e) => { e.stopPropagation(); open(id); });
    // A click does not leave it with the focus: the keyboard is the panel's.
    cell.addEventListener("mousedown", (e) => e.preventDefault());
    return { el: cell, bot, kids, mark, key: "", kidsKey: "", state: null };
  }

  function updateCell(cell: Cell, entry: Entry) {
    const running = entry.session ? runningSubagents(entry.session) : [];
    const runningKey = `${running.length}:${running.map((r) => (r.asking ? "a" : "r")).join("")}`;
    const key = [entry.state, entry.lane, entry.unseen, entry.decision, runningKey].join("~");
    if (key === cell.key) return;
    cell.key = key;
    const changed = cell.state != null && cell.state !== entry.state;
    cell.state = entry.state;
    cell.bot.engine.setState(entry.state);
    const rest = entry.lane === "done";
    cell.el.classList.toggle("rest", rest);
    // One at rest is drawn until its state has settled, and then costs nothing.
    restMiniBot(cell.bot.el, rest, changed);
    // One mark at its corner: the decision's comes before the plain "unseen". What the bot itself
    // wears — asking, an error — is not touched by either.
    setHiddenIfChanged(cell.mark, !(entry.unseen || entry.decision));
    cell.mark.classList.toggle("decide", entry.decision);
    setAttributeIfChanged(cell.el, "title", entry.decision ? DECISION_WORDS : "");

    const kidsKey = runningKey;
    if (kidsKey !== cell.kidsKey) {
      cell.kidsKey = kidsKey;
      clear(cell.kids);
      for (const r of running.slice(0, MAX_CHILD_DOTS)) {
        cell.kids.append(h("i", { class: r.asking ? "asking" : "", style: `--c:${subagentColor(r.asking)}` }));
      }
      if (running.length > MAX_CHILD_DOTS) cell.kids.append(h("small", { text: `+${running.length - MAX_CHILD_DOTS}` }));
    }
  }

  function release(cell: Cell) {
    const canvas = cell.bot.el.querySelector("canvas");
    if (canvas) releaseMiniBot(canvas);
    cell.el.remove();
  }

  /** A cell that leaves fades where it stands, out of the row's flow, while the others close up. */
  function dropCell(id: string, cell: Cell) {
    cells.delete(id);
    if (!cell.el.isConnected || !el.classList.contains("on")) return release(cell);
    const r = cell.el.getBoundingClientRect();
    const base = sessionsCard.getBoundingClientRect();
    cell.el.style.position = "absolute";
    cell.el.style.left = `${r.left - base.left}px`;
    cell.el.style.top = `${r.top - base.top}px`;
    cell.el.style.pointerEvents = "none";
    sessionsCard.append(cell.el);
    const gone = cell.el.animate(
      [{ opacity: getComputedStyle(cell.el).opacity, transform: "none" }, { opacity: 0, transform: "scale(0.7)" }],
      { duration: 420, easing: "ease-in", fill: "forwards" },
    );
    gone.onfinish = () => release(cell);
    gone.oncancel = () => release(cell);
  }

  /** From where it was to where it is, on the island's curve. */
  function slide(node: HTMLElement, from: DOMRect | undefined) {
    if (!from) return;
    const to = node.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 420, easing: SPRING });
  }

  function showOrder(live: Entry[]): Entry[] {
    const order = [...live];
    if (pointerInRow) {
      const at = (e: Entry) => lastIndex.get(e.id) ?? Number.POSITIVE_INFINITY;
      order.sort((a, b) => a.rank - b.rank || at(a) - at(b) || a.since - b.since);
    }
    lastIndex = new Map(order.map((e, i) => [e.id, i]));
    return order;
  }

  function drawLanes(visible: Entry[], hidden: Entry[]) {
    // The row is laid out again only when who stands where has changed.
    const nextOrder = `${visible.map((e) => `${e.id}:${e.lane}`).join("|")}#${hidden.length}`;
    const moved = nextOrder !== orderKey;
    orderKey = nextOrder;
    const shown = el.classList.contains("on");

    // Where everything stands now, to move it from there to where it goes.
    const before = new Map<string, DOMRect>();
    let moreBefore: DOMRect | null = null;
    if (moved && shown) {
      for (const [id, cell] of cells) before.set(id, cell.el.getBoundingClientRect());
      moreBefore = more.hidden ? null : more.getBoundingClientRect();
    }

    for (const [id, cell] of [...cells]) {
      if (!visible.some((e) => e.id === id)) dropCell(id, cell);
    }

    let first = true;
    for (const { key } of LANES) {
      const lane = lanes.get(key)!;
      const mine = visible.filter((e) => e.lane === key);
      setHiddenIfChanged(lane.el, mine.length === 0);
      lane.el.classList.toggle("sep", !first && mine.length > 0);
      if (mine.length) first = false;
      setTextIfChanged(lane.count, String(mine.length));
      for (const entry of mine) {
        let cell = cells.get(entry.id);
        const fresh = !cell;
        if (!cell) {
          cell = makeCell(entry);
          cells.set(entry.id, cell);
        }
        updateCell(cell, entry);
        if (moved) lane.bots.append(cell.el);
        if (fresh && shown) {
          cell.el.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: SPRING });
        }
      }
    }

    // "+N" wears the colour of the most urgent session it hides: a hidden request is never silent.
    setHiddenIfChanged(more, hidden.length === 0);
    if (hidden.length) {
      setTextIfChanged(more, `+${hidden.length}`);
      wear(more, hidden[0].color);
      more.classList.toggle("calls", hidden[0].rank === 0);
      setAttributeIfChanged(more, "title", message("{count} more", { count: hidden.length }));
    } else {
      listOpen = false;
    }

    if (moved && shown) {
      for (const [id, cell] of cells) slide(cell.el, before.get(id));
      if (!more.hidden) slide(more, moreBefore ?? undefined);
    }
  }

  function drawMain(front: Entry | null) {
    frontId = front?.session?.id ?? "";
    botCard.classList.toggle("opens", frontId !== "");
    if (!front) {
      setStylePropertyIfChanged(botCard, "--wash", washRGBA("soft"));
      if (shownToolKey !== "") {
        shownToolKey = "";
        if (whoTool.childNodes.length) whoTool.replaceChildren();
      }
      setAttributeIfChanged(whoName, "title", "");
      setTextIfChanged(whoModel, "");
      setTextIfChanged(whoState, "");
      setTextIfChanged(whoName, message("No active sessions"));
      setTextIfChanged(doing, message(State.nookDev
        ? "This Dev build does not inspect or install global agent integrations. Only events sent to Nook Dev appear here."
        : "Nook displays Claude Code and Codex sessions when their integrations report activity."));
      setAttributeIfChanged(doing, "title", "");
      setStyleValueIfChanged(review, "display", "none");
      setTextIfChanged(reviewLabel, "");
      return;
    }
    const resting = front.lane === "done";
    const wash = resting && front.decision ? "indigo" : resting && !front.unseen ? "soft" : (WASH[front.state] ?? (front.unseen ? "green" : "soft"));
    setStylePropertyIfChanged(botCard, "--wash", washRGBA(wash));
    const tool = front.session?.agent;
    const toolKey = tool ?? "";
    if (toolKey !== shownToolKey) {
      shownToolKey = toolKey;
      if (tool) whoTool.replaceChildren(toolMark(tool, 11), TOOL_NAME[tool] + " ·");
      else if (whoTool.childNodes.length) whoTool.replaceChildren();
    }
    setTextIfChanged(whoName, labelText(front));
    setAttributeIfChanged(whoName, "title", labelOf(front).path);
    // The model it runs on, when it said: nothing is shown for one that did not.
    const model = front.session?.model?.label ?? "";
    setTextIfChanged(whoModel, model);
    setAttributeIfChanged(whoModel, "title", front.session?.model?.id ?? "");
    setHiddenIfChanged(whoModel, !model);
    setTextIfChanged(whoState, message(stateWords(front)));
    setStyleValueIfChanged(whoState, "color", resting && !front.decision ? "" : front.color);
    const what = message(doingOf(front));
    setTextIfChanged(doing, what);
    setAttributeIfChanged(doing, "title", what);
    // No Allow here: this card cannot show a request whole, and Allow allows
    // all of it. The button goes to the request's own card, which can — and
    // which arms its buttons from the moment it is on show.
    const asks = front.session?.question ? message("Answer") : front.session?.approval ? message("Review") : "";
    setStyleValueIfChanged(review, "display", asks ? "" : "none");
    setTextIfChanged(reviewLabel, asks);
  }

  function drawEmpty(none: boolean, tracked: number) {
    setHiddenIfChanged(empty, !none);
    setHiddenIfChanged(laneRow, none);
    setHiddenIfChanged(foot, none);
    const key = none ? `${tracked}:${State.nookDev}` : "";
    if (key === emptyKey) return;
    emptyKey = key;
    clear(empty);
    if (!none) return;
    if (tracked > 0) {
      // Sessions are still followed: they have only been at rest long enough to leave the view.
      const restingCopy = currentLanguage() === "uk"
        ? plural(tracked, {
            one: "{count} сесія зараз неактивна. Вона з’явиться тут, коли відновить роботу.",
            few: "{count} сесії зараз неактивні. Вони з’являться тут, коли відновлять роботу.",
            many: "{count} сесій зараз неактивні. Вони з’являться тут, коли відновлять роботу.",
            other: "{count} сесії зараз неактивні. Вони з’являться тут, коли відновлять роботу.",
          })
        : plural(tracked, {
            one: "{count} session is at rest. It will appear here when it works again.",
            other: "{count} sessions are at rest. They will appear here when they work again.",
          });
      empty.append(
        h("div", { class: "title", text: message("Nothing running") }),
        h("div", { class: "sub", text: restingCopy }),
        h("button", { class: "btn secondary", text: message(tracked === 1 ? "Show it" : "Show them"), onclick: () => { actions.blip(); actions.openSessions(); } }),
      );
    } else {
      empty.append(h("div", { class: "title", text: message("No active sessions") }));
      empty.append(h("div", { class: "sub", text: message(State.nookDev
        ? "This Dev build does not inspect or install global agent integrations. Only events sent to Nook Dev appear here."
        : "Nook displays Claude Code and Codex sessions when their integrations report activity.") }));
      if (!State.nookDev) empty.append(h("button", { class: "btn secondary", onclick: () => actions.openSettingsWindow() }, svg(ICONS.gear, 12), message("Check integrations in Settings")));
    }
  }

  function drawFoot() {
    const entry = hoverId ? entries.get(hoverId) : null;
    const key = entry
      ? [entry.id, entry.session?.agent, labelText(entry), entry.session?.model?.label, stateWords(entry), entry.color, entry.session ? subagentWords(entry.session) : "", doingOf(entry)].join("~")
      : "";
    if (key === footKey && foot.firstChild) return;
    footKey = key;
    clear(foot);
    if (!entry) {
      foot.classList.add("quiet");
      foot.append(h("div", { class: "hf-doing", text: message("Hover a bot for its project and what it is doing. Click opens its session.") }));
      return;
    }
    foot.classList.remove("quiet");
    const { name, n, path } = labelOf(entry);
    const model = entry.session?.model;
    const subs = entry.session ? subagentWords(entry.session) : "";
    const what = message(doingOf(entry));
    foot.append(
      h("div", { class: "hf-who" },
        h("i", { class: "dot", style: `width:6px;height:6px;background:${entry.color}` }),
        entry.session ? toolMark(entry.session.agent, 10) : null,
        h("b", { text: name, title: path }),
        n == null ? null : h("em", { text: `·${n}` }),
        model ? h("span", { class: "model", text: model.label, title: model.id }) : null,
        h("span", { text: entry.task ? message("agent · {state}", { state: stateWords(entry) }) : message(stateWords(entry)) }),
        subs ? h("span", { class: "subs", text: message(subs) }) : null),
      h("div", { class: "hf-doing", text: what, title: what }),
    );
  }

  function drawList(hidden: Entry[], now: number) {
    setHiddenIfChanged(list, !listOpen || hidden.length === 0);
    const key = list.hidden ? "" : hidden.map((e) => [e.id, labelText(e), stateWords(e), e.color, span(now - e.since)].join("~")).join("|");
    if (key === listKey) return;
    listKey = key;
    clear(list);
    if (list.hidden) return;
    for (const entry of hidden) {
      const { name, n, path } = labelOf(entry);
      const id = entry.id;
      list.append(h(
        "button", { class: "gh-row", title: `${path}\n${doingOf(entry)}`.trim(), onclick: (e: Event) => { e.stopPropagation(); open(id); } },
        h("i", { class: "dot", style: `width:7px;height:7px;background:${entry.color}` }),
        h("span", { class: "gh-row-title" }, name, n == null ? null : h("em", { text: ` ·${n}` })),
        h("span", { class: "gh-row-where", text: stateWords(entry) }),
        h("span", { class: "int-ago", text: span(now - entry.since) }),
      ));
    }
  }

  function toggleList() {
    listOpen = !listOpen;
    actions.blip();
    State.notify();
    if (listOpen) {
      list.animate([{ opacity: 0, transform: "translateY(7px) scale(0.985)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: SPRING });
    }
  }

  // ── Resources ───────────────────────────────────────────────────────────────

  // The usage panel refreshes from the shared gauge path and Home sync.

  return {
    el,
    sync() {
      const now = Date.now();
      const { live, faded } = roster(now);
      const order = showOrder(live);
      const visible = order.slice(0, MAX_VISIBLE);
      const hidden = order.slice(MAX_VISIBLE);
      entries = new Map(order.map((e) => [e.id, e]));

      drawLanes(visible, hidden);
      drawEmpty(live.length === 0, faded);
      // The bot speaks for the most urgent one, whatever the pointer holds in place.
      drawMain(live[0] ?? null);
      drawList(hidden, now);
      if (hoverId && !visible.some((e) => e.id === hoverId)) hoverId = null;
      drawFoot();
      usagePanel.draw(now);
      integrations.sync();
    },
  };
}

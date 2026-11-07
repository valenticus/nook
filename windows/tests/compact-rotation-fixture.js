import "../src/style.css";
import { Room } from "../src/core/layout.ts";
import { State } from "../src/core/state.ts";
import { buildCompact } from "../src/island/compact.ts";
import { CLAUDE_BRAND_MARK, OPENAI_BRAND_MARK } from "../src/views/iconset.ts";

const NOW = Date.now();
const claudeUsage = {
  fiveHour: { usedPercent: 31, resetsAt: NOW + 2 * 60 * 60_000 },
  sevenDay: { usedPercent: 62, resetsAt: NOW + 5 * 24 * 60 * 60_000 },
  updatedAt: NOW,
};
const codexQuota = {
  generation: 1,
  quotas: {
    fiveHour: { usedPercent: 9, resetsAt: NOW + 3 * 60 * 60_000 },
    sevenDay: { usedPercent: 8, resetsAt: NOW + 6 * 24 * 60 * 60_000 },
  },
  updatedAt: NOW,
  stale: false,
  available: true,
  failureReason: null,
};

const result = document.querySelector("#test-result");
const host = document.querySelector("#fixture-island");
let id = 0;
const timers = new Map();
const fixture = {
  gauges: () => ({ usage: claudeUsage, codexQuota, codexEnabled: true, now: NOW }),
  schedule(callback, delay) { const next = ++id; timers.set(next, { callback, delay }); return next; },
  cancel(timerId) { timers.delete(timerId); },
};

try {
  host.style.cssText = "position:relative;width:280px;height:140px;margin:40px";
  State.mode = "compact";
  const strip = buildCompact(fixture);
  const dots = strip.el.querySelector(".ci-dots");
  host.append(strip.el);

  const plan = (kinds) => ({ live: [], kinds, dots: 0, metrics: kinds.length, width: 250, height: 38 });
  const setDock = (dock, kinds = ["usage5h", "usage7d", "waiting"]) => {
    Room.dock = dock;
    document.documentElement.dataset.dock = dock;
    strip.redraw(plan(kinds));
    strip.el.classList.add("on");
    dots.hidden = false;
    const dot = document.createElement("i");
    dot.className = "ci-dot";
    dot.style.cssText = "width:9px;height:9px;--c:#4fd69c";
    dots.append(dot);
    const badge = document.createElement("span");
    badge.className = "ci-more";
    badge.style.width = "24px";
    badge.textContent = "+2";
    dots.append(badge);
    return {
      metrics: strip.el.querySelector(".ci-metrics"),
      dots,
      badge,
      mark: strip.el.querySelector(".ci-metric-agent"),
      five: strip.el.querySelector('[data-kind="usage5h"]'),
      seven: strip.el.querySelector('[data-kind="usage7d"]'),
      waiting: strip.el.querySelector('[data-kind="waiting"]'),
    };
  };
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const box = (el) => el.getBoundingClientRect();
  const css = (el) => getComputedStyle(el);
  const readPair = (cells) => [cells.five.querySelector("b").textContent, cells.seven.querySelector("b").textContent];
  const readProvider = (cells) => ({
    agent: cells.mark.dataset.agent,
    ariaLabel: cells.mark.getAttribute("aria-label"),
    title: cells.mark.title,
    icon: cells.mark.querySelector("svg path")?.getAttribute("d"),
    values: readPair(cells),
  });

  const clicks = { count: 0 };
  host.addEventListener("mousedown", () => { clicks.count++; });
  let cells = setDock("top");
  const topFiveIcon = box(cells.five.querySelector(".ci-metric-icon"));
  const topSevenIcon = box(cells.seven.querySelector(".ci-metric-icon"));
  const topFiveValue = box(cells.five.querySelector("b"));
  const topSevenValue = box(cells.seven.querySelector("b"));
  const topLabel = box(cells.mark);
  const topMetricsStyle = css(cells.metrics);
  const topLabelStyle = css(cells.mark);
  const topAdjacent = [box(cells.dots), box(cells.badge), box(cells.waiting)];
  const topFiveCell = box(cells.five);
  const topSevenCell = box(cells.seven);
  const topLayoutOk = topFiveIcon.y === topSevenIcon.y && topFiveValue.y === topSevenValue.y &&
    topFiveIcon.x - topFiveCell.x === topSevenIcon.x - topSevenCell.x &&
    topFiveValue.x - topFiveCell.x === topSevenValue.x - topSevenCell.x &&
    topLabel.y + topLabel.height / 2 === topFiveIcon.y + topFiveIcon.height / 2 &&
    topLabel.right <= topFiveIcon.left && topLabel.right <= topFiveValue.left &&
    !topAdjacent.some((rect) => overlaps(topLabel, rect)) &&
    topMetricsStyle.display === "flex" && topMetricsStyle.alignItems === "center" &&
    topLabelStyle.position === "static" && topLabelStyle.flexBasis === "16px" && topLabelStyle.height === "16px" && topLabelStyle.width === "16px" &&
    cells.five.getBoundingClientRect().width === 52 && cells.seven.getBoundingClientRect().width === 52;

  cells.five.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  const clickBubbles = clicks.count === 1;
  const initial = readProvider(cells);
  const runOneInterval = () => {
    const entry = [...timers.entries()][0];
    if (!entry || entry[1].delay !== 15_000) throw new Error("The fixture did not schedule exactly one 15-second rotation.");
    timers.delete(entry[0]);
    entry[1].callback();
  };
  runOneInterval();
  const afterCodex = readProvider(cells);
  runOneInterval();
  const afterClaude = readProvider(cells);

  strip.setHovered(true);
  const paused = timers.size === 0;
  strip.setHovered(false);
  const resumed = timers.size === 1 && [...timers.values()][0].delay === 15_000;
  strip.setHovered(true);

  const bottomCells = setDock("bottom");
  const bottomLabelRect = box(bottomCells.mark);
  const bottomFiveIconRect = box(bottomCells.five.querySelector(".ci-metric-icon"));
  const bottomLabelStyle = css(bottomCells.mark);
  const bottomLayoutOk = bottomLabelRect.y + bottomLabelRect.height / 2 === bottomFiveIconRect.y + bottomFiveIconRect.height / 2 &&
    bottomLabelRect.right <= bottomFiveIconRect.left &&
    css(bottomCells.metrics).alignItems === "center" && bottomLabelStyle.position === "static" &&
    bottomLabelStyle.flexBasis === "16px" && bottomLabelStyle.height === "16px" && bottomLabelStyle.width === "16px" &&
    box(bottomCells.five.querySelector(".ci-metric-icon")).y === box(bottomCells.seven.querySelector(".ci-metric-icon")).y &&
    ![box(bottomCells.dots), box(bottomCells.badge), box(bottomCells.waiting)].some((rect) => overlaps(box(bottomCells.mark), rect));

  const sideCells = setDock("left", ["waiting", "usage5h", "usage7d"]);
  const sideLabelRect = box(sideCells.mark);
  const sideWaitingRect = box(sideCells.waiting);
  const sideFiveRect = box(sideCells.five);
  const sideSevenRect = box(sideCells.seven);
  const sideMetricsStyle = css(sideCells.metrics);
  const sideLabelStyle = css(sideCells.mark);
  const sideLayoutOk = sideLabelRect.bottom <= sideFiveRect.top && !overlaps(sideLabelRect, sideWaitingRect) &&
    !overlaps(sideLabelRect, sideSevenRect) &&
    sideMetricsStyle.flexDirection === "column" && sideLabelStyle.position === "static" &&
    sideLabelStyle.flexBasis === "16px" && sideLabelStyle.height === "16px" &&
    box(sideCells.five.querySelector(".ci-metric-icon")).x === box(sideCells.seven.querySelector(".ci-metric-icon")).x &&
    box(sideCells.five.querySelector("b")).x === box(sideCells.seven.querySelector("b")).x;

  const ok = topLayoutOk && bottomLayoutOk && sideLayoutOk && clickBubbles &&
    initial.agent === "claude" && initial.ariaLabel === "Claude" && initial.title === "Claude" && initial.icon === CLAUDE_BRAND_MARK && JSON.stringify(initial.values) === JSON.stringify(["31%", "62%"]) &&
    afterCodex.agent === "codex" && afterCodex.ariaLabel === "Codex" && afterCodex.title === "Codex" && afterCodex.icon === OPENAI_BRAND_MARK && JSON.stringify(afterCodex.values) === JSON.stringify(["9%", "8%"]) &&
    afterClaude.agent === "claude" && afterClaude.ariaLabel === "Claude" && afterClaude.title === "Claude" && afterClaude.icon === CLAUDE_BRAND_MARK && JSON.stringify(afterClaude.values) === JSON.stringify(["31%", "62%"]) && paused && resumed;

  result.dataset.testResult = ok ? "pass" : "fail";
  result.textContent = JSON.stringify({ ok, topLayoutOk, bottomLayoutOk, sideLayoutOk, computed: {
    top: { metricsDisplay: topMetricsStyle.display, alignItems: topMetricsStyle.alignItems, labelPosition: topLabelStyle.position, labelFlexBasis: topLabelStyle.flexBasis, labelHeight: topLabelStyle.height },
    bottom: { labelPosition: bottomLabelStyle.position, labelFlexBasis: bottomLabelStyle.flexBasis, labelHeight: bottomLabelStyle.height },
    side: { flexDirection: sideMetricsStyle.flexDirection, labelPosition: sideLabelStyle.position, labelFlexBasis: sideLabelStyle.flexBasis, labelHeight: sideLabelStyle.height },
  }, clickBubbles, initial, afterCodex, afterClaude, paused, resumed });
  strip.destroy();
} catch (error) {
  result.dataset.testResult = "fail";
  result.textContent = JSON.stringify({ ok: false, error: String(error) });
}

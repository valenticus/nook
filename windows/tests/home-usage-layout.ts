import "../src/style.css";
import { State } from "../src/core/state";
import type { CodexQuotaSnapshot } from "../src/core/bridge";
import { buildHomeUsage } from "../src/views/home-usage";

const NOW = 1_800_000_000_000;
const claude = {
  fiveHour: { usedPercent: 18.4, resetsAt: NOW + 2 * 60 * 60_000 },
  sevenDay: { usedPercent: 44.6, resetsAt: NOW + 4 * 24 * 60 * 60_000 },
  updatedAt: NOW,
};
const codexSnapshot = (patch: Partial<CodexQuotaSnapshot> = {}): CodexQuotaSnapshot => ({
  generation: 7,
  quotas: {
    fiveHour: { usedPercent: 63.2, resetsAt: NOW + 3 * 60 * 60_000, windowDurationMins: 300 },
    sevenDay: { usedPercent: 29.1, resetsAt: NOW + 5 * 24 * 60 * 60_000, windowDurationMins: 10_080 },
  },
  updatedAt: NOW,
  stale: false,
  available: true,
  failureReason: null,
  ...patch,
});

const topHost = document.querySelector<HTMLElement>("#top-card")!;
const sideHost = document.querySelector<HTMLElement>("#side-card")!;
const top = buildHomeUsage();
const side = buildHomeUsage();
Object.assign(top.el.style, { width: "168px", height: "194px" });
Object.assign(side.el.style, { width: "296px", height: "110px" });
topHost.append(top.el);
sideHost.append(side.el);

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function rowValues(card: HTMLElement, agent: "claude" | "codex") {
  return [...card.querySelectorAll<HTMLElement>(`.res-provider-${agent} .res-row .res-value`)].map((node) => node.textContent?.trim());
}

function layoutCheck(card: HTMLElement, dock: "top" | "right") {
  document.documentElement.dataset.dock = dock;
  const content = card.querySelector<HTMLElement>(".res-content")!;
  const rows = [...card.querySelectorAll<HTMLElement>(".res-row")].filter((row) => getComputedStyle(row).visibility !== "hidden");
  assert(rows.length === 4, `${dock}: expected four visible usage rows, got ${rows.length}`);
  const visibleTogether = rows.every((row) => {
    const r = row.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    return r.top >= c.top && r.bottom <= c.bottom && r.left >= c.left && r.right <= c.right;
  });
  if (!visibleTogether) {
    assert(content.scrollHeight > content.clientHeight, `${dock}: clipped rows without a local scroll range`);
    for (const row of rows) {
      row.scrollIntoView({ block: "nearest" });
      const r = row.getBoundingClientRect();
      const c = content.getBoundingClientRect();
      assert(r.top >= c.top && r.bottom <= c.bottom, `${dock}: row cannot be reached in local scroll`);
    }
  }
  assert(content.scrollWidth <= content.clientWidth + 1, `${dock}: usage content overflows horizontally`);
  return { dock, rowCount: rows.length, visibleTogether, localScroll: content.scrollHeight > content.clientHeight };
}

const output = document.querySelector<HTMLElement>("#test-result")!;
try {
  State.settings.codexQuotaEnabled = false;
  State.usage = claude;
  State.codexQuota = codexSnapshot();
  top.draw(NOW); side.draw(NOW);
  assert(top.el.querySelector<HTMLElement>(".res-provider-codex")?.hidden, "Codex section should stay hidden when opted out");
  assert(!top.el.querySelector(".res-source"), "Home should not contain the old source switch");
  assert(JSON.stringify(rowValues(top.el, "claude")) === JSON.stringify(["18%", "45%"]), "Claude-only view should use Claude's original values");

  State.settings.codexQuotaEnabled = true;
  top.draw(NOW); side.draw(NOW);
  assert(JSON.stringify(rowValues(top.el, "claude")) === JSON.stringify(["18%", "45%"]), "Claude values changed when Codex was enabled");
  assert(JSON.stringify(rowValues(top.el, "codex")) === JSON.stringify(["63%", "29%"]), "Codex values were mixed with Claude");
  assert(top.el.querySelector(".res-provider-claude .res-state")?.textContent === "Fresh", "Claude Fresh state missing");
  assert(top.el.querySelector(".res-provider-codex .res-state")?.textContent === "Fresh", "Codex Fresh state missing");

  State.codexQuota = codexSnapshot({ quotas: {
    fiveHour: { usedPercent: 0, resetsAt: NOW + 3 * 60 * 60_000, windowDurationMins: 300 },
    sevenDay: { usedPercent: 8, resetsAt: NOW + 5 * 24 * 60 * 60_000, windowDurationMins: 10_080 },
  } });
  top.draw(NOW); side.draw(NOW);
  assert(JSON.stringify(rowValues(top.el, "codex")) === JSON.stringify(["0%", "8%"]), "provider-confirmed Codex 0% use must remain 0% in Home");

  State.usage = { ...claude, fiveHour: { usedPercent: 91, resetsAt: NOW - 1 } };
  State.codexQuota = codexSnapshot({ quotas: {
    fiveHour: { usedPercent: 76, resetsAt: NOW - 1, windowDurationMins: 300 },
    sevenDay: { usedPercent: 29.1, resetsAt: NOW + 5 * 24 * 60 * 60_000, windowDurationMins: 10_080 },
  } });
  top.draw(NOW); side.draw(NOW);
  assert(JSON.stringify(rowValues(top.el, "claude")) === JSON.stringify(["0%", "45%"]), "Claude 5h reset affected the independent 7d window");
  assert(JSON.stringify(rowValues(top.el, "codex")) === JSON.stringify(["Unavailable", "29%"]), "Codex 5h reset affected the independent 7d window");

  State.codexQuota = codexSnapshot({ stale: true });
  top.draw(NOW); side.draw(NOW);
  assert(top.el.querySelector(".res-provider-codex .res-state")?.textContent === "Stale", "Codex Stale state missing");
  State.codexQuota = null;
  top.draw(NOW); side.draw(NOW);
  assert(top.el.querySelector(".res-provider-codex .res-state")?.textContent === "Loading", "empty enabled provider should show Loading");
  assert(top.el.querySelector(".res-provider-codex .res-none b")?.textContent === "Loading", "Codex Loading message missing");
  State.codexQuota = codexSnapshot({ quotas: null, updatedAt: null, available: false, failureReason: "timeout" });
  top.draw(NOW); side.draw(NOW);
  assert(top.el.querySelector(".res-provider-codex .res-state")?.textContent === "Unavailable", "provider failure should be Unavailable, not Loading");

  State.codexQuota = codexSnapshot();
  State.settings.codexQuotaEnabled = false;
  top.draw(NOW); side.draw(NOW);
  assert(top.el.querySelector<HTMLElement>(".res-provider-codex")?.hidden, "opt-out did not hide Codex section");
  State.codexQuota = null;
  State.settings.codexQuotaEnabled = true;
  top.draw(NOW); side.draw(NOW);
  assert(top.el.querySelector(".res-provider-codex .res-state")?.textContent === "Loading", "re-enabled empty provider showed old snapshot");

  State.codexQuota = codexSnapshot();
  top.draw(NOW); side.draw(NOW);
  const layouts = [layoutCheck(top.el, "top"), layoutCheck(side.el, "right")];
  output.dataset.testResult = "pass";
  output.textContent = JSON.stringify({ ok: true, layouts });
} catch (error) {
  output.dataset.testResult = "fail";
  output.textContent = error instanceof Error ? error.message : String(error);
}
(window as typeof window & { __shotReady?: boolean }).__shotReady = true;

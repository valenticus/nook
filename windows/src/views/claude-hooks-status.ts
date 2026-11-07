import { State } from "../core/state";
import { currentLanguage, message } from "../core/i18n";
import { subscribeConnectScan } from "../core/connect-runtime";
import { summarizeAgentConnection } from "../core/connect-status";
import type { ConnectAgent, ConnectScan } from "../core/bridge";
import { clear, dot, h } from "./dom";

const AGENTS: { id: ConnectAgent; label: string }[] = [
  { id: "ClaudeCode", label: "Claude Code" },
  { id: "Codex", label: "Codex" },
];

function currentBuild() {
  return State.nookDev ? "Dev" : State.nookStandalone ? "Standalone" : "Original";
}

/** Shared, read-only connection indicators for Home and the Island settings view. */
export function buildClaudeHooksStatus(compact = false) {
  const list = h("div", { class: compact ? "agent-status-list home-agent-status" : "agent-status-list" });
  const rows = new Map(AGENTS.map(({ id }) => [id, h("span", { class: "status-badge agent-status-badge" })]));
  let scan: ConnectScan | null = null;
  let renderedKey = "";

  function sync() {
    const build = currentBuild();
    const language = currentLanguage();
    const key = `${build}:${language}:${scan?.agents.map((a) => `${a.agent}-${a.configurationStatus}-${a.deliveryState}-${a.lastReceivedAtMs}`).join("|") ?? "pending"}:${scan?.hooks.length ?? 0}`;
    if (key === renderedKey) return;
    renderedKey = key;
    clear(list);
    for (const { id, label } of AGENTS) {
      const summary = summarizeAgentConnection(scan, id, build);
      const color = summary.state === "Connected" ? "#22C55E" : summary.state === "Needs repair" ? "#F5B942" : "#8E939C";
      const stateText = message(summary.state);
      const activity = summary.delivery === "Receiving" ? message("Receiving events") : summary.state === "Connected" ? message("Waiting for activity") : "";
      const row = rows.get(id)!;
      row.title = message(connectionDetail(summary.detail));
      row.dataset.status = summary.state.toLowerCase().replaceAll(" ", "-");
      const text = activity
        ? message("{agent} · {status} · {activity}", { agent: label, status: stateText, activity })
        : message("{agent} · {status}", { agent: label, status: stateText });
      row.replaceChildren(dot(color, 5), h("span", { class: "agent-status-label", text }));
      list.append(row);
    }
  }

  const unsubscribeScan = subscribeConnectScan((next) => { scan = next; sync(); });
  const unsubscribeState = State.subscribe(sync);
  sync();
  return { el: list, sync, dispose: () => { unsubscribeScan(); unsubscribeState(); } };
}

function connectionDetail(detail: ReturnType<typeof summarizeAgentConnection>["detail"]): string {
  switch (detail) {
    case "connected": return "Agent hooks are configured for this Nook build.";
    case "otherBuild": return "Hooks from a different Nook build were found; they do not connect this build.";
    case "incomplete": return "Some required hooks are missing. Review Connect to repair this agent.";
    case "relayMissing": return "A configured hook points to a relay that is not available.";
    case "duplicate": return "Duplicate hooks were found across configuration scopes.";
    case "unreadable": return "An agent configuration could not be read safely.";
    default: return "No hooks for this Nook build were found.";
  }
}

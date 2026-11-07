import { invoke } from "@tauri-apps/api/core";
import { h } from "./views/dom";
import { message } from "./core/i18n";
import "./dev-simulator.css";

type Agent = "claude" | "codex";
type Event = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PermissionRequest" | "Stop" | "SessionEnd";
type BatteryTestEvent = "BatteryTestStart" | "BatteryTest20" | "BatteryTest10" | "BatteryTestCharging" | "BatteryTest100" | "BatteryTestAbsent" | "BatteryTestUnknown" | "BatteryTestReset";
type ManualStatus = {
  runId: string;
  claudeSessionId: string;
  codexSessionId: string;
  claudeRequest: string;
  codexRequest: string;
  pending: number;
  claudeSession: string;
  codexSession: string;
  cleanupErrors: string[];
};

const RUNS: Partial<Record<Agent, string[]>> = {};
const newRunId = () => `run-${crypto.randomUUID()}`;
const currentRun = (agent: Agent) => RUNS[agent]?.at(-1);

async function emit(agent: Agent, event: Event, runId = currentRun(agent)) {
  if (!runId) return;
  await invoke("dev_simulator_emit", { agent, event, runId });
  if (event === "SessionEnd") RUNS[agent] = (RUNS[agent] ?? []).filter((id) => id !== runId);
}

async function start(agent: Agent) {
  const runId = newRunId();
  RUNS[agent] = [...(RUNS[agent] ?? []), runId];
  await invoke("dev_simulator_emit", { agent, event: "SessionStart", runId });
}

async function turn(agent: Agent) {
  if (!currentRun(agent)) await start(agent);
  await emit(agent, "UserPromptSubmit");
  await emit(agent, "PreToolUse");
  await emit(agent, "PostToolUse");
}

async function permission(agent: Agent) {
  if (!currentRun(agent)) await start(agent);
  await emit(agent, "PermissionRequest");
}

async function batteryFixture(event: BatteryTestEvent) {
  await invoke("dev_simulator_emit", { agent: "claude", event, runId: `battery-${crypto.randomUUID()}` });
}

function action(label: string, run: () => void | Promise<void>) {
  return h("button", { type: "button", class: "sp-btn quiet nook-dev-sim-action", text: label, onclick: () => { void run(); } });
}

/** The Dev-only event controls placed within Settings → Connect. */
export function createDevSimulatorControl() {
  const panel = h("section", { class: "sp-group nook-dev-sim", "aria-label": "Dev event simulator", "data-testid": "dev-simulator" });
  const manualStatus = h("pre", { class: "nook-dev-alert-status", role: "status", "aria-live": "polite", text: "Two-alert controller idle. Start creates two deny-only requests through nook-hook-dev and Dev IPC." });
  const showManualStatus = (status: ManualStatus | null) => {
    manualStatus.textContent = status ? [
      message("Run: {runId}", { runId: status.runId }),
      message("Pending requests: {count}", { count: status.pending }),
      message("{agent} {sessionId}: {request}; session {session}", { agent: "Claude", sessionId: status.claudeSessionId, request: status.claudeRequest, session: status.claudeSession }),
      message("{agent} {sessionId}: {request}; session {session}", { agent: "Codex", sessionId: status.codexSessionId, request: status.codexRequest, session: status.codexSession }),
      status.cleanupErrors.length ? message("Cleanup errors: {errors}", { errors: status.cleanupErrors.join("; ") }) : message("Cleanup errors: none"),
    ].join("\n") : message("Two-alert controller idle.");
  };
  const manualAction = (label: string, command: string, onSuccess: (status: ManualStatus | null) => void) => action(label, async () => {
    try {
      const status = await invoke<ManualStatus | null>(command);
      onSuccess(status);
    } catch (error) {
      manualStatus.textContent = message("{label} failed: {error}", { label, error: String(error) });
    }
  });
  panel.append(
    h("h2", { class: "sp-group-label", text: "Dev event simulator" }),
    h("div", { class: "sp-box nook-dev-sim-box" },
      h("p", { class: "sp-help nook-dev-sim-note", text: "Synthetic events only. Permission buttons are local UI simulation; no agent or command is connected." }),
    h("div", { class: "nook-dev-sim-row" },
      action("Start Claude", () => start("claude")),
      action("Start Codex", () => start("codex")),
      action("Start both", async () => { await start("claude"); await start("codex"); }),
    ),
    h("div", { class: "nook-dev-sim-row" },
      action("Claude: prompt + tool", () => turn("claude")),
      action("Codex: prompt + tool", () => turn("codex")),
    ),
    h("div", { class: "nook-dev-sim-row" },
      action("Claude: permission (8 s)", () => permission("claude")),
      action("Codex: permission (8 s)", () => permission("codex")),
    ),
    h("div", { class: "nook-dev-sim-row" },
      action("Stop Claude turn", () => emit("claude", "Stop")),
      action("Stop Codex turn", () => emit("codex", "Stop")),
    ),
    h("div", { class: "nook-dev-sim-row" },
      action("End Claude session", () => emit("claude", "SessionEnd")),
      action("End Codex session", () => emit("codex", "SessionEnd")),
    ),
    h("div", { class: "nook-dev-sim-row" },
      action("Clear simulated sessions", async () => {
        await Promise.all((Object.entries(RUNS) as [Agent, string[]][]).flatMap(([agent, runIds]) =>
          runIds.map((runId) => emit(agent, "SessionEnd", runId)),
        ));
      }),
    ),
    ),
    h("div", { class: "sp-box nook-dev-sim-box" },
    h("h3", { class: "sp-group-label nook-dev-alert-title", text: "Battery alerts - local Dev fixture" }),
    h("p", { class: "sp-help nook-dev-sim-note", text: "These controls feed synthetic samples into the same Dev battery monitor. They do not create sessions or change Windows power status. Reset returns to live read-only Windows status." }),
    h("div", { class: "nook-dev-sim-row" },
      action("Start at 55%", () => batteryFixture("BatteryTestStart")),
      action("Set 20%", () => batteryFixture("BatteryTest20")),
      action("Set 10%", () => batteryFixture("BatteryTest10")),
      action("Charging", () => batteryFixture("BatteryTestCharging")),
    ),
    h("div", { class: "nook-dev-sim-row" },
      action("100% full", () => batteryFixture("BatteryTest100")),
      action("No system battery", () => batteryFixture("BatteryTestAbsent")),
      action("Unknown", () => batteryFixture("BatteryTestUnknown")),
      action("Reset to Windows", () => batteryFixture("BatteryTestReset")),
    ),
    ),
    h("h3", { class: "sp-group-label nook-dev-alert-title", text: "Two pending alerts — real Dev IPC" }),
    h("p", { class: "sp-help nook-dev-sim-note", text: "Creates two synthetic sessions and deny-only permission cards through nook-hook-dev. No agent or command runs. Use Status to distinguish pending, resolved and completed; Cleanup ends only this run's two IDs." }),
    h("div", { class: "nook-dev-sim-row" },
      manualAction("Start two alerts", "dev_manual_alerts_start", (status) => showManualStatus(status)),
      manualAction("Status", "dev_manual_alerts_status", (status) => showManualStatus(status)),
      manualAction("Cleanup this run", "dev_manual_alerts_cleanup", (status) => showManualStatus(status)),
    ),
    manualStatus,
  );
  return panel;
}

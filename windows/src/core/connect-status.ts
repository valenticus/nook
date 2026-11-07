import type { ConnectAgent, ConnectScan, ConnectScope, ConnectOwnership } from "./bridge";

export type ConnectBuild = "Original" | "Dev" | "Standalone";
export type AgentConnectionState = "Connected" | "Not connected" | "Needs repair";

const REQUIRED: Record<ConnectAgent, readonly string[]> = {
  ClaudeCode: ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop"],
  Codex: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd", "Interrupt", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"],
};

function expectedOwnership(build: ConnectBuild): ConnectOwnership {
  return build === "Dev" ? "NookDev" : build === "Standalone" ? "StandaloneNook" : "OriginalNook";
}

function allowedScopes(build: ConnectBuild): readonly ConnectScope[] {
  return build === "Dev" ? ["Project", "ProjectLocal"] : ["User", "Project", "ProjectLocal"];
}

function currentRelayMatches(relayPath: string | null, scan: ConnectScan, build: ConnectBuild): boolean {
  if (!relayPath) return false;
  const normalized = relayPath.replaceAll("/", "\\").toLowerCase().replace(/\\+$/, "");
  if (build === "Standalone") return normalized === scan.standaloneRelay.replaceAll("/", "\\").toLowerCase().replace(/\\+$/, "");
  if (build === "Dev") return normalized.endsWith("\\nookdev\\bin\\nook-hook-dev.exe");
  return normalized.endsWith("\\nook\\bin\\nook-hook.exe");
}

export interface AgentConnectionSummary {
  state: AgentConnectionState;
  detail: "connected" | "notConfigured" | "otherBuild" | "incomplete" | "relayMissing" | "duplicate" | "unreadable";
  delivery: "Receiving" | "WaitingForActivity" | "NotConfigured";
  lastEvent: string | null;
  lastEventAt: number | null;
}

export function primaryConnectionAction(state: AgentConnectionState): "Connect" | "Repair" | "Disconnect" {
  return state === "Not connected" ? "Connect" : state === "Needs repair" ? "Repair" : "Disconnect";
}

/** Derives setup for this exact app identity; CLI presence and other Nook builds never count as connection. */
export function summarizeAgentConnection(scan: ConnectScan | null, agent: ConnectAgent, build: ConnectBuild): AgentConnectionSummary {
  const blank: AgentConnectionSummary = { state: "Not connected", detail: "notConfigured", delivery: "NotConfigured", lastEvent: null, lastEventAt: null };
  if (!scan) return blank;

  const scopes = allowedScopes(build);
  const owned = scan.hooks.filter((hook) => hook.agent === agent && hook.ownership === expectedOwnership(build) && scopes.includes(hook.scope));
  const anyNook = scan.hooks.some((hook) => hook.agent === agent && ["OriginalNook", "NookDev", "StandaloneNook"].includes(hook.ownership));
  const unreadable = scan.configs.some((config) => config.agent === agent && ["Malformed", "Inaccessible"].includes(config.status));
  const other = scan.hooks.some((hook) => hook.agent === agent && ["OriginalNook", "NookDev", "StandaloneNook"].includes(hook.ownership) && (hook.ownership !== expectedOwnership(build) || !scopes.includes(hook.scope)));
  const summary = scan.agents.find((entry) => entry.agent === agent);
  const delivery = summary?.deliveryState ?? (owned.length ? "WaitingForActivity" : "NotConfigured");
  const lastEvent = summary?.lastReceivedEvent ?? null;
  const lastEventAt = summary?.lastReceivedAtMs ?? null;
  const base = { delivery, lastEvent, lastEventAt };

  if (!owned.length) {
    // Hooks owned by another Nook identity are migration candidates, not a
    // broken connection for this build. Keep them visible in the detail text,
    // while leaving the primary action as Connect (which opens a preview).
    if (unreadable) return { ...blank, ...base, detail: "unreadable" };
    if (other || anyNook) return { ...blank, ...base, detail: "otherBuild" };
    return { ...blank, ...base };
  }

  const missingRelay = owned.some((hook) => hook.relayExists !== true || !currentRelayMatches(hook.relayPath, scan, build));
  const present = new Set(owned.map((hook) => hook.event));
  const incomplete = REQUIRED[agent].some((event) => !present.has(event));
  const perConfigEvent = new Set<string>();
  const duplicateWithinConfig = owned.some((hook) => {
    const key = `${hook.configPath.toLowerCase()}\n${hook.event}`;
    if (perConfigEvent.has(key)) return true;
    perConfigEvent.add(key);
    return false;
  });
  const duplicate = duplicateWithinConfig || scan.duplicates.some((item) => item.agent === agent && item.scopes.some((scope) => scopes.includes(scope)));
  if (missingRelay) return { ...base, state: "Needs repair", detail: "relayMissing" };
  if (duplicate) return { ...base, state: "Needs repair", detail: "duplicate" };
  if (incomplete || unreadable) return { ...base, state: "Needs repair", detail: unreadable ? "unreadable" : "incomplete" };
  return { ...base, state: "Connected", detail: "connected" };
}

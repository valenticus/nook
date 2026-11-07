import test from "node:test";
import assert from "node:assert/strict";
import type { ConnectAgent, ConnectScan } from "../src/core/bridge.ts";
import { primaryConnectionAction, summarizeAgentConnection } from "../src/core/connect-status.ts";

const events: Record<ConnectAgent, string[]> = {
  ClaudeCode: ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop"],
  Codex: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd", "Interrupt", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"],
};

function scan(owner: "OriginalNook" | "NookDev" | "StandaloneNook", scope: "User" | "Project" | "ProjectLocal", agent: ConnectAgent = "ClaudeCode"): ConnectScan {
  const relayPath = owner === "NookDev" ? "C:\\Users\\sample\\AppData\\Local\\NookDev\\bin\\nook-hook-dev.exe" : owner === "StandaloneNook" ? "C:\\NookStandalone\\bin\\nook-hook-standalone.exe" : "C:\\Users\\sample\\AppData\\Local\\Nook\\bin\\nook-hook.exe";
  const hooks = events[agent].map((event) => ({ agent, scope, configPath: `C:\\project\\sample\\${scope}.json`, event, ownership: owner, command: relayPath, relayPath, relayExists: true }));
  return {
    standaloneRelay: "C:\\NookStandalone\\bin\\nook-hook-standalone.exe", standaloneRelayReady: true,
    detectedAgents: [], configs: [], hooks, duplicates: [],
    agents: [{ agent, configurationStatus: "Configured", deliveryState: "WaitingForActivity", lastReceivedEvent: null, lastReceivedAtMs: null }], issues: [],
  } as ConnectScan;
}

test("connection is scoped to the active build identity, not CLI presence or another Nook", () => {
  const original = scan("OriginalNook", "User");
  assert.equal(summarizeAgentConnection(original, "ClaudeCode", "Original").state, "Connected");
  assert.deepEqual(
    [summarizeAgentConnection(original, "ClaudeCode", "Standalone").state, summarizeAgentConnection(original, "ClaudeCode", "Standalone").detail],
    ["Not connected", "otherBuild"],
  );
  assert.equal(primaryConnectionAction(summarizeAgentConnection(original, "ClaudeCode", "Standalone").state), "Connect");
  assert.deepEqual(
    [summarizeAgentConnection(original, "ClaudeCode", "Dev").state, summarizeAgentConnection(original, "ClaudeCode", "Dev").detail],
    ["Not connected", "otherBuild"],
  );
  const devProject = scan("NookDev", "Project", "Codex");
  assert.equal(summarizeAgentConnection(devProject, "Codex", "Dev").state, "Connected");
  assert.equal(summarizeAgentConnection(devProject, "Codex", "Original").state, "Not connected");
  assert.equal(summarizeAgentConnection(scan("StandaloneNook", "User"), "ClaudeCode", "Standalone").state, "Connected");
});

test("missing events, broken relays, unreadable configs and duplicate scopes require repair", () => {
  const incomplete = scan("StandaloneNook", "User");
  incomplete.hooks.pop();
  assert.equal(summarizeAgentConnection(incomplete, "ClaudeCode", "Standalone").detail, "incomplete");

  const broken = scan("StandaloneNook", "User");
  broken.hooks[0]!.relayExists = false;
  assert.equal(summarizeAgentConnection(broken, "ClaudeCode", "Standalone").detail, "relayMissing");

  const duplicate = scan("StandaloneNook", "User");
  duplicate.duplicates.push({ agent: "ClaudeCode", event: "Stop", relayPath: "x", scopes: ["User", "Project"], configPaths: ["a", "b"] });
  assert.equal(summarizeAgentConnection(duplicate, "ClaudeCode", "Standalone").detail, "duplicate");

  const unreadable = scan("StandaloneNook", "User");
  unreadable.configs.push({ agent: "ClaudeCode", scope: "User", path: "bad.json", status: "Malformed", error: "bad json" });
  assert.equal(summarizeAgentConnection(unreadable, "ClaudeCode", "Standalone").state, "Needs repair");
});

test("an unreadable config without Standalone-owned hooks cannot expose Repair or Disconnect", () => {
  const value = scan("OriginalNook", "User");
  value.hooks = [];
  value.configs.push({ agent: "ClaudeCode", scope: "User", path: "bad.json", status: "Malformed", error: "bad json" });
  const result = summarizeAgentConnection(value, "ClaudeCode", "Standalone");
  assert.equal(result.state, "Not connected");
  assert.equal(result.detail, "unreadable");
  assert.equal(primaryConnectionAction(result.state), "Connect");
});

test("a project Codex Dev connection stays project scoped and delivery is separate", () => {
  const value = scan("NookDev", "Project", "Codex");
  value.agents[0]!.deliveryState = "Receiving";
  value.agents[0]!.lastReceivedEvent = "Stop";
  const result = summarizeAgentConnection(value, "Codex", "Dev");
  assert.equal(result.state, "Connected");
  assert.equal(result.delivery, "Receiving");
  assert.equal(result.lastEvent, "Stop");
  assert.equal(summarizeAgentConnection(scan("NookDev", "User", "Codex"), "Codex", "Dev").state, "Not connected");
});

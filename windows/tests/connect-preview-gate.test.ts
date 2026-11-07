import test from "node:test";
import assert from "node:assert/strict";
import { createConnectPreviewGate } from "../src/settings/connect-preview-gate.ts";

test("repeated Connect replaces the prior request and late replies cannot restore it", () => {
  const gate = createConnectPreviewGate<"ClaudeCode" | "Codex">();
  const first = gate.begin("ClaudeCode");
  const second = gate.begin("ClaudeCode");
  assert.equal(gate.isCurrent("ClaudeCode", first), false);
  assert.equal(gate.isCurrent("ClaudeCode", second), true);
});

test("Cancel invalidates the in-flight preview and window return does not revive the ticket", () => {
  const gate = createConnectPreviewGate<"ClaudeCode" | "Codex">();
  const request = gate.begin("ClaudeCode");
  gate.cancel("ClaudeCode", request);
  assert.equal(gate.isCurrent("ClaudeCode", request), false);
  assert.equal(gate.isCurrent("ClaudeCode", gate.begin("ClaudeCode")), true);
});

test("Claude and Codex previews remain independent during fast switching", () => {
  const gate = createConnectPreviewGate<"ClaudeCode" | "Codex">();
  const claude = gate.begin("ClaudeCode");
  const codex = gate.begin("Codex");
  assert.equal(gate.isCurrent("ClaudeCode", claude), true);
  assert.equal(gate.isCurrent("Codex", codex), true);
  assert.equal(gate.isCurrent("ClaudeCode", gate.begin("ClaudeCode")), true);
  assert.equal(gate.isCurrent("Codex", codex), true);
});

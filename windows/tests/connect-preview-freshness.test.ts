import test from "node:test";
import assert from "node:assert/strict";
import type { ConnectPreview, ConnectScan } from "../src/core/bridge.ts";
import { connectPreviewIsFresh } from "../src/settings/connect-preview-freshness.ts";

const preview = (operation: ConnectPreview["operation"] = "Connect"): ConnectPreview => ({
  previewId: "ticket-1", operation, targetRelay: "relay.exe", agent: "ClaudeCode",
  files: [{ agent: "ClaudeCode", scope: "User", path: "C:/Users/Test/.claude/settings.json", status: "Readable", fingerprint: "same", backupRequired: true, backupPath: "backup", diff: "changes", changes: [], conflicts: [] }],
  duplicates: [], preservedRecords: 0, conflicts: [], approvedDevScopes: [], devScopesRequiringApproval: [], codexTrustRequired: false, requiresOriginalMigration: false,
});

const scan = (): ConnectScan => ({
  standaloneRelay: "C:/NookStandalone/bin/nook-hook-standalone.exe", standaloneRelayReady: true, detectedAgents: [],
  configs: [{ agent: "ClaudeCode", scope: "User", path: "c:\\users\\test\\.claude\\settings.json", status: "Readable", fingerprint: "same", error: null }],
  hooks: [], duplicates: [], agents: [], issues: [],
});

test("preview stays fresh across path casing but detects changed bytes or config status", () => {
  assert.equal(connectPreviewIsFresh(preview(), scan(), "ClaudeCode"), true);
  const changed = scan();
  changed.configs[0]!.fingerprint = "new-bytes";
  assert.equal(connectPreviewIsFresh(preview(), changed, "ClaudeCode"), false);
  const missing = scan();
  missing.configs[0]!.status = "Missing";
  assert.equal(connectPreviewIsFresh(preview(), missing, "ClaudeCode"), false);
});

test("preview goes stale when its config disappears or a new candidate appears", () => {
  const disappeared = scan();
  disappeared.configs = [];
  assert.equal(connectPreviewIsFresh(preview(), disappeared, "ClaudeCode"), false);
  const addedCandidate = scan();
  addedCandidate.configs.push({ agent: "ClaudeCode", scope: "Project", path: "C:/repo/.claude/settings.json", status: "Missing", fingerprint: "empty", error: null });
  assert.equal(connectPreviewIsFresh(preview(), addedCandidate, "ClaudeCode"), false);
});

test("Disconnect preview goes stale if newly scanned Standalone-owned hooks were not reviewed", () => {
  const current = scan();
  current.hooks.push({ agent: "ClaudeCode", scope: "Project", configPath: "C:/repo/.claude/settings.json", event: "Stop", ownership: "StandaloneNook", command: "relay", relayPath: "relay", relayExists: true });
  assert.equal(connectPreviewIsFresh(preview("Disconnect"), current, "ClaudeCode"), false);
});

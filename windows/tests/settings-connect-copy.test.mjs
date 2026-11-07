import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [ui, bridge, backend, rust] = await Promise.all([
  readFile(new URL("../src/settings/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/core/bridge.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/settings/backend.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
]);

test("Connect has independent Claude Code and Codex status cards", () => {
  assert.match(ui, /connectAgentCard\("ClaudeCode", "Claude Code"\)/);
  assert.match(ui, /connectAgentCard\("Codex", "Codex"\)/);
  for (const status of ["Not connected", "Needs repair", "Configured", "Receiving events", "Waiting for activity"]) {
    assert.ok(ui.includes(status), `missing ${status}`);
  }
  assert.match(ui, /message\("Last event: \{event\}\{time\}"/);
  assert.match(ui, /Preview only in this build\. Agent configuration files will not be changed\./);
  assert.doesNotMatch(ui, /Show Cursor sessions|group\("Session sources"/);
  assert.doesNotMatch(ui, /connectGroup\("reply", "Reply layout"/);
  assert.match(ui, /new URLSearchParams\(location\.search\)\.get\("devSimulator"\) === "1"/);
  assert.doesNotMatch(ui, /updatesGroup\(\)|Check for updates every day/);
  assert.doesNotMatch(ui.slice(ui.indexOf("function connectSection()"), ui.indexOf("function quotaWindowRow")), /cursorGroup\(|Cursor hooks/);
});

test("Connect copy is localized and About is the Nook Personal Edition", async () => {
  const i18n = await readFile(new URL("../src/core/i18n.ts", import.meta.url), "utf8");
  for (const phrase of ["Needs repair", "Receiving events", "Waiting for activity", "Last event: {event}{time}", "I approve migrating Original Nook hooks.", "I understand Codex may ask me to trust these hooks in its own prompt.", "Developed by", "Valentyn Fetisov"]) {
    assert.ok(i18n.includes(`"${phrase}": { en:`), `missing localized phrase ${phrase}`);
  }
  assert.match(ui, /Nook Personal Edition/);
  assert.doesNotMatch(ui, /zubairbinshaukat|zubyr\.dev|linkedin\.com\/in\/zubairbinshaukat/);
});

test("Claude Usage distinguishes Standalone, Original and third-party statusLines", async () => {
  const i18n = await readFile(new URL("../src/core/i18n.ts", import.meta.url), "utf8");
  assert.match(ui, /u\.statusLineOwner === "standalone"/);
  assert.match(ui, /u\.statusLineOwner === "original"/);
  assert.match(ui, /The preview will show how Nook keeps it working/);
  assert.match(ui, /Migrate Original statusLine…/);
  assert.match(ui, /Connect Claude statistics…/);
  assert.match(ui, /originalMigrationRequired && !flow\.originalMigrationApproved/);
  assert.match(ui, /usageApply\(flow\.install, flow\.preview\.fingerprint, flow\.originalMigrationApproved === true\)/);
  assert.match(ui, /await readClaude\(\);\s*paintClaude\(\);/);
  assert.match(ui, /class: "sp-usage-preview-summary"/);
  assert.match(ui, /Current statusLine relay: \{relay\}/);
  assert.match(ui, /New Standalone relay: \{relay\}/);
  for (const phrase of [
    "Original statusLine found", "Claude usage is connected through the Standalone statusLine.",
    "Connect Claude statistics…", "Migrate Original statusLine…", "Turn off…",
    "I approve migrating the Original Nook statusLine to Standalone.",
    "Current statusLine relay: {relay}", "New Standalone relay: {relay}",
    "Scope: {scope} — {path}", "Could not write: {reason}",
  ]) assert.ok(i18n.includes(`"${phrase}": { en:`), `missing Claude Usage translation: ${phrase}`);
  assert.match(ui, /agent === "ClaudeCode" \? integration\("usage"\) : null/);
});

test("review is agent-scoped and requires standalone mode, explicit approvals and confirmation", () => {
  assert.match(bridge, /connectPreview: \(agent: ConnectAgent, operation: ConnectOperation/);
  assert.match(backend, /connectApply\(previewId: string, approvedDevScopes: string\[], codexTrustApproved: boolean, originalMigrationApproved: boolean, confirmed: boolean\)/);
  assert.match(ui, /nookStandalone && !!preview\.previewId/);
  assert.match(ui, /I approve migrating Original Nook hooks/);
  assert.match(ui, /I approve removing Nook Dev hooks from/);
  assert.match(ui, /I understand Codex may ask me to trust/);
  assert.match(ui, /Nothing is written until you confirm/);
  assert.match(rust, /ensure_connect_apply_allowed\(\)\?/);
  assert.match(rust, /Configuration changed since preview/);
});

test("Connect open only scans; delivery refresh comes from supported real relay events", async () => {
  assert.match(ui, /nook\.connectScan\(\)/);
  assert.match(bridge, /listen\("connect-activity"/);
  assert.match(rust, /original_migration_approved/);
  const pipe = await readFile(new URL("../src-tauri/src/pipe.rs", import.meta.url), "utf8");
  assert.match(pipe, /real_delivery\(&payload, &event\)/);
  assert.match(pipe, /app\.emit\("connect-activity"/);
});

test("Connect previews replace per-agent content and reject stale requests", () => {
  assert.match(ui, /connectPreviewGate\.begin\(agent\)/);
  assert.match(ui, /connectPreviewPanels\.get\(agent\)\?\.remove\(\)/);
  assert.match(ui, /if \(!connectPreviewGate\.isCurrent\(agent, token\)\) return/);
  assert.match(ui, /connectPreviewGate\.cancel\(agent, token\)/);
  assert.match(ui, /button\(message\("Cancel"\), "secondary", close\)/);
  assert.match(ui, /connectApply\(preview\.previewId, preview\.approvedDevScopes, preview\.codexTrustRequired, preview\.requiresOriginalMigration, true\)/);
});

test("Connect preview survives scanner repaint and blocks stale fingerprints", async () => {
  const freshness = await readFile(new URL("../src/settings/connect-preview-freshness.ts", import.meta.url), "utf8");
  assert.match(ui, /const openPreview = connectPreviewPanels\.get\(agent\)/);
  assert.match(ui, /if \(openPreview\) card\.append\(openPreview\)/);
  assert.match(ui, /connectPreviewIsFresh\(state\.preview, next, agent\)/);
  assert.match(ui, /connectPreviewStates\.get\(agent\)\?\.stale \?\? stale/);
  assert.match(ui, /stale \|\| !writable/);
  assert.match(ui, /connectPreviewStates\.delete\(agent\)/);
  assert.match(freshness, /current\.fingerprint \?\? null\) !== \(file\.fingerprint \?\? null/);
  assert.match(freshness, /ownership === "StandaloneNook"/);
  assert.match(ui, /button\(message\("Cancel"\), "secondary", close\)/);
  assert.match(ui, /setInterval\(\(\) => \{ void refreshConnectInventory\(\); \}, 2000\)/);
  assert.match(ui, /window\.addEventListener\("focus", \(\) => void refreshConnectInventory\(\)\)/);
});

test("Connect preview summarizes plan records and keeps technical diff collapsed and copyable", async () => {
  assert.match(ui, /changes\.filter\(\(change\) => change\.kind === "Add"\)/);
  assert.match(ui, /preview\.preservedRecords/);
  assert.match(ui, /class: "sp-connect-technical"/);
  assert.match(ui, /navigator\.clipboard/);
  assert.match(ui, /This preview migrates Original Nook hooks to Standalone/);
  const css = await readFile(new URL("../src/settings/settings.css", import.meta.url), "utf8");
  assert.match(css, /\.sp-connect-preview pre \{[^}]*overflow:auto/s);
  assert.match(css, /@container win \(max-width: 420px\)/);
});

test("Island waiting sample represents sessions needing attention, not unread completions", async () => {
  const [preview, compact, roster] = await Promise.all([
    readFile(new URL("../src/settings/island-preview.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/island/compact.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/views/roster.ts", import.meta.url), "utf8"),
  ]);
  assert.match(preview, /waiting: \{[^\n]*name: "Sessions waiting for you", short: "Waiting"/);
  assert.match(compact, /waiting: \{ width: COMPACT_WAITING_CELL_W, name: "Sessions waiting for you"/);
  assert.match(roster, /State\.sessions\.filter\(\(s\) => s\.approval != null \|\| s\.question != null\)\.length/);
  assert.doesNotMatch(preview, /Unread notifications|short: "Unread"/);
});

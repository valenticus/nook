import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

test("persisted settings and locale are applied before the Island is constructed", () => {
  const boot = source.indexOf("const boot = await bootWithRetry();");
  const applySettings = source.indexOf("State.settings = { ...State.settings, ...boot.settings };", boot);
  const applyLocale = source.indexOf('setLanguage(resolveLanguage(State.settings.language), "island.boot");', applySettings);
  const construct = source.indexOf("const island = new Island(root);", applyLocale);
  const localizeAttachedTree = source.indexOf('setLanguage(resolveLanguage(State.settings.language), "island.after-create");', construct);
  assert.ok(boot >= 0 && applySettings > boot && applyLocale > applySettings && construct > applyLocale && localizeAttachedTree > construct,
    "boot settings and locale must be ready before rendering, then the attached tree is translated synchronously");
  assert.ok(localizeAttachedTree - construct < 300, "no await or scheduled callback may intervene before synchronous localization");
});

test("Home and usage cards localize changing status text at the point they render", async () => {
  const home = await readFile(new URL("../src/views/home.ts", import.meta.url), "utf8");
  const usage = await readFile(new URL("../src/views/home-usage.ts", import.meta.url), "utf8");
  assert.match(home, /message\(doingOf\(front\)\)/);
  assert.match(home, /message\(stateWords\(front\)\)/);
  assert.match(usage, /message\(quota\.status\)/);
  assert.match(usage, /message\("\{count\}m ago"/);
});

test("opening Home syncs and localizes its real view before making content visible", async () => {
  const island = await readFile(new URL("../src/island/island.ts", import.meta.url), "utf8");
  const views = await readFile(new URL("../src/views/views.ts", import.meta.url), "utf8");
  const home = await readFile(new URL("../src/views/home.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  const syncStart = island.indexOf("private syncDom() {");
  const syncEnd = island.indexOf("private watchUsageReset()", syncStart);
  const sync = island.slice(syncStart, syncEnd);
  const render = sync.indexOf("if (on) view.sync();");
  const localize = sync.indexOf("localizeSubtree(visibleView.el)");
  const reveal = sync.indexOf('this.contentEl.style.opacity = expanded && !greetingActive ? "1" : "0";');
  assert.ok(syncStart >= 0 && render >= 0 && localize > render && reveal > localize,
    "the selected view must render and localize synchronously before opacity reveals it");
  assert.match(sync, /home-sync-start/);
  assert.match(sync, /home-sync-end/);
  assert.match(sync, /home-first-raf/);
  assert.match(views, /map\.set\("overview", buildHome\(actions\)\)/,
    "Home is constructed once and reused across repeated opens, rather than rebuilt");
  assert.match(home, /class: "view home-view"/);
  assert.match(css, /\.view\.home-view\.on\s*\{\s*opacity:\s*1;\s*transform:\s*none;\s*transition:\s*none;/,
    "the Home text itself must not fade in late or scale into view on every open");
});

test("the Dev trace can distinguish Home localization from DOM mutations and quota updates without storing text", async () => {
  const i18n = await readFile(new URL("../src/core/i18n.ts", import.meta.url), "utf8");
  const trace = await readFile(new URL("../src/core/shelf-trace.ts", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const island = await readFile(new URL("../src/island/island.ts", import.meta.url), "utf8");
  assert.match(i18n, /home-translation/);
  assert.match(i18n, /home-mutation/);
  assert.match(i18n, /home-mutation-observer/);
  assert.match(main, /home-quota-update/);
  assert.match(main, /locale-settings-update/);
  assert.match(main, /previousLocale/);
  assert.match(main, /island\.settings-changed/);
  assert.match(island, /locale-before-home-open/);
  assert.match(island, /locale-before-home-sync/);
  assert.match(island, /locale-first-frame/);
  assert.match(island, /home-dom-visible/);
  assert.match(island, /home-sync-request/);
  assert.match(trace, /Never retain IDs, text, arbitrary objects, settings, or widget\/session data/);
  assert.match(trace, /home-resize/);
});

test("Home keeps its target content box fixed while the outer Island springs", async () => {
  const layout = await readFile(new URL("../src/core/layout.ts", import.meta.url), "utf8");
  const island = await readFile(new URL("../src/island/island.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(layout, /export function homeContentSize\(dock: Dock = Room\.dock\)/);
  assert.match(island, /homeContentSize\(dock\)/);
  assert.match(css, /\.view\.home-view\s*\{[^}]*width:\s*var\(--home-frame-width\)[^}]*height:\s*var\(--home-frame-height\)/s);
  assert.match(css, /The Island clip reveals the same lines progressively without rewrapping/);
});

test("locale tracing records source and both sides of runtime locale changes", async () => {
  const i18n = await readFile(new URL("../src/core/i18n.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/settings/main.ts", import.meta.url), "utf8");
  const trace = await readFile(new URL("../src/core/shelf-trace.ts", import.meta.url), "utf8");
  assert.match(i18n, /previousLocale: previous, newLocale: language, locale: language, source/);
  assert.match(settings, /previousLocale, newLocale: currentLanguage\(\), languagePreference: settings\.language/);
  assert.match(trace, /previous_locale\\tnew_locale\\tlanguage_preference/);
});

test("Home and Island Settings show scanner-backed Claude and Codex status independently", async () => {
  const views = await readFile(new URL("../src/views/views.ts", import.meta.url), "utf8");
  const home = await readFile(new URL("../src/views/home.ts", import.meta.url), "utf8");
  const status = await readFile(new URL("../src/views/claude-hooks-status.ts", import.meta.url), "utf8");
  const model = await readFile(new URL("../src/core/connect-status.ts", import.meta.url), "utf8");
  assert.match(views, /buildClaudeHooksStatus\(\)/);
  assert.match(home, /buildClaudeHooksStatus\(true\)/);
  assert.match(status, /subscribeConnectScan/);
  assert.match(status, /summarizeAgentConnection/);
  assert.match(model, /expectedOwnership\(build\)/);
  assert.match(model, /currentRelayMatches/);
  assert.match(model, /const delivery = summary\?\.deliveryState/);
  assert.doesNotMatch(status, /test integration|session integration unverified/);
  assert.doesNotMatch(model, /detectedAgents/,
    "CLI presence must not count as integration connection state");
});

test("waking from hidden does not synchronously render the same state before the scheduled frame", async () => {
  const island = await readFile(new URL("../src/island/island.ts", import.meta.url), "utf8");
  const start = island.indexOf("private setMode(mode: IslandMode)");
  const end = island.indexOf("private logWake()", start);
  const setMode = island.slice(start, end);
  const frameStart = island.indexOf("private frame = (nowMs: number)");
  const frameEnd = island.indexOf("private updateBotTargets()", frameStart);
  const frame = island.slice(frameStart, frameEnd);
  assert.ok(start >= 0 && end > start);
  assert.match(setMode, /if \(prev === "hidden"\)\s*\{\s*this\.logWake\(\);\s*\}/);
  assert.doesNotMatch(setMode, /if \(prev === "hidden"\)[\s\S]{0,120}this\.syncDom\(\)/);
  assert.match(frame, /if \(this\.dirty\)\s*\{\s*this\.dirty = false;[\s\S]*?this\.syncDom\(\)/);
});

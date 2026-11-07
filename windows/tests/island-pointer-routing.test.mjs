import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [css, island, rustIsland, rustWindows, header, media, devConfig, productionConfig] = await Promise.all([
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../src/island/island.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/island.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/platform/windows.rs", import.meta.url), "utf8"),
  readFile(new URL("../src/views/views.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/widgets/media.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.nook-dev.conf.json", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
]);

test("Compact and Expanded DOM roots enable pointer input only while visible", () => {
  assert.match(css, /#compact\.on\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(island, /this\.contentEl\.style\.pointerEvents\s*=\s*expanded\s*&&\s*!greetingActive\s*\?\s*"auto"\s*:\s*"none"/);
  assert.match(css, /\.view\.on\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.view:not\(\.on\),\s*\.view:not\(\.on\) \*\s*\{[^}]*pointer-events:\s*none !important/s);
});

test("decorative canvases and the outline cannot intercept panel clicks", () => {
  assert.match(css, /#island-shape\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /#bot-canvas,\s*#greeting-canvas\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /#bot-glow\s*\{[^}]*pointer-events:\s*none/s);
});

test("Tauri click-through uses the pushed IslandRect plus a bounded margin", () => {
  assert.match(rustIsland, /let on_island = r\.near\(x, y\)/);
  assert.match(rustIsland, /set_ignore_cursor_events\(ignore\)/);
  assert.match(rustIsland, /const HIT_MARGIN: f64 = 14\.0/);
  assert.match(island, /Bridge\.setIslandRect\(rect\.x, rect\.y, rect\.w, rect\.h\)/);
});

test("Dev pointer diagnostics correlate one cursor and rect snapshot with requested and applied native state", () => {
  assert.match(rustIsland, /let r = \*gate\.rect\.lock\(\)\.unwrap\(\);[\s\S]*let on_island = r\.near\(x, y\)/);
  assert.match(rustIsland, /requested_ignore=\{requested_ignore\} api=queued native_ignore_applied=\{:\?\} point_hits_island=\{:\?\} foreground=\{\}/);
  assert.match(rustIsland, /retry=bounded-250ms/);
  assert.match(rustWindows, /pub fn ignore_cursor_events_applied/);
  assert.match(rustWindows, /pub fn pointer_gate_snapshot/);
  assert.match(rustWindows, /style & WS_EX_TRANSPARENT\.0 != 0/);
  for (const flag of ["WS_EX_TOPMOST", "WS_EX_TRANSPARENT", "WS_EX_NOACTIVATE", "WS_EX_LAYERED"]) {
    assert.ok(rustWindows.includes(flag), `native diagnostics include ${flag}`);
  }
  assert.match(rustWindows, /GetTopWindow\(None\)/);
  assert.match(rustWindows, /GW_HWNDNEXT/);
  assert.match(rustWindows, /vlc_above_nook/);
  assert.match(rustWindows, /WindowFromPoint\(point\)/);
  assert.match(island, /shelfTrace\("pointer-dom-event", \{ source: `\$\{kind\}/);
  assert.match(rustWindows, /GetClassNameW\(front/);
  assert.doesNotMatch(rustWindows, /GetWindowTextW\(front/);
});

test("Home and Shelf tabs retain click navigation handlers", () => {
  assert.match(header, /class: "tab named"[^\n]*onclick: \(\) => go\("overview"\)/);
  assert.match(header, /class: "tab named"[^\n]*onclick: \(\) => go\("shelf"\)/);
});

test("page transitions keep the expanded content hit-testable and preserve fullscreen hiding", () => {
  assert.match(island, /this\.contentEl\.style\.pointerEvents\s*=\s*expanded\s*&&\s*!greetingActive\s*\?\s*"auto"\s*:\s*"none"/);
  const paging = island.match(/private applyPaging\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(paging);
  assert.doesNotMatch(paging, /pointerEvents|set_ignore_cursor_events/);
  const fullscreen = island.match(/private yieldToFullscreen\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(fullscreen);
  assert.match(fullscreen, /this\.fsm\.forceHidden\(\)/);
  assert.match(fullscreen, /State\.sessions\.some\(\(s\) => s\.approval != null \|\| s\.question != null\)/);
});

test("media playback state uses the existing widget and does not create a hit-test overlay", () => {
  assert.match(media, /onclick: \(\) => void press\("toggle", expandedOn\(\)\)/);
  assert.doesNotMatch(media, /set_ignore_cursor_events|setIslandRect|pointer-events/);
});

test("Dev and production keep the same transparent window and WebView hit-testing configuration", () => {
  const config = (source) => JSON.parse(source);
  const dev = config(devConfig).app.windows[0];
  const production = config(productionConfig).app.windows[0];
  for (const key of ["transparent", "width", "height", "resizable", "focus", "additionalBrowserArgs"]) {
    assert.equal(dev[key], production[key], `${key} differs between Dev and production`);
  }
  assert.equal(dev.transparent, true);
});

test("Island show/hide reasserts topmost without taking foreground activation", async () => {
  const config = JSON.parse(devConfig).app.windows[0];
  const showPath = rustIsland.match(/pub fn set_shown\(app: &AppHandle, shown: bool\) \{([\s\S]*?)\n\}/)?.[1];
  const putShown = rustIsland.match(/fn put_shown\(app: &AppHandle, shown: bool\) \{([\s\S]*?)\n\}/)?.[1];
  const applyGeometry = rustIsland.match(/pub fn apply_geometry\([\s\S]*?\n\}/)?.[0];
  const showInactive = rustWindows.match(/pub fn show_inactive\(win: &WebviewWindow\) \{([\s\S]*?)\n\}/)?.[1];
  assert.equal(config.alwaysOnTop, true);
  assert.match(applyGeometry ?? "", /set_always_on_top\(true\)/);
  assert.match(showPath ?? "", /run_on_main_thread\(move \|\| put_shown/);
  assert.match(putShown ?? "", /platform::show_inactive\(&win\)/);
  assert.match(putShown ?? "", /refresh_click_through\(app, &shared\.gate\)/);
  assert.match(showInactive ?? "", /GetForegroundWindow\(\)/);
  assert.match(showInactive ?? "", /win\.show\(\)/);
  assert.match(showInactive ?? "", /SetForegroundWindow\(before\)/);
});

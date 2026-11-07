import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [island, dom, views, media, css] = await Promise.all([
  readFile(new URL("../src/island/island.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/views/dom.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/views/views.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/widgets/media.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
]);

test("Dev pointer trace records WebView hit target, expected control geometry, style and capture", () => {
  assert.match(island, /document\.elementFromPoint\(pointX, pointY\)/);
  assert.match(island, /getBoundingClientRect\(\)/);
  assert.match(island, /pointerEvents: pointer/);
  assert.match(island, /visibility: style \? `\$\{style\.display\}:\$\{style\.visibility\}`/);
  assert.match(island, /captureTarget: captureName\(event\)/);
  assert.match(island, /if \(NOOK_DEV_BUILD\)[\s\S]*pointer-dom-detail/);
});

test("Dev traces distinguish handler execution and state actions for Settings, Audio and Media", () => {
  assert.match(dom, /type === "click" && __NOOK_DEV_BUILD__/);
  assert.match(dom, /start\.click\.\$\{label\}/);
  assert.match(dom, /end\.click\.\$\{label\}/);
  for (const action of ["settings-entry", "audio-toggle", "home-tab", "shelf-tab"]) assert.ok(views.includes(`"${action}"`));
  for (const action of ["media-previous", "media-toggle", "media-next", "media-volume"]) assert.ok(media.includes(`"${action}"`));
  assert.match(island, /source: "audio-toggle"/);
  assert.match(media, /source: `media-\$\{action\}-result`/);
});

test("pointer diagnostics do not serialize UI text, media metadata or file paths", () => {
  const detail = island.match(/shelfTrace\("pointer-dom-detail", \{([\s\S]*?)\n        \}\)/)?.[1] ?? "";
  assert.match(detail, /actualTarget: describe\(deliveredTarget\)/);
  assert.match(detail, /hitTestTarget: describe\(pointTarget\)/);
  assert.doesNotMatch(detail, /textContent|innerText|title|src|path|trackKey/);
});

test("header tabs and action buttons are sibling flex regions without quota metrics", () => {
  assert.match(views, /h\("div", \{ class: "tabs" \}[\s\S]*h\("div", \{ class: "header-actions" \}/);
  assert.doesNotMatch(views, /buildHeaderStats|stats\.el/);
  assert.match(css, /\.header-actions\s*\{[^}]*margin-left:\s*auto;[^}]*display:\s*flex;/s);
});

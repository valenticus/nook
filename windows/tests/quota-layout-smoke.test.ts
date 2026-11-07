import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("expanded header does not duplicate quota stats already shown in Home", () => {
  const views = readFileSync(new URL("../src/views/views.ts", import.meta.url), "utf8");
  assert.doesNotMatch(views, /buildHeaderStats|stats\.el|stats\.draw/);
});

test("Home keeps one shared usage card and removes the source switch without changing Shelf", () => {
  const home = readFileSync(new URL("../src/views/home.ts", import.meta.url), "utf8");
  const usage = readFileSync(new URL("../src/views/home-usage.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  const shelf = readFileSync(new URL("../src/views/shelf.ts", import.meta.url), "utf8");
  assert.ok(home.includes("buildHomeUsage()"));
  assert.ok(usage.includes('createSection("claude", message("Claude usage")'));
  assert.ok(usage.includes('createSection("codex", message("Codex usage")'));
  assert.ok(!usage.includes("res-source"));
  assert.ok(css.includes(".home-res.has-codex .res-content"));
  assert.ok(css.includes("overflow-y: auto"));
  assert.ok(shelf.includes("view-transition-name"));
  assert.ok(!shelf.includes("Codex usage"));
});

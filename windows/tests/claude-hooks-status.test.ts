import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { State } from "../src/core/state.ts";
import { currentLanguage, setLanguage } from "../src/core/i18n.ts";
import { buildClaudeHooksStatus } from "../src/views/claude-hooks-status.ts";

class FakeElement {
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  private ownText = "";
  title = "";
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  set className(value: string) { this.setAttribute("class", value); }
  get className() { return this.getAttribute("class") ?? ""; }
  set textContent(value: string) { this.ownText = value; this.children.length = 0; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeElement[]) { this.children.splice(0, this.children.length, ...nodes); }
  removeChild(node: FakeElement) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); return node; }
}

function installFakeDocument() {
  (globalThis as any).document = { documentElement: null, createElement: (tag: string) => new FakeElement(tag), visibilityState: "visible" };
}

test("Home status has independent neutral rows until configuration is verified", () => {
  installFakeDocument();
  const old = { dev: State.nookDev, standalone: State.nookStandalone, language: currentLanguage() };
  try {
    setLanguage("en");
    State.nookDev = true;
    State.nookStandalone = false;
    const status = buildClaudeHooksStatus(true);
    assert.equal(status.el.children.length, 2);
    assert.match(status.el.textContent, /Claude Code.*Not connected/);
    assert.match(status.el.textContent, /Codex.*Not connected/);
    assert.doesNotMatch(status.el.textContent, /test integration|unverified/);
    assert.ok(status.el.children.every((row) => row.dataset.status === "not-connected"));
    assert.ok(status.el.children.every((row) => row.children[0]?.getAttribute("style")?.includes("#8E939C")));
    status.dispose();
  } finally {
    State.nookDev = old.dev;
    State.nookStandalone = old.standalone;
    setLanguage(old.language);
  }
});

test("Home and Island settings use the same scanner-backed status component", () => {
  const home = readFileSync(new URL("../src/views/home.ts", import.meta.url), "utf8");
  const islandSettings = readFileSync(new URL("../src/views/views.ts", import.meta.url), "utf8");
  assert.match(home, /buildClaudeHooksStatus\(true\)/);
  assert.match(islandSettings, /buildClaudeHooksStatus\(\)/);
  assert.match(home, /integrations\.sync\(\)/);
});

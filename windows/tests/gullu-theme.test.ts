// Regression: the plush chosen in Settings → Look must be the one Gullu wears —
// the island's, Home's, every mini already made, and the settings preview — and
// must replace a pill's tint (Claude's #F5F6F8, Codex's colour…), not sit under it.
// While nobody has chosen (the default plush), the pills' own colours stay.
//
// Run from windows/:
//   node --import ./tests/gullu-color-register.mjs --test tests/gullu-theme.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

// ── The little of a browser the mini bots ask for ─────────────────────────────

let paints = 0;
let hidden = false;
const fakeCanvas = () => {
  const canvas: Record<string, unknown> = {
    width: 0, height: 0, style: {}, isConnected: true,
    getContext: () => { paints++; return null; },
    // "On show": in no view, or in the one that is on.
    closest: () => (hidden ? { classList: { contains: () => false } } : null),
  };
  return canvas;
};
const fakeSlot = () => {
  const kids: unknown[] = [];
  const canvasOf = () => kids[0];
  return { className: "", style: {}, append: (c: unknown) => kids.push(c), querySelector: canvasOf };
};
Object.assign(globalThis, {
  document: { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : fakeSlot()) },
  window: { devicePixelRatio: 1 },
});

const { BOT_THEMES, BotEngine, DEFAULT_BOT_THEME, hexToRGB, skinFor } = await import("../src/bot/engine.ts");
const { createFreeBot, createMiniBot, createStateBot, miniBotsLively, refreshMiniBotThemes, tickMiniBots } =
  await import("../src/bot/minibots.ts");
const { CLAUDE_ID, State } = await import("../src/core/state.ts");

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const themeRGB = (name: keyof typeof BOT_THEMES) => ({ a: hexToRGB(BOT_THEMES[name].a), b: hexToRGB(BOT_THEMES[name].b) });
const CLAUDE_TINT = hexToRGB("#F5F6F8");
const CODEX_TINT = hexToRGB("#FF9B5C");
const CUSTOM = ["peach", "mint", "lilac", "sky", "cocoa"] as const;

beforeEach(() => {
  BotEngine.defaultTheme = DEFAULT_BOT_THEME;
  hidden = false;
});

// ── skinFor: who wins ─────────────────────────────────────────────────────────

test("Claude: the user's plush replaces the pill's near-white tint", () => {
  for (const theme of CUSTOM) {
    assert.deepEqual(skinFor(theme, CLAUDE_TINT, true), themeRGB(theme), theme);
  }
});

test("Codex: the user's plush replaces the pill's colour too", () => {
  for (const theme of CUSTOM) {
    assert.deepEqual(skinFor(theme, CODEX_TINT, true), themeRGB(theme), theme);
  }
});

test("default plush: nobody has chosen, so the pills keep the colours they were made with", () => {
  assert.equal(skinFor(DEFAULT_BOT_THEME, CLAUDE_TINT, true).b, CLAUDE_TINT);
  assert.equal(skinFor(DEFAULT_BOT_THEME, CODEX_TINT, true).b, CODEX_TINT);
  assert.deepEqual(skinFor(DEFAULT_BOT_THEME, null, true), themeRGB("cream"));
});

test("custom theme: no tint at all gives the theme, and the six themes are six different plushes", () => {
  const skins = Object.keys(BOT_THEMES).map((t) => JSON.stringify(skinFor(t as keyof typeof BOT_THEMES, null, true)));
  assert.equal(new Set(skins).size, 6);
});

test("a bot that is not a pill's (the greeting, a CI job) keeps its colour whatever the plush", () => {
  assert.equal(skinFor("mint", CODEX_TINT, false).b, CODEX_TINT);
});

test("the premise: Claude's tint is the near-white that made Gullu white", () => {
  assert.ok(CLAUDE_TINT.every((v) => v > 0.93));
});

// ── The theme follows the setting, for bots made before and after ─────────────

test("a bot made before the change wears the new plush; one given its own keeps it", () => {
  const before = new BotEngine();
  const pinned = new BotEngine();
  pinned.theme = "cocoa";
  assert.equal(before.theme, "cream");
  assert.equal(BotEngine.setDefaultTheme("mint"), true);
  assert.equal(before.theme, "mint");
  assert.equal(new BotEngine().theme, "mint");
  assert.equal(pinned.theme, "cocoa");
  assert.equal(BotEngine.setDefaultTheme("mint"), false, "no change, nothing to redraw");
});

// ── A session at work, and the plush changed under it ─────────────────────────

test("the plush changes during an active Claude session and a Codex one: every pill's bot follows", () => {
  State.loadIntegrationTasks();
  State.upsertExternalAgent("agent_codex", "Codex", "#FF9B5C");
  State.updateTask(CLAUDE_ID, "working");
  State.updateTask("agent_codex", "working");
  const claude = State.tasks.find((t) => t.id === CLAUDE_ID)!;
  const codex = State.tasks.find((t) => t.id === "agent_codex")!;

  const island = new BotEngine();
  island.tintYieldsToTheme = true;
  island.bodyColor = hexToRGB(claude.color);
  const home = createStateBot("working", 22).engine;
  home.bodyColor = hexToRGB(codex.color);
  const pill = createMiniBot(codex, 22);
  assert.ok(pill);

  const worn = (e: InstanceType<typeof BotEngine>) => skinFor(e.theme, e.bodyColor, e.tintYieldsToTheme);
  // Before: the pills' colours, as shipped.
  assert.equal(worn(island).b, island.bodyColor);
  assert.equal(worn(home).b, home.bodyColor);

  BotEngine.setDefaultTheme("lilac");
  refreshMiniBotThemes();
  // After: the one plush the user chose, everywhere — and the sessions are as they were.
  assert.deepEqual(worn(island), themeRGB("lilac"));
  assert.deepEqual(worn(home), themeRGB("lilac"));
  assert.equal(claude.state, "working");
  assert.equal(codex.state, "working");
  assert.equal(home.state, "working");

  // And back to the default: the pills' colours return.
  BotEngine.setDefaultTheme("cream");
  assert.equal(worn(island).b, island.bodyColor);
  assert.equal(worn(home).b, home.bodyColor);
});

test("only the bots that stand for a pill give way to the plush", () => {
  assert.equal(createStateBot("idle", 22).engine.tintYieldsToTheme, true);
  assert.equal(createFreeBot("#38CFE0", "idle", 22).engine.tintYieldsToTheme, false);
});

// ── Wiring ────────────────────────────────────────────────────────────────────

test("the island sets the default plush, redraws, and refreshes the minis — without pinning its own bot", () => {
  const island = read("../src/island/island.ts");
  const block = island.match(/const theme = State\.settings\.botTheme;([\s\S]*?)\n    \/\/ Settings → Appearance/)?.[1] ?? "";
  assert.match(block, /this\.engine\.tintYieldsToTheme = true/);
  assert.match(block, /BotEngine\.setDefaultTheme\(theme as BotTheme\)/);
  assert.match(block, /this\.botStale = true/);
  assert.match(block, /refreshMiniBotThemes\(\)/);
  assert.doesNotMatch(block, /this\.engine\.theme\s*=/);
});

test("the settings preview sets the default plush, so bots mounted after it wear it too", () => {
  const bots = read("../src/settings/bots.ts");
  const fn = bots.match(/export function wearBotTheme[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(fn, /BotEngine\.setDefaultTheme\(name\)/);
  const main = read("../src/settings/main.ts");
  assert.ok(main.indexOf("applyAppearance();") < main.indexOf("mountBot(20)"), "the premise: colours go on before the bots are mounted");
});

test("every colour Settings can save is one the engine has, and the other way round", () => {
  const saved = read("../src-tauri/src/settings.rs").match(/pub const BOT_THEMES: &\[&str\] = &\[([^\]]*)\]/)?.[1] ?? "";
  const rust = [...saved.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...rust].sort(), Object.keys(BOT_THEMES).sort());
  assert.equal(rust[0], DEFAULT_BOT_THEME, "the first is the default in both");
});

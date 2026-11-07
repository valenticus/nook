import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXPANDED_W, PANEL_W, Room, SHELF_CARD_GAP, SHELF_CARD_W, SHELF_MIN_W, SHELF_SIDE_PAD,
  shelfSize, shelfWidth, shelfWidthChange, islandSize,
} from "../src/core/layout.ts";

const original = { ...Room };
const widthFor = (count: number) => Math.max(SHELF_MIN_W,
  count * SHELF_CARD_W + Math.max(0, count - 1) * SHELF_CARD_GAP + 2 * SHELF_SIDE_PAD);

test("Shelf width follows visible card geometry, then caps to available room", () => {
  Room.w = 1200;
  for (const count of [1, 2, 3, 4, 5]) {
    assert.equal(shelfWidth(count), widthFor(count), `${count} cards`);
  }
  assert.deepEqual([1, 2, 3, 4, 5].map(widthFor), [220, 430, 640, 850, 1060]);
  assert.equal(shelfWidth(6), 1184);

  Room.w = 500;
  assert.equal(shelfWidth(2), 430);
  assert.equal(shelfWidth(3), 484);
  assert.equal(shelfWidth(6), 484);

  Room.w = 300;
  assert.equal(shelfWidth(3), 284);
});

test("Shelf geometry is shared by shelfSize and islandSize while Home is unchanged", () => {
  Room.w = 1200;
  assert.equal(shelfSize("top", 1).w, 220);
  assert.equal(shelfSize("bottom", 4).w, 850);
  assert.equal(islandSize("expanded", "shelf", false, null, false, undefined, null, 2).w, 430);
  assert.equal(shelfSize("left", 1).w, shelfSize("left", 6).w);
  assert.equal(shelfSize("right", 1).h, shelfSize("right", 6).h);
  assert.equal(islandSize("expanded", "overview").w, EXPANDED_W);
  assert.equal(EXPANDED_W, PANEL_W - 80);
});

test("an open Shelf forwards each changed visible set to the spring without tab navigation", () => {
  Room.w = 1400;
  let open = true;
  let visible = 3;
  let lastTarget: number | null = shelfWidth(visible);
  const springTargets: number[] = [];
  const syncSettings = (nextVisible: number) => {
    visible = nextVisible;
    const nextTarget = shelfWidth(visible);
    const change = shelfWidthChange(lastTarget, nextTarget);
    if (open && change) springTargets.push(nextTarget);
    lastTarget = nextTarget;
  };

  syncSettings(2);
  assert.equal(visible, 2);
  assert.equal(springTargets.at(-1), 430); // 3 → 2 while still open
  syncSettings(1);
  assert.equal(springTargets.at(-1), 220); // 2 → 1
  syncSettings(4);
  assert.equal(springTargets.at(-1), 850); // 1 → 4

  const beforeReorder = springTargets.length;
  syncSettings(4); // reorder keeps the same visible count and width
  assert.equal(springTargets.length, beforeReorder);

  // Rapid setting updates each replace the target; the spring's current value is not used as the comparison cache.
  syncSettings(3);
  syncSettings(5);
  assert.deepEqual(springTargets.slice(-2), [640, 1060]);
  assert.equal(lastTarget, shelfWidth(5));
});

test("Shelf integration keeps existing scroll, reorder, and morph paths", () => {
  const shelf = readFileSync(fileURLToPath(new URL("../src/views/shelf.ts", import.meta.url)), "utf8");
  const css = readFileSync(fileURLToPath(new URL("../src/style.css", import.meta.url)), "utf8");
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  assert.match(shelf, /shelfWidgets\(\)\.length/);
  assert.match(shelf, /shelfWidthChange\(geometryWidth, widthAfter\)/);
  assert.match(shelf, /if \(widthChange\) actions\.resized/);
  assert.match(shelf, /const rowChanged = drawRow\(shown\)/);
  assert.doesNotMatch(shelf, /onShelfChange\(\(\) => \{[\s\S]*?drawRow\(shelfWidgets\(\)\)/);
  assert.match(shelf, /onReorder/);
  assert.match(shelf, /actions\.morph\(apply, morphNames/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /\.shelf-row\.more-right/);
  assert.match(css, /\.shelf-row\.more-left/);
  assert.match(css, /flex:\s*0 0 var\(--shelf-card-w\)/);
  assert.match(island, /private pageW\(\): number\s*\{\s*return this\.shelf\.width/);
  assert.match(island, /this\.shelf\.visibleCards/);
  assert.match(island, /private targetSize\(\)[\s\S]*?islandSize\(State\.mode, State\.view/);
  assert.match(island, /compactSize/);
});

test("temporary resize trace is Dev-gated and covers the settings-to-spring path", () => {
  const trace = readFileSync(fileURLToPath(new URL("../src/core/shelf-trace.ts", import.meta.url)), "utf8");
  const main = readFileSync(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  const shelf = readFileSync(fileURLToPath(new URL("../src/views/shelf.ts", import.meta.url)), "utf8");
  assert.match(trace, /available = __NOOK_DEV_BUILD__ && on/);
  assert.match(trace, /const LIMIT = 500/);
  assert.match(trace, /const EVENTS = new Set/);
  for (const event of ["settings-event", "settings-applied"]) assert.ok(main.includes(event));
  for (const event of ["state-dirty", "sync-dom", "actions-resized", "target-size", "animate-geometry", "width-settled"])
    assert.ok(island.includes(event));
  for (const event of ["draw-row", "on-shelf-change", 'shelfTrace("sync"']) assert.ok(shelf.includes(event));
});

test("Shelf width tests leave shared layout state unchanged", () => {
  Object.assign(Room, original);
});

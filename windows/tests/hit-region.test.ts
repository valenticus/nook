import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { islandOrigin, type Dock } from "../src/core/layout.ts";
import {
  describeMismatch,
  effectiveEar,
  geometryMismatch,
  interactiveRegion,
  layoutBox,
  measuredBody,
  nearBox,
  viewportIsFullWindow,
  type Box,
  type Viewport,
} from "../src/core/hit-region.ts";

// The window in the field report: 1136 × 654 logical, on a display 1920 wide.
const FULL: Viewport = { w: 1136, h: 654 };
// Rust's native margin around the pushed rectangle (island.rs HIT_MARGIN).
const MARGIN = 14;

const vertical = (dock: Dock) => dock === "left" || dock === "right";

/**
 * Where the page puts the island, as `Island.snapped` does for a window of the given size: the same arithmetic
 * the CSS does (`left: 50%` of the viewport and a whole-pixel translate; `bottom: 0`; `right: 0`).
 */
function placed(dock: Dock, window: Viewport, w: number, h: number, dpr = 1): Box {
  const span = vertical(dock) ? window.h : window.w;
  const along = vertical(dock) ? h : w;
  const half = Math.round((along / 2) * dpr);
  const centre = (span * dpr) / 2;
  const shift = (Math.round(centre) - centre - half) / dpr;
  const at = islandOrigin(dock, window.w, window.h, span / 2 + shift, w, h, dpr);
  return { x: at.x, y: at.y, w, h };
}

test("a Room.w that differs from the viewport no longer moves the pointer's rectangle", () => {
  // Placed in the window the page is really drawn in, as the CSS does…
  const body = placed("top", FULL, 264, 38);
  assert.deepEqual(body, { x: 436, y: 0, w: 264, h: 38 });
  const region = interactiveRegion(body, 11, false);
  // …not in a Room.w of 720, the page's default: that put it 208 px to the left.
  const stale = placed("top", { w: 720, h: 320 }, 264, 38);
  assert.equal(body.x - stale.x, 208);

  const onTheRight = 568 + 100; // 100 px right of the window's middle: on the drawn island
  assert.equal(nearBox(stale, onTheRight, 20, MARGIN), false, "the old rectangle left this dead");
  assert.equal(nearBox(region, onTheRight, 20, MARGIN), true);
  // And the stale rectangle took the mouse over a patch where nothing is drawn.
  assert.equal(nearBox(stale, 300, 20, MARGIN), true);
  assert.equal(nearBox(region, 300, 20, MARGIN), false);
});

test("field report, in screen pixels: tabs left of the island were blocked, the island's right half was dead", () => {
  // The window sits at x=392 on a 1920 display; a pointer position in screen pixels is window-logical + 392.
  const WINDOW_LEFT = 392;
  const atScreen = (region: Box, screenX: number, screenY = 19) => nearBox(region, screenX - WINDOW_LEFT, screenY, MARGIN);

  // What the page handed Rust with Room.w stuck at 720 (centre at window x 360, screen x 752)…
  const staleBody = placed("top", { w: 720, h: 320 }, 264, 38);
  const stale = interactiveRegion(staleBody, effectiveEar(11, staleBody, false, FULL), false);
  // …and now: the island placed in the real window (centre at window x 568, screen x 960).
  const body = placed("top", FULL, 264, 38);
  const region = interactiveRegion(body, effectiveEar(11, body, false, FULL), false);
  const drawnLeft = WINDOW_LEFT + body.x;           // 828
  const drawnRight = WINDOW_LEFT + body.x + body.w; // 1092

  // LEFT, invisible interception: browser tabs to the left of the island, nothing drawn there.
  for (const screenX of [600, 650, 700, 760, 800]) {
    assert.ok(screenX < drawnLeft - 11 - MARGIN, `x=${screenX} is clear of the island, its ear and the margin`);
    assert.equal(atScreen(stale, screenX), true, `before: the tab at ${screenX} was swallowed`);
    assert.equal(atScreen(region, screenX), false, `after: the tab at ${screenX} is clicked through`);
  }
  // RIGHT, dead zone: the island's right half (and its ear) did not answer.
  for (const screenX of [910, 960, 1040, drawnRight - 1, drawnRight + 10]) {
    assert.equal(atScreen(stale, screenX), false, `before: ${screenX} was dead`);
    assert.equal(atScreen(region, screenX), true, `after: ${screenX} answers`);
  }
  // The whole visible surface, edge to edge, answers — with no margin counted at all.
  for (let screenX = drawnLeft - 11; screenX <= drawnRight + 11; screenX += 1) {
    assert.equal(nearBox(region, screenX - WINDOW_LEFT, 19, 0), true, `x=${screenX}`);
  }
  // The patch that is click-through again is exactly what is not island, ear or margin: nothing more is taken.
  assert.equal(atScreen(region, drawnLeft - 11 - MARGIN - 1), false);
  assert.equal(atScreen(region, drawnRight + 11 + MARGIN + 1), false);
  assert.equal(atScreen(region, drawnLeft - 11 - MARGIN), true);
  assert.equal(atScreen(region, drawnRight + 11 + MARGIN), true);
  // Left and right are symmetric about the drawn island: the shift is gone, not moved.
  assert.equal(drawnLeft - (WINDOW_LEFT + region.x), WINDOW_LEFT + region.x + region.w - drawnRight);
});

test("the placement follows the real window in all four docks, whatever Room says", () => {
  const docks: Dock[] = ["top", "bottom", "left", "right"];
  for (const dock of docks) {
    const real = placed(dock, FULL, 264, 38);
    const wrong = placed(dock, { w: 720, h: 320 }, 264, 38);
    // Along the edge the island is centred in the real window; across it, it is flush with the edge.
    if (vertical(dock)) {
      assert.equal(real.y + real.h / 2, FULL.h / 2, dock);
      assert.equal(real.x, dock === "left" ? 0 : FULL.w - 264, dock);
    } else {
      assert.equal(real.x + real.w / 2, FULL.w / 2, dock);
      assert.equal(real.y, dock === "top" ? 0 : FULL.h - 38, dock);
    }
    assert.notDeepEqual(real, wrong, `${dock}: the stale Room put it elsewhere`);
  }
});

test("compact island: body and effective ears are the region; Rust's margin is added once, by Rust", () => {
  const body = placed("top", FULL, 264, 38);
  const ear = effectiveEar(11, body, false, FULL);
  assert.equal(ear, 11);
  const region = interactiveRegion(body, ear, false);
  assert.deepEqual(region, { x: 436 - 11, y: 0, w: 264 + 22, h: 38 });
  // The region itself holds no margin: its reach is exactly the drawn ear…
  assert.equal(region.x, body.x - ear);
  assert.equal(region.w, body.w + 2 * ear);
  // …and Rust's 14 px come on top of it, once.
  assert.equal(nearBox(region, region.x - MARGIN, 19, MARGIN), true);
  assert.equal(nearBox(region, region.x - MARGIN - 1, 19, MARGIN), false);
  // Every pixel of the body and of the ears is in the region with no margin at all.
  for (const x of [body.x - ear, body.x, 568, body.x + body.w, body.x + body.w + ear]) {
    assert.equal(nearBox(region, x, 19, 0), true, `x=${x}`);
  }
});

test("expanded island: a wide body and the larger ears", () => {
  const body = placed("top", FULL, 640, 280);
  assert.deepEqual(body, { x: 248, y: 0, w: 640, h: 280 });
  const ear = effectiveEar(16, body, false, FULL);
  assert.equal(ear, 16);
  const region = interactiveRegion(body, ear, false);
  assert.deepEqual(region, { x: 232, y: 0, w: 672, h: 280 });
  // The ear's outer tip is hit by the region itself; the margin alone (14) fell 2 px short of it.
  assert.equal(nearBox(region, 232.5, 4, 0), true);
  assert.equal(nearBox(body, 232.5, 4, MARGIN), false);
  // The empty background of the open island is interactive: any point of the body.
  assert.equal(nearBox(region, 568, 140, 0), true);
  assert.equal(nearBox(region, 300, 270, 0), true);
});

test("click-through outside the visible island is kept", () => {
  const body = placed("top", FULL, 264, 38);
  const region = interactiveRegion(body, effectiveEar(11, body, false, FULL), false);
  assert.equal(nearBox(region, 568, 38 + MARGIN + 1, MARGIN), false);
  assert.equal(nearBox(region, 436 - 11 - MARGIN - 1, 19, MARGIN), false);
  assert.equal(nearBox(region, 700 + 11 + MARGIN + 1, 19, MARGIN), false);
  assert.equal(nearBox(region, 100, 400, MARGIN), false);
  // Nothing drawn: nothing takes the mouse.
  assert.equal(nearBox({ x: 0, y: 0, w: 0, h: 0 }, 5, 5, MARGIN), false);
});

test("the ear is cut to the window at the screen's edge, the same for the outline and the region, in every dock", () => {
  // Top and bottom: the room is left and right of the island.
  for (const dock of ["top", "bottom"] as const) {
    const y = dock === "top" ? 0 : FULL.h - 38;
    const left = { x: 4, y, w: 100, h: 38 };
    assert.equal(effectiveEar(11, left, false, FULL), 4, `${dock} left`);
    const right = { x: FULL.w - 100 - 6, y, w: 100, h: 38 };
    assert.equal(effectiveEar(11, right, false, FULL), 6, `${dock} right`);
    // One value serves both ears, as the outline draws them alike: the tighter side wins…
    assert.equal(interactiveRegion(left, effectiveEar(11, left, false, FULL), false).x, 0);
    // …and the region never leaves the window because of an ear.
    for (const body of [left, right]) {
      const r = interactiveRegion(body, effectiveEar(11, body, false, FULL), false);
      assert.ok(r.x >= 0 && r.x + r.w <= FULL.w, `${dock} inside the window`);
    }
  }
  // Left and right: the room is above and below.
  for (const dock of ["left", "right"] as const) {
    const x = dock === "left" ? 0 : FULL.w - 38;
    const top = { x, y: 3, w: 38, h: 100 };
    assert.equal(effectiveEar(11, top, true, FULL), 3, `${dock} top`);
    const bottom = { x, y: FULL.h - 100 - 5, w: 38, h: 100 };
    assert.equal(effectiveEar(11, bottom, true, FULL), 5, `${dock} bottom`);
    for (const body of [top, bottom]) {
      const r = interactiveRegion(body, effectiveEar(11, body, true, FULL), true);
      assert.ok(r.y >= 0 && r.y + r.h <= FULL.h, `${dock} inside the window`);
      assert.equal(r.x, body.x);
      assert.equal(r.w, body.w);
    }
  }
  // Plenty of room, no clipping; a body past the window, no ear; a bad ear, no ear.
  assert.equal(effectiveEar(16, { x: 300, y: 0, w: 536, h: 40 }, false, FULL), 16);
  assert.equal(effectiveEar(16, { x: -5, y: 0, w: 1200, h: 40 }, false, FULL), 0);
  assert.equal(effectiveEar(Number.NaN, { x: 300, y: 0, w: 100, h: 40 }, false, FULL), 0);
  assert.equal(effectiveEar(-3, { x: 300, y: 0, w: 100, h: 40 }, false, FULL), 0);
});

test("the ear of an island centred in the window is the one the outline always had", () => {
  // Before: min(ear, max(0, x)) with x the island's left. Centred, both sides have the same room.
  for (const [w, ear] of [[264, 11], [640, 16], [184, 11], [1120, 16]] as const) {
    const body = placed("top", FULL, w, 38);
    assert.equal(effectiveEar(ear, body, false, FULL), Math.min(ear, Math.max(0, body.x)));
  }
});

test("Linux keeps the body as its rectangle: no ear in the region, the margin as ever", () => {
  // Where the OS makes the input region from the rectangle (Wayland), the page hands over the body alone (ear 0).
  for (const dock of ["top", "bottom", "left", "right"] as const) {
    const body = placed(dock, FULL, 264, 38);
    assert.deepEqual(interactiveRegion(body, 0, vertical(dock)), body, dock);
  }
  assert.deepEqual(interactiveRegion({ x: 10, y: 0, w: 50, h: 20 }, Number.NaN, false), { x: 10, y: 0, w: 50, h: 20 });
});

test("a retracted island is a line along the edge and still takes the pointer", () => {
  const line = measuredBody({ left: 476, top: 0, width: 184, height: 0 }, 1, FULL);
  assert.deepEqual(line, { x: 476, y: 0, w: 184, h: 0 });
  assert.equal(nearBox(line!, 568, 5, MARGIN), true);
  assert.equal(measuredBody({ left: 0, top: 0, width: 0, height: 0 }, 1, FULL), null);
  assert.equal(measuredBody({ left: Number.NaN, top: 0, width: 10, height: 10 }, 1, FULL), null);
});

test("resize and wake: the wake strip says nothing of the island; the grown window does", () => {
  const strip = { w: 240, h: 6 };
  assert.equal(viewportIsFullWindow(strip), false);
  assert.equal(viewportIsFullWindow({ w: 6, h: 240 }), false);
  assert.equal(measuredBody({ left: 0, top: 0, width: 184, height: 38 }, 1, strip), null);
  assert.equal(geometryMismatch({ w: 1136, h: 654 }, strip, null, placed("top", FULL, 184, 38)), null, "the strip is meant to differ");

  // The window grows: the same island is now placed in the grown window, centred in it.
  assert.equal(viewportIsFullWindow(FULL), true);
  assert.deepEqual(placed("top", FULL, 184, 38), { x: 476, y: 0, w: 184, h: 38 });
  // A window resized to another width moves the island with it, and so the region.
  const wider = { w: 1500, h: 654 };
  const moved = interactiveRegion(placed("top", wider, 184, 38), effectiveEar(11, placed("top", wider, 184, 38), false, wider), false);
  assert.equal(moved.x, (1500 - 184) / 2 - 11);
  // The normal panel is the smallest full window.
  assert.equal(viewportIsFullWindow({ w: 720, h: 320 }), true);
  assert.equal(viewportIsFullWindow({ w: 719, h: 300 }), false);
});

test("zoom and pixel snapping: client pixels become layout units once", () => {
  assert.deepEqual(layoutBox({ left: 200, top: 10, width: 100, height: 40 }, 1), { x: 200, y: 10, w: 100, h: 40 });
  assert.deepEqual(layoutBox({ left: 200, top: 10, width: 100, height: 40 }, 2), { x: 100, y: 5, w: 50, h: 20 });
  assert.deepEqual(layoutBox({ left: 200, top: 10, width: 100, height: 40 }, 0), { x: 200, y: 10, w: 100, h: 40 });
  assert.deepEqual(layoutBox({ left: 200, top: 10, width: 100, height: 40 }, Number.NaN), { x: 200, y: 10, w: 100, h: 40 });
  assert.equal(measuredBody({ left: 435.6, top: 0, width: 264.8, height: 38 }, 1, FULL)!.x, 435.6);
  // At 125 % the placement snaps to device pixels: 264 CSS px is 330 device px, an even half of 165.
  const snapped = placed("top", FULL, 264, 38, 1.25);
  assert.equal((snapped.x * 1.25) % 1, 0, "left lands on a device pixel");
});

test("a mismatch is reported only when it is real, and in numbers only", () => {
  const body = placed("top", FULL, 264, 38);
  // The page's place agrees with the drawing (sub-pixel snapping included): nothing to say.
  assert.equal(geometryMismatch({ w: 1136, h: 654 }, FULL, { ...body, x: body.x + 0.4 }, body), null);
  assert.equal(geometryMismatch({ w: 1137, h: 655 }, FULL, body, body), null);
  // Room off by half the screen: news.
  const m = geometryMismatch({ w: 720, h: 320 }, FULL, body, body)!;
  assert.ok(m);
  assert.equal(m.roomDx, 720 - 1136);
  // The island drawn somewhere else than computed: news too.
  assert.ok(geometryMismatch({ w: 1136, h: 654 }, FULL, { ...body, x: body.x + 30 }, body));
  const line = describeMismatch(m, { w: 720, h: 320 }, FULL, interactiveRegion(body, 11, false));
  assert.match(line, /^geometry mismatch: viewport=1136x654 room=720x320 /);
  assert.doesNotMatch(line, /cursor|pointer|mouse|title/i);
});

// ── Wiring (the same style as island-pointer-routing.test.mjs) ───────────────

const [island, main, rustIsland] = await Promise.all([
  readFile(new URL("../src/island/island.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/island.rs", import.meta.url), "utf8"),
]);

/** The text of one method, from its signature to the next `private`/`setX` member. */
function method(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} exists`);
  const next = source.slice(start + signature.length).search(/\n  (?:private |async |get |set |[a-z][A-Za-z]*\()/);
  return source.slice(start, next < 0 ? undefined : start + signature.length + next);
}

test("the shape handed to Rust is the body and the ears the outline was drawn with", () => {
  const apply = method(island, "private applyGeometry() {");
  assert.match(apply, /const earDrawn = this\.earFor\(body, dpr\)/);
  assert.match(apply, /this\.shape\.draw\(\{ w, h: hh, ear: earDrawn,/);
  assert.match(apply, /interactiveRegion\(body, this\.hitEars \? earDrawn : 0, side\)/);
  assert.match(apply, /Bridge\.setIslandRect\(rect\.x, rect\.y, rect\.w, rect\.h\)/);
});

test("no frame reads a box back: the place comes from the cached viewport, the check from a timer", () => {
  for (const [name, body] of [
    ["applyGeometry", method(island, "private applyGeometry() {")],
    ["earFor", method(island, "private earFor(")],
    ["onCursor", method(island, "onCursor(x: number, y: number, gone = false) {")],
    ["islandRect", method(island, "private islandRect(): Box {")],
  ] as const) {
    assert.doesNotMatch(body, /getBoundingClientRect|innerWidth|innerHeight|readViewport/, `${name} does not read layout`);
  }
  const frameLoop = island.slice(island.indexOf("private frame = (nowMs: number) => {"), island.indexOf("private updateBotTargets()"));
  assert.doesNotMatch(frameLoop.replace(/this\.greetingCanvas\.getBoundingClientRect\(\)|this\.clipEl\.getBoundingClientRect\(\)/g, ""), /islandEl\.getBoundingClientRect/);
  // The one measurement is the check, run from a timer re-armed by each push.
  assert.match(method(island, "private verifyGeometry() {"), /this\.islandEl\.getBoundingClientRect\(\)/);
  assert.match(method(island, "private armVerify() {"), /window\.setTimeout\([\s\S]*600\)/);
  assert.match(method(island, "private applyGeometry() {"), /this\.armVerify\(\)/);
});

test("the viewport cache is refreshed by the resize event, first, and the shape is told again", () => {
  assert.match(island, /window\.addEventListener\("resize", \(\) => \{\s*\/\/[^\n]*\n\s*this\.vp = this\.readViewport\(\);\s*this\.forceRect = true;/);
  assert.match(island, /private redrawGrown\(\) \{[^}]*this\.forceRect = true;/);
  assert.match(island, /onShown\(\) \{\s*this\.forceRect = true;/);
  // The wake strip is the one window the island is not placed in by its viewport.
  assert.match(island, /viewportIsFullWindow\(this\.vp\) \? this\.vp\.w : Room\.w/);
});

test("Linux: ears reach Rust only where its poll owns click-through", () => {
  assert.match(island, /private hitEars = false;/);
  assert.match(main, /onAnswer: \(answer\) => island\.setHitEars\(answer\.cursorPoll === true\)/);
  assert.match(rustIsland, /let x0 = \(r\.x - HIT_MARGIN\)\.max\(0\.0\);/, "Linux still cuts its input region to the rectangle plus the margin");
  assert.match(rustIsland, /const HIT_MARGIN: f64 = 14\.0/);
});

test("the native 250 ms retry and margin are untouched", () => {
  assert.match(rustIsland, /fn request_due\(/);
  assert.match(rustIsland, /Duration::from_millis\(250\)/);
  assert.match(island, /const HIT_MARGIN = 14;/);
});

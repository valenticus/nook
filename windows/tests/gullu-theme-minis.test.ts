// Regression: a mini Gullu already made (Home's, a pill's) is drawn again in the
// new plush when the setting changes — once, and only while it is on show.
// Its own file: the minis share one registry per process.
//
//   node --import ./tests/gullu-color-register.mjs --test tests/gullu-theme-minis.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

let paints = 0;
let hidden = false;
const fakeCanvas = () => ({
  width: 0, height: 0, style: {}, isConnected: true,
  getContext: () => { paints++; return null; },
  // "On show": in no view, or in the one that is on.
  closest: () => (hidden ? { classList: { contains: () => false } } : null),
});
const fakeSlot = () => {
  const kids: unknown[] = [];
  return { className: "", style: {}, append: (c: unknown) => kids.push(c), querySelector: () => kids[0] };
};
Object.assign(globalThis, {
  document: { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : fakeSlot()) },
  window: { devicePixelRatio: 1 },
});

const { createStateBot, miniBotsLively, refreshMiniBotThemes, tickMiniBots } = await import("../src/bot/minibots.ts");

/** Time runs on: the settling window a new mini is drawn for has lapsed. */
const realNow = performance.now.bind(performance);
let skew = 0;
(performance as { now: () => number }).now = () => realNow() + skew;
const later = (ms: number) => { skew += ms; };

test("a resting mini is repainted once after the change, and then costs nothing", () => {
  createStateBot("idle", 22);
  createStateBot("idle", 22);
  later(60_000);
  tickMiniBots(0.016);
  assert.equal(miniBotsLively(), false, "at rest");

  refreshMiniBotThemes();
  assert.equal(miniBotsLively(), true, "the frame loop is asked to run");
  const before = paints;
  tickMiniBots(0.016);
  assert.equal(paints, before + 2, "each of the two drawn once");
  assert.equal(miniBotsLively(), false);
  tickMiniBots(0.016);
  assert.equal(paints, before + 2, "and then left alone");
});

test("a mini in a view that is not on show is repainted when it is shown, not before", () => {
  later(60_000);
  tickMiniBots(0.016);
  hidden = true;
  refreshMiniBotThemes();
  const before = paints;
  assert.equal(miniBotsLively(), false, "nothing to run for what nobody sees");
  tickMiniBots(0.016);
  assert.equal(paints, before);

  hidden = false;
  assert.equal(miniBotsLively(), true, "its view is on show: the loop runs");
  tickMiniBots(0.016);
  assert.equal(paints, before + 2);
  assert.equal(miniBotsLively(), false);
});

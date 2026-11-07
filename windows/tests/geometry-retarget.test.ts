import assert from "node:assert/strict";
import test from "node:test";

import { Tracked } from "../src/core/anim.ts";

test("an unchanged spring target is not retargeted again", () => {
  const value = new Tracked(100);
  assert.equal(value.retarget(640, "spring"), true);
  value.step(1 / 60);
  const afterFirstFrame = value.value;
  assert.equal(value.retarget(640, "spring"), false);
  assert.equal(value.value, afterFirstFrame);
  assert.equal(value.animating, true);
});

test("an unchanged close-curve target keeps its original start time", () => {
  const value = new Tracked(640);
  assert.equal(value.retarget(220, "curve", 100), true);
  value.step(0, 180);
  const afterFirstProgress = value.value;
  assert.equal(value.retarget(220, "curve", 200), false);
  value.step(0, 260);

  const reference = new Tracked(640);
  reference.curveTowards(220, 340, 100);
  reference.step(0, 260);
  assert.ok(value.value < afterFirstProgress, "the in-flight curve continued advancing");
  assert.equal(value.value, reference.value, "duplicate geometry reports do not reset curveStart");
  assert.equal(value.animating, true);
});

test("a settled target is ignored while a genuinely changed target starts motion", () => {
  const value = new Tracked(220);
  assert.equal(value.retarget(220, "spring"), false);
  assert.equal(value.animating, false);
  assert.equal(value.retarget(640, "spring"), true);
  assert.equal(value.animating, true);
});

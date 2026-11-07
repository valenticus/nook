import test from "node:test";
import assert from "node:assert/strict";
import { EXPANDED_W, HOME_H, Room, homeContentSize, homeSize } from "../src/core/layout.ts";

test("Home's content frame matches its final expanded outer geometry", () => {
  const previous = { ...Room };
  try {
    Room.dock = "top";
    const outer = homeSize("top");
    const inner = homeContentSize("top");
    assert.equal(outer.w, EXPANDED_W);
    assert.equal(inner.width, outer.w - 20);
    assert.equal(inner.height, outer.h - 52);
    assert.deepEqual(inner, { width: 620, height: HOME_H - 52 });
  } finally {
    Object.assign(Room, previous);
  }
});

test("side-docked Home uses its clipped final frame without a reserved full-width box", () => {
  const previous = { ...Room };
  try {
    Room.w = 900;
    Room.h = 700;
    Room.dock = "left";
    const outer = homeSize("left");
    const inner = homeContentSize("left");
    assert.equal(inner.width, outer.w - 20);
    assert.equal(inner.height, outer.h - 52);
    assert.ok(inner.width < EXPANDED_W);
  } finally {
    Object.assign(Room, previous);
  }
});

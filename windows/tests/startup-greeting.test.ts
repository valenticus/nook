import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { reduceMotionEnabled } from "../src/core/motion.ts";
import { Greeting } from "../src/bot/greeting.ts";
import { Sound } from "../src/core/sound.ts";

test("startup greeting follows the saved Reduce Motion choice", () => {
  assert.equal(reduceMotionEnabled("on", false), true, "On skips the animation regardless of system preference");
  assert.equal(reduceMotionEnabled("off", true), false, "Off allows the animation regardless of system preference");
  assert.equal(reduceMotionEnabled("system", true), true);
  assert.equal(reduceMotionEnabled("system", false), false);
});

test("the real Island launch path gates greeting, exposes its canvas, and draws it from the frame loop", () => {
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  const launch = island.match(/  launch\(\) \{([\s\S]*?)\n  \}/)?.[1];
  const expand = island.match(/  expand\(view: IslandViewName\) \{([\s\S]*?)\n  \}/)?.[1];
  const syncDom = island.match(/  private syncDom\(\) \{([\s\S]*?)\n  \}/)?.[1];
  const frame = island.match(/  private frame = \(nowMs: number\) => \{([\s\S]*?)\n  \};/)?.[1];
  assert.ok(launch && expand && syncDom && frame);
  assert.match(launch, /reduceMotionEnabled\(choice, systemReduced\)/);
  assert.match(launch, /if \(skipGreeting\)[\s\S]*?this\.fsm\.forcePetit\(\)/);
  assert.match(launch, /this\.fsm\.launch\(\)/);
  assert.match(expand, /const beginAutoClose = NOOK_DEV_BUILD[\s\S]*?shouldArmHomeCollapse\(this\.fsm\.state, this\.wasInIsland\)[\s\S]*?: !this\.wasInIsland/);
  assert.doesNotMatch(expand, /if \(!this\.wasInIsland\) this\.beginHomeAutoClose\(\)/);
  assert.match(island, /case "greeting":[\s\S]*?this\.expand\("greeting"\);[\s\S]*?this\.greeting\.start\(\)/);
  assert.match(syncDom, /this\.greetingCanvas\.style\.display = greetingActive \? "block" : "none"/);
  assert.match(frame, /this\.greetingCanvas\.getContext\("2d"\)/);
  assert.match(frame, /this\.greeting\.draw\(gctx\)/);
});

test("greeting plays its existing sounds and completes on the original schedule", () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const originalPlay = Sound.play;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  let nextId = 0;
  const played: string[] = [];
  const audioLifecycle: string[] = [];
  let completed = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback: () => void, delay: number) {
        const id = ++nextId;
        pending.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id: number) { pending.delete(id); },
    },
  });
  Sound.play = ((name: string) => { played.push(name); return true; }) as typeof Sound.play;
  try {
    const greeting = new Greeting();
    greeting.onComplete = () => { completed++; };
    greeting.onSound = (name, queued) => audioLifecycle.push(`${name}:${queued}`);
    greeting.start();

    const near = (expected: number) => [...pending.values()].find((timer) => Math.abs(timer.delay - expected) < 1);
    const greet = near(680);
    const blip = near(1360);
    const finish = near(2350);
    assert.ok(greet && blip && finish, "both existing sounds and the 2.35 s completion are scheduled");
    greet.callback();
    blip.callback();
    finish.callback();
    assert.deepEqual(played, ["greet", "blip"]);
    assert.deepEqual(audioLifecycle, ["greet:true", "blip:true"]);
    assert.equal(completed, 1);
    assert.equal(greeting.done, true);
  } finally {
    Sound.play = originalPlay;
    if (previousWindow === undefined) delete (globalThis as typeof globalThis & { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("leaving during greeting cancels pending greeting sounds", () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const originalPlay = Sound.play;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  let nextId = 0;
  const played: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback: () => void, delay: number) {
        const id = ++nextId;
        pending.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id: number) { pending.delete(id); },
    },
  });
  Sound.play = ((name: string) => { played.push(name); return true; }) as typeof Sound.play;
  try {
    const greeting = new Greeting();
    greeting.start();
    greeting.interrupt();
    assert.equal(pending.size, 0);
    assert.deepEqual(played, []);
  } finally {
    Sound.play = originalPlay;
    if (previousWindow === undefined) delete (globalThis as typeof globalThis & { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

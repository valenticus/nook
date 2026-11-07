import assert from "node:assert/strict";
import test from "node:test";

import { IslandStateMachine, shouldArmHomeCollapse } from "../src/island/fsm.ts";

function fakeClock() {
  let next = 1;
  const pending = new Map<number, { run: () => void; delay: number }>();
  return {
    pending,
    timers: {
      set(run: () => void, delay: number) { const id = next++; pending.set(id, { run, delay }); return id; },
      clear(id: number) { pending.delete(id); },
    },
  };
}

function opened(clock: ReturnType<typeof fakeClock>) {
  const fsm = new IslandStateMachine(clock.timers);
  fsm.homeToPetitDelay = 15;
  fsm.state = "home";
  return fsm;
}

test("a pending request may visually collapse on the existing autoCloseInterval without being resolved", () => {
  const clock = fakeClock();
  const fsm = opened(clock);
  fsm.pinned = true;
  fsm.mouseLeft();
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0]?.delay, 15_000);
  [...clock.pending.values()][0]!.run();
  assert.equal(fsm.state, "petit");
});

test("hover cancels collapse and leaving again starts one fresh interval", () => {
  const clock = fakeClock();
  const fsm = opened(clock);
  fsm.mouseLeft();
  const first = [...clock.pending.values()][0]!;
  fsm.mouseEntered();
  assert.equal(clock.pending.size, 0);
  fsm.mouseLeft();
  assert.equal(clock.pending.size, 1);
  assert.notEqual([...clock.pending.values()][0]?.run, first.run);
});

test("keyboard or active input holds the same timer until interaction ends", () => {
  const clock = fakeClock();
  const fsm = opened(clock);
  let interacting = true;
  fsm.holdsHomeCollapse = () => interacting;
  fsm.mouseLeft();
  assert.equal(clock.pending.size, 0);
  interacting = false;
  fsm.mouseLeft();
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0]?.delay, 15_000);
});

test("changing autoCloseInterval restarts the pending FSM timer with the new setting", () => {
  const clock = fakeClock();
  const fsm = opened(clock);
  fsm.mouseLeft();
  fsm.homeToPetitDelay = 5;
  fsm.refresh(true);
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0]?.delay, 5_000);
});

test("launch runs the greeting state before folding to Compact", () => {
  const clock = fakeClock();
  const fsm = new IslandStateMachine(clock.timers);
  const transitions: string[] = [];
  fsm.onTransition = (_from, to) => transitions.push(to);
  fsm.greetAutoCollapseDelay = 100;

  fsm.launch();
  assert.equal(fsm.state, "greeting");
  assert.deepEqual(transitions, ["greeting"]);
  assert.equal(clock.pending.size, 0);

  fsm.greetComplete();
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0]?.delay, 100_000);
  [...clock.pending.values()][0]!.run();
  assert.equal(fsm.state, "petit");
  assert.deepEqual(transitions, ["greeting", "petit"]);
});

test("startup greeting is not sent through Home's pointer-leave collapse path", () => {
  const clock = fakeClock();
  const fsm = new IslandStateMachine(clock.timers);
  let homeCollapseStarted = false;
  fsm.onTransition = (_from, to) => {
    if (to === "greeting" && shouldArmHomeCollapse(fsm.state, false)) {
      homeCollapseStarted = true;
      fsm.mouseLeft();
    }
  };

  fsm.launch();
  assert.equal(fsm.state, "greeting");
  assert.equal(homeCollapseStarted, false);
  assert.equal(shouldArmHomeCollapse("home", false), true);
  assert.equal(shouldArmHomeCollapse("home", true), false);
  assert.equal(shouldArmHomeCollapse("greeting", false), false);
});

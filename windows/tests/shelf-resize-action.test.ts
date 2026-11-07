import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("active Shelf resize action always forwards its target to the geometry spring", () => {
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  const action = island.match(/resized: \(shrinking\) => \{([\s\S]*?)\n\s*\},\n\s*setLarge:/)?.[1];
  assert.ok(action, "ViewActions.resized callback exists");
  assert.match(action, /this\.animateGeometry\(shrinking, "view-resized"\)/);
  assert.doesNotMatch(action, /reducedMotion\(\)|jumpGeometry\(\)/);
  assert.ok(action.indexOf('shelfTrace("actions-resized"') < action.indexOf('this.animateGeometry(shrinking, "view-resized")'));

  const animate = island.match(/private animateGeometry\(shrinking: boolean, source = "unspecified"\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(animate, "existing animateGeometry spring path exists");
  assert.match(animate, /this\.targetSize\(\)/);
  assert.match(animate, /this\.width\.retarget\(w, motion\)/);
  assert.match(animate, /geometry-request-skipped/);
  assert.match(animate, /if \(__NOOK_DEV_BUILD__\)/);
  assert.match(animate, /this\.width\.curveTowards\(w\)/);
  assert.match(animate, /this\.width\.springTo\(w\)/);
  assert.match(animate, /this\.ensureRunning\(\)/);
  assert.match(island, /shelfTrace\("animate-geometry"/);
  assert.match(island, /shelfTrace\("width-settled"/);
});

test("closing still uses the same geometry animation and compact target is mode-derived", () => {
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  const mode = island.match(/private setMode\(mode: IslandMode\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(mode);
  assert.match(mode, /this\.animateGeometry\(modeOrder\(mode\) < modeOrder\(prev\), "mode-change"\)/);
  assert.match(island, /islandSize\(State\.mode, State\.view,[\s\S]*?this\.shelf\.visibleCards\)/);
});

test("Home and Shelf page transition starts on click and commits after the page spring", () => {
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  const views = readFileSync(fileURLToPath(new URL("../src/views/views.ts", import.meta.url)), "utf8");
  const pageTo = island.match(/private pageTo\(target: 0 \| 1\) \{([\s\S]*?)\n  \}/)?.[1];
  const settleTo = island.match(/private settleTo\(target: 0 \| 1, velocity: number\) \{([\s\S]*?)\n  \}/)?.[1];
  const syncDom = island.match(/private syncDom\(\) \{([\s\S]*?)\n  \}/)?.[1];
  const stepPaging = island.match(/private stepPaging\(dt: number\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(pageTo && settleTo && syncDom && stepPaging);
  assert.ok(pageTo.indexOf('shelfTrace("page-transition-start"') < pageTo.indexOf("this.settleTo(target, 0)"));
  assert.match(settleTo, /if \(NOOK_DEV_BUILD\) this\.header\.sync\(target === 1 \? "shelf" : State\.defaultView\(\)\)/);
  assert.match(syncDom, /NOOK_DEV_BUILD && this\.paging && this\.springing[\s\S]*this\.pageTarget === 1 \? "shelf" : State\.defaultView\(\)/);
  assert.match(views, /sync\(activeView = State\.view\)/);
  assert.match(stepPaging, /this\.commitPaging\(this\.pageTarget\)/);
  assert.match(island, /shelfTrace\("page-transition-commit"/);
  assert.match(island, /this\.applyPaging\(\)/);
});

test("greeting trace distinguishes start, first drawable canvas frame, interruption, and actual sound enqueue", () => {
  const island = readFileSync(fileURLToPath(new URL("../src/island/island.ts", import.meta.url)), "utf8");
  const greeting = readFileSync(fileURLToPath(new URL("../src/bot/greeting.ts", import.meta.url)), "utf8");
  assert.match(island, /startup-greeting-started/);
  assert.match(island, /greeting-first-frame/);
  assert.match(island, /greeting-canvas-revealed/);
  assert.match(island, /greeting-interrupted/);
  assert.match(greeting, /this\.onSound\?\.\(name, Sound\.play\(name\)\)/);
  assert.match(island, /greeting-audio/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LATE_RETRY_MS,
  RECOVERY_READS_MAX,
  RECOVERY_RETRIES,
  RoomKeeper,
  RoomSync,
  readWithRetry,
  windowSnapshot,
  type BootWindow,
  type RoomSink,
} from "../src/core/room-sync.ts";

/** A promise settled from outside, so a test decides in which order answers arrive. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const boot = (rev: number | undefined, width: number, height = 654, dock: "top" | "bottom" = "top", screen = 1920): BootWindow => ({
  panel: { width, height, dock },
  panelRev: rev,
  screen: { width: screen, height: 1080 },
});

/** The page's side: records what it was told, in order. */
function sink() {
  const calls: string[] = [];
  const room = { w: 720, h: 320, dock: "top", screen: 0 };
  const s: RoomSink = {
    setRoom: (w, h, d) => { calls.push(`room ${w}x${h} ${d}`); room.w = w; room.h = h; room.dock = d; },
    setScreenWidth: (w) => { calls.push(`screen ${w}`); room.screen = w; },
    adoptObserved: (w, h) => { calls.push(`adopt ${w}x${h}`); room.w = w; room.h = h; },
  };
  return { s, calls, room };
}

/** Rust, as the page sees it: a window size with a count, and reads that answer after a delay the test controls. */
function fakeRust() {
  let rev = 0;
  let size = { width: 720, height: 320 };
  return {
    change(width: number, height = 654) { rev += 1; size = { width, height }; },
    read(): BootWindow { return boot(rev, size.width, size.height); },
  };
}

test("an older answer that arrives after a newer one is dropped", () => {
  const sync = new RoomSync();
  const { s, room } = sink();
  assert.equal(sync.accept(windowSnapshot(boot(2, 1136)), s), "panel");
  assert.equal(sync.accept(windowSnapshot(boot(1, 720)), s), "stale");
  assert.equal(room.w, 1136, "the newer size stays");
  assert.equal(sync.revision, 2);
});

test("two reads resolving out of order end on the newer size (read 2 first, read 1 late)", async () => {
  const rust = fakeRust();
  const sync = new RoomSync();
  const { s, room, calls } = sink();
  const d1 = deferred<BootWindow>();
  const d2 = deferred<BootWindow>();

  // Read 1 is made while the window is 720 wide…
  const answer1 = rust.read();
  const first = d1.promise.then((b) => sync.accept(windowSnapshot(b), s));
  // …the window then changes, and read 2 (asked because of the event) sees 1136.
  rust.change(1136);
  const answer2 = rust.read();
  const second = d2.promise.then((b) => sync.accept(windowSnapshot(b), s));

  d2.resolve(answer2); // the newer answer arrives first
  await second;
  d1.resolve(answer1); // the older one limps in after it
  await first;

  assert.equal(room.w, 1136);
  assert.deepEqual(calls.filter((c) => c.startsWith("room")), ["room 1136x654 top"], "the old size was never applied after the new one");
});

test("two reads resolving in order end on the newer size too", async () => {
  const rust = fakeRust();
  const sync = new RoomSync();
  const { s, room } = sink();
  const a1 = rust.read();
  rust.change(1136);
  const a2 = rust.read();
  sync.accept(windowSnapshot(a1), s);
  assert.equal(room.w, 720);
  sync.accept(windowSnapshot(a2), s);
  assert.equal(room.w, 1136);
});

test("an event is not proof of a size: only a read, by its count, sets it", async () => {
  // The event that announces 1136 reaches the page; a read asked BEFORE it is still in flight with the old size.
  const rust = fakeRust();
  const sync = new RoomSync();
  const { s, room } = sink();
  const slow = deferred<BootWindow>();
  const inFlight = slow.promise.then((b) => sync.accept(windowSnapshot(b), s));
  const askedBeforeChange = rust.read();
  rust.change(1136);
  // The event triggers a fresh read, which answers at once…
  sync.accept(windowSnapshot(rust.read()), s);
  assert.equal(room.w, 1136);
  // …and the late answer to the earlier question can no longer undo it.
  slow.resolve(askedBeforeChange);
  assert.equal(await inFlight, "stale");
  assert.equal(room.w, 1136);
});

test("the same count refreshes the screen only; a lower count is dropped whole", () => {
  const sync = new RoomSync();
  const { s, calls, room } = sink();
  sync.accept(windowSnapshot(boot(3, 1136, 654, "top", 1920)), s);
  calls.length = 0;
  // Same size, another display width: the screen follows, the room is left alone.
  assert.equal(sync.accept(windowSnapshot(boot(3, 1136, 654, "top", 2560)), s), "screen");
  assert.deepEqual(calls, ["screen 2560"]);
  // An older answer is not even allowed to touch the screen.
  calls.length = 0;
  assert.equal(sync.accept(windowSnapshot(boot(2, 900, 500, "top", 1280)), s), "stale");
  assert.deepEqual(calls, []);
  assert.equal(room.screen, 2560);
});

test("the dock travels with the count: an older dock cannot overwrite a newer one", () => {
  const sync = new RoomSync();
  const { s, room } = sink();
  sync.accept(windowSnapshot(boot(5, 1136, 654, "bottom")), s);
  sync.accept(windowSnapshot(boot(4, 1136, 654, "top")), s);
  assert.equal(room.dock, "bottom");
});

test("an answer without a count applies once, as the first", () => {
  const sync = new RoomSync();
  const { s, calls } = sink();
  assert.equal(sync.accept(windowSnapshot(boot(undefined, 1136)), s), "panel");
  assert.equal(sync.accept(windowSnapshot(boot(undefined, 900)), s), "screen");
  assert.equal(calls.filter((c) => c.startsWith("room")).length, 1);
});

test("nothing is taken from an answer that is not a size", () => {
  assert.equal(windowSnapshot(null), null);
  assert.equal(windowSnapshot(undefined), null);
  assert.equal(windowSnapshot(boot(1, Number.NaN)), null);
  assert.equal(windowSnapshot(boot(1, 0)), null);
  assert.equal(windowSnapshot({ ...boot(1, 1136), panel: undefined } as unknown as BootWindow), null);
  const sync = new RoomSync();
  const { s, calls } = sink();
  assert.equal(sync.accept(null, s), "stale");
  assert.deepEqual(calls, []);
  assert.equal(sync.revision, -1, "nothing was ever applied");
});

test("a failing read is asked again a bounded number of times, with growing waits, then given up", async () => {
  let reads = 0;
  const waits: number[] = [];
  const answer = await readWithRetry(async () => { reads += 1; return null; }, 4, 150, async (ms) => { waits.push(ms); });
  assert.equal(answer, null);
  assert.equal(reads, 5, "once, and four more");
  assert.deepEqual(waits, [150, 300, 450, 600]);
});

test("a read that answers on a retry stops there and says which one", async () => {
  let reads = 0;
  const said: number[] = [];
  const answer = await readWithRetry(
    async () => (++reads === 3 ? { ok: true } : null), 4, 10, async () => {}, (n) => said.push(n),
  );
  assert.deepEqual(answer, { ok: true });
  assert.equal(reads, 3);
  assert.deepEqual(said, [2]);
});

test("no retries, or a nonsense count, means one read", async () => {
  for (const retries of [0, -3, Number.NaN]) {
    let reads = 0;
    const waits: number[] = [];
    await readWithRetry(async () => { reads += 1; return null; }, retries, 150, async (ms) => { waits.push(ms); });
    assert.equal(reads, 1, `retries=${retries}`);
    assert.deepEqual(waits, []);
  }
  // An answer on the first read is never followed by another.
  let reads = 0;
  await readWithRetry(async () => { reads += 1; return 1; }, 4, 150, async () => {});
  assert.equal(reads, 1);
});

test("cold start: no answer ever means no count, and the page can tell", async () => {
  const sync = new RoomSync();
  const answer = await readWithRetry(async () => null, 2, 1, async () => {});
  const { s } = sink();
  sync.accept(windowSnapshot(answer), s);
  assert.equal(sync.revision, -1, "main.ts then adopts the window the page is drawn in");
});

// ── Runtime: a fake viewport and a fake native bridge, driving the real keeper ──

const STRIP = { w: 240, h: 6 };
const WINDOW = { w: 1136, h: 654 };

/**
 * A page, a native side and a clock, all under the test's control. `answers` decides what each native read
 * returns (in order; the last one repeats); `wait` returns at once and keeps a log.
 */
function world(answers: Array<BootWindow | null>, start = STRIP) {
  const state = {
    viewport: { ...start },
    reads: 0,
    waits: [] as number[],
    answerCalls: 0,
    queue: [...answers],
  };
  const { s, calls, room } = sink();
  let known = false;
  const sinkWithKnown: RoomSink = {
    ...s,
    setRoom: (w, h, d) => { known = true; s.setRoom(w, h, d); },
    adoptObserved: (w, h) => { if (!known) s.adoptObserved(w, h); },
  };
  const keeper = new RoomKeeper<BootWindow>({
    read: async () => {
      state.reads += 1;
      const next = state.queue.length > 1 ? state.queue.shift()! : state.queue[0] ?? null;
      return next;
    },
    viewport: () => state.viewport,
    wait: async (ms) => { state.waits.push(ms); },
    sink: sinkWithKnown,
    onAnswer: () => { state.answerCalls += 1; },
  });
  return {
    keeper, state, calls, room,
    isKnown: () => known,
    /** The window changes size, as the page's `resize` would say. */
    resize(vp: { w: number; h: number }) { state.viewport = { ...vp }; keeper.windowResized(); },
  };
}

test("defect 1: every start-up read fails while the window is the wake strip — nothing is guessed from the strip", async () => {
  const w = world([null]);
  await w.keeper.start(2);
  await w.keeper.idle(); // the fake clock has no delay, so the late reads run now
  assert.equal(w.state.reads, 3 + LATE_RETRY_MS.length, "one read and two retries, then the fixed few late ones: bounded");
  assert.equal(w.keeper.sync.revision, -1);
  assert.deepEqual(w.calls, [], "the strip says nothing of the window: Room is left alone");
  assert.equal(w.room.w, 720);
});

test("defect 1: the window grows later, Rust sends no event and still fails — Room recovers to the viewport", async () => {
  const w = world([null]);
  await w.keeper.start(2);
  await w.keeper.idle(); // the late reads, while it is still the strip
  const readsBefore = w.state.reads;

  w.resize(WINDOW); // wake: strip → window. No panel-size event anywhere in this test.
  await w.keeper.idle();

  assert.equal(w.state.reads - readsBefore, 1 + RECOVERY_RETRIES, "one bounded recovery read");
  assert.deepEqual([w.room.w, w.room.h], [1136, 654], "geometry is the actual viewport");
  assert.equal(w.isKnown(), false, "a stand-in: the first native word is still the first");
  assert.ok(w.calls.includes("adopt 1136x654"));
});

test("defect 1: the window grows later and Rust answers on the recovery read — the native size is used, nothing is guessed", async () => {
  // Fails through start-up (3 reads) and the 2 late reads, answers when the window grows.
  const w = world([null, null, null, null, null, boot(1, 1136, 654)]);
  await w.keeper.start(2);
  await w.keeper.idle();
  assert.equal(w.keeper.sync.revision, -1);
  w.resize(WINDOW);
  await w.keeper.idle();
  assert.equal(w.keeper.sync.revision, 1);
  assert.equal(w.isKnown(), true);
  assert.deepEqual([w.room.w, w.room.h], [1136, 654]);
  assert.ok(!w.calls.some((c) => c.startsWith("adopt")), "no stand-in was needed");
  assert.ok(w.state.answerCalls >= 1, "what else the answer says (the cursor poll) is read too");
});

test("defect 1: a window that stays the strip costs no reads at all", async () => {
  const w = world([null]);
  await w.keeper.start(0);
  await w.keeper.idle();
  const reads = w.state.reads;
  for (let i = 0; i < 50; i++) w.resize(STRIP);
  await w.keeper.idle();
  assert.equal(w.state.reads, reads, "event-driven: only a window that is a window asks again");
});

test("defect 1: recovery is bounded — after RECOVERY_READS_MAX the viewport still follows, with no more IPC", async () => {
  const w = world([null]);
  await w.keeper.start(0);
  await w.keeper.idle();
  const afterStart = w.state.reads;
  // The window changes size many times (wake, display change…) and Rust never answers.
  for (let i = 0; i < 12; i++) {
    w.resize({ w: 1000 + i * 10, h: 600 });
    await w.keeper.idle();
  }
  const recoveryReads = w.state.reads - afterStart;
  assert.equal(recoveryReads, RECOVERY_READS_MAX * (1 + RECOVERY_RETRIES), "four recoveries of 1 + 2 reads, and no more");
  assert.deepEqual([w.room.w, w.room.h], [1110, 600], "Room still follows the window it is drawn in");
});

test("defect 1: late reads after a failed start are a fixed few, then it stops", async () => {
  const w = world([null], WINDOW);
  await w.keeper.start(0);
  await w.keeper.idle();
  assert.equal(w.state.reads, 1 + LATE_RETRY_MS.length);
  assert.deepEqual(w.state.waits.slice(-LATE_RETRY_MS.length), [...LATE_RETRY_MS]);
  assert.deepEqual([w.room.w, w.room.h], [1136, 654], "a window at start-up is adopted at once");
  await w.keeper.idle();
  assert.equal(w.state.reads, 1 + LATE_RETRY_MS.length, "nothing further");
});

test("defect 1: a late read that finally answers stops the others", async () => {
  const w = world([null, boot(1, 1136, 654)], WINDOW);
  await w.keeper.start(0);
  await w.keeper.idle();
  assert.equal(w.keeper.sync.revision, 1);
  assert.equal(w.state.reads, 2, "the second late read never happened");
});

test("defect 2: after the viewport fallback, a late revision-0 reply (the 720 × 320 default) cannot overwrite it", async () => {
  // The first read fails; the window is a window, so it is adopted. A reply to an EARLIER question limps in with Rust's default.
  const w = world([null], WINDOW);
  await w.keeper.start(0);
  assert.deepEqual([w.room.w, w.room.h], [1136, 654]);
  const lateDefault = boot(0, 720, 320);
  assert.equal(w.keeper.offer(lateDefault), "stale");
  assert.deepEqual([w.room.w, w.room.h], [1136, 654], "the window as seen stays");
  assert.equal(w.keeper.sync.revision, -1, "and it did not count as an answer");
  // The same through a read, not an offer (the path a panel-size event takes).
  const w2 = world([boot(0, 720, 320)], WINDOW);
  await w2.keeper.start(0);
  assert.deepEqual([w2.room.w, w2.room.h], [1136, 654]);
  assert.equal(w2.keeper.sync.revision, -1);
  assert.ok(!w2.calls.some((c) => c.startsWith("room ")), "the default was never applied as a size");
});

test("defect 2: revision 0 is legitimate at start-up — it is taken when nothing contradicts it", async () => {
  // Normal initialisation, the island's window not yet a window: Rust's own word, however low its count.
  const normal = world([boot(0, 720, 320)], STRIP);
  await normal.keeper.start(0);
  assert.equal(normal.keeper.sync.revision, 0);
  assert.equal(normal.isKnown(), true);
  assert.deepEqual([normal.room.w, normal.room.h], [720, 320]);

  // A display no bigger than the default: the window really is 720 × 320, and count 0 says so.
  const tiny = world([boot(0, 720, 320)], { w: 720, h: 320 });
  await tiny.keeper.start(0);
  assert.equal(tiny.keeper.sync.revision, 0);
  assert.equal(tiny.isKnown(), true);

  // Within the tolerance of rounding: the same size.
  const rounded = world([boot(0, 1136, 654)], { w: 1135, h: 655 });
  await rounded.keeper.start(0);
  assert.equal(rounded.keeper.sync.revision, 0);
});

test("defect 2: a genuinely newer revision after the fallback is taken, and then the older ones are not", async () => {
  const w = world([null], WINDOW);
  await w.keeper.start(0);
  assert.equal(w.keeper.offer(boot(0, 720, 320)), "stale");
  // Rust has sized a window since: count above 0, a different size (the display changed), the window not yet resized.
  assert.equal(w.keeper.offer(boot(3, 1000, 600)), "panel");
  assert.deepEqual([w.room.w, w.room.h], [1000, 600]);
  assert.equal(w.isKnown(), true);
  // From here on counts decide: older replies, even count 0, cannot undo it.
  for (const rev of [2, 1, 0]) assert.equal(w.keeper.offer(boot(rev, 720, 320)), "stale", `rev ${rev}`);
  assert.deepEqual([w.room.w, w.room.h], [1000, 600]);
  assert.equal(w.keeper.sync.revision, 3);
});

test("defect 2: several replies in any order after a fallback end on the newest count", async () => {
  const replies = [boot(2, 1200, 650), boot(0, 720, 320), boot(4, 1000, 600), boot(1, 1136, 654), boot(3, 1100, 640)];
  const orders = [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [1, 0, 3, 2, 4], [2, 4, 0, 3, 1]];
  for (const order of orders) {
    const w = world([null], WINDOW);
    await w.keeper.start(0);
    for (const i of order) w.keeper.offer(replies[i]);
    assert.deepEqual([w.room.w, w.room.h], [1000, 600], `order ${order.join(",")}: the count-4 size wins`);
    assert.equal(w.keeper.sync.revision, 4);
  }
});

test("failed reads followed by a successful one recover without any stand-in", async () => {
  const w = world([null, null, boot(1, 1136, 654)], WINDOW);
  await w.keeper.start(2);
  assert.equal(w.state.reads, 3);
  assert.equal(w.keeper.sync.revision, 1);
  assert.ok(!w.calls.some((c) => c.startsWith("adopt")));
  assert.deepEqual([w.room.w, w.room.h], [1136, 654]);
  await w.keeper.idle();
  assert.equal(w.state.reads, 3, "and no late reads once it has answered");
});

test("the observation rule in RoomSync itself: a sighting only stands until a native answer is applied", () => {
  const sync = new RoomSync();
  const { s, room } = sink();
  sync.observe({ w: 1136, h: 654 });
  assert.deepEqual(sync.observedSize, { w: 1136, h: 654 });
  assert.equal(sync.accept(windowSnapshot(boot(0, 720, 320)), s), "stale");
  assert.equal(sync.accept(windowSnapshot(boot(1, 1136, 654)), s), "panel");
  assert.equal(sync.observedSize, null, "forgotten once counts decide");
  sync.observe({ w: 500, h: 500 });
  assert.equal(sync.observedSize, null, "and not taken up again");
  assert.equal(room.w, 1136);
  // A strip is not a sighting of the window.
  const other = new RoomSync();
  other.observe({ w: 240, h: 6 });
  assert.equal(other.observedSize, null);
  assert.equal(other.accept(windowSnapshot(boot(0, 720, 320)), s), "panel");
});
// ── Wiring ───────────────────────────────────────────────────────────────────

const [main, rust, lib] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/island.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
]);

test("main: the panel-size event only triggers a read; its payload sizes nothing", () => {
  assert.match(main, /onEvent<PanelSize>\("panel-size", \(\) => void keeper\?\.refresh\(REFRESH_RETRIES\)\)/);
  assert.doesNotMatch(main, /onEvent<PanelSize>\("panel-size", \(\{/);
  assert.doesNotMatch(main, /panelEvents/);
  assert.equal(main.split('onEvent<PanelSize>("panel-size"').length - 1, 1);
  // Every size the island takes goes through the keeper (and so through the count).
  assert.equal((main.match(/\.setRoom\(/g) ?? []).length, 1, "one call site: the keeper's sink");
  assert.equal((main.match(/\.adoptObservedRoom\(/g) ?? []).length, 1);
  assert.match(main, /roomKeeper\.offer\(boot\)/);
  // Listener first, then the island, then the keeper's start.
  const listener = main.indexOf('onEvent<PanelSize>("panel-size"');
  const built = main.indexOf("new Island(root)");
  const started = main.indexOf("await roomKeeper.start(REFRESH_RETRIES);");
  assert.ok(main.indexOf("bootWithRetry()") < listener && listener < built && built < started);
  assert.ok(started < main.indexOf("Bridge.onCodexQuota"), "before the first awaits of the quota path");
});

test("main: the window growing is what recovers a Room Rust never answered for", () => {
  assert.match(main, /island\.onViewportChange = \(\) => roomKeeper\.windowResized\(\)/);
  assert.match(main, /viewport: \(\) => island\.viewportNow\(\)/);
});

test("rust: the count is bumped under the panel's lock and read with it", () => {
  assert.match(rust, /pub panel_rev: AtomicU64/);
  assert.match(rust, /\*known = panel;\s*shared\.gate\.panel_rev\.fetch_add\(1, Ordering::SeqCst\);\s*let _ = app\.emit_to\(WINDOW_LABEL, "panel-size", panel\)/);
  assert.match(lib, /panel_rev: u64,/);
  assert.match(lib, /let known = shared\.gate\.panel\.lock\(\)\.unwrap\(\);\s*\(\*known, shared\.gate\.panel_rev\.load\(Ordering::SeqCst\)\)/);
});

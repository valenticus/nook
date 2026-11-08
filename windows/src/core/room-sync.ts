// Keeping the page's idea of the window (layout.ts `Room`) in step with Rust's.
//
// Rust tells the window's size in two ways: in the answer to `boot`, and in a
// `panel-size` event when it changes. The order those reach the page in says
// nothing of which is newer — an event can overtake the answer to a question
// asked before it, or the other way round, and two answers can resolve in
// either order. So the page does not take sizes from events at all. An event is
// only a reason to ask again, and every answer carries a count (`panelRev`,
// island.rs `PollGate::panel_rev`) that Rust raises whenever the size changes:
// of two answers the higher count is the newer, however late it arrives, and
// an older one that comes in after a newer one is dropped.

import { GEOMETRY_TOLERANCE, viewportIsFullWindow, type Viewport } from "./hit-region";
import type { Dock } from "./layout";

/** What a `boot` answer says of the window, as far as the page keeps it. */
export interface WindowSnapshot {
  rev: number;
  width: number;
  height: number;
  dock: Dock;
  screenW: number;
  screenH: number;
}

/** The parts of a `boot` answer this reads. */
export interface BootWindow {
  panel: { width: number; height: number; dock: Dock };
  panelRev?: number;
  screen: { width: number; height: number };
}

const finite = (...values: number[]) => values.every(Number.isFinite);

/** The window part of a `boot` answer, or null when there is none (or it is not a size). */
export function windowSnapshot(boot: BootWindow | null | undefined): WindowSnapshot | null {
  if (!boot?.panel || !boot.screen) return null;
  const { width, height, dock } = boot.panel;
  if (!finite(width, height) || !(width > 0) || !(height > 0)) return null;
  // An answer without a count (an older Rust) is the first one: it applies once, and later ones refresh the screen only.
  const rev = Number.isFinite(boot.panelRev) ? (boot.panelRev as number) : 0;
  return { rev, width, height, dock, screenW: boot.screen.width, screenH: boot.screen.height };
}

export type Accepted = "panel" | "screen" | "stale";

export interface RoomSink {
  setRoom(width: number, height: number, dock: Dock): void;
  setScreenWidth(width: number, height: number): void;
  /** The window was SEEN at this size and nothing native said so: a stand-in, replaced by the first real word. */
  adoptObserved(width: number, height: number): void;
}

/** The count Rust starts at, with the window size it starts with (720 × 320) — before it has sized the window. */
export const INITIAL_REV = 0;

const sameSize = (a: { w: number; h: number }, b: { w: number; h: number }) =>
  Math.abs(a.w - b.w) <= GEOMETRY_TOLERANCE && Math.abs(a.h - b.h) <= GEOMETRY_TOLERANCE;

/**
 * Applies window snapshots in the order Rust made them, not the order they arrive in.
 *
 * Who is believed, when:
 *  - Between native answers, the higher count wins (older ones are dropped).
 *  - Before any native answer, a window that was SEEN (`observe`: the viewport
 *    of a full window) stands in for it. It is a fact about the window as it is
 *    now, and an answer only displaces it if it can be newer than the sighting.
 *    The first answer Rust can give, count 0, is the default it started with —
 *    which is exactly what a late reply to a question asked at startup carries.
 *    Against a window seen at another size it is stale, and dropped. Count 0
 *    that says the same size as the window (a display no bigger than the
 *    default), or any count above 0 (Rust has sized a window since), is taken.
 *  - Once an answer is applied the sighting is forgotten: counts decide.
 */
export class RoomSync {
  private applied = -1;
  private seen: Viewport | null = null;

  /** The count of the newest snapshot applied; -1 before any. */
  get revision(): number {
    return this.applied;
  }

  /** The window as last seen while no native answer had been applied, or null. */
  get observedSize(): Viewport | null {
    return this.seen;
  }

  /** The page is drawn in a full window of this size and Rust has not said so (yet). No effect once it has. */
  observe(vp: Viewport) {
    if (this.applied < 0 && viewportIsFullWindow(vp)) this.seen = { w: vp.w, h: vp.h };
  }

  /**
   * A newer snapshot sets the size and the screen; one of the same count is the
   * same size, so only the screen (it can change without the size) is refreshed;
   * an older one is dropped whole — and so is the default that a window seen at
   * another size contradicts (see the class).
   */
  accept(snapshot: WindowSnapshot | null, sink: RoomSink): Accepted {
    if (!snapshot || snapshot.rev < this.applied) return "stale";
    if (
      this.applied < 0 && this.seen && snapshot.rev === INITIAL_REV
      && !sameSize({ w: snapshot.width, h: snapshot.height }, this.seen)
    ) return "stale";
    const newer = snapshot.rev > this.applied;
    this.applied = snapshot.rev;
    this.seen = null;
    if (newer) sink.setRoom(snapshot.width, snapshot.height, snapshot.dock);
    sink.setScreenWidth(snapshot.screenW, snapshot.screenH);
    return newer ? "panel" : "screen";
  }
}

/**
 * Asks for something that may not answer yet, a bounded number of times: once,
 * and `retries` more, a little later each time (`step` ms, `2 × step`, …).
 * Gives up with null — never loops. `wait` is a parameter so tests need no timers.
 */
export async function readWithRetry<T>(
  read: () => Promise<T | null>,
  retries: number,
  step: number,
  wait: (ms: number) => Promise<void>,
  onRetryAnswered?: (attempt: number) => void,
): Promise<T | null> {
  let answer = await read();
  const limit = Math.max(0, Math.floor(retries));
  for (let attempt = 1; answer == null && attempt <= limit; attempt++) {
    await wait(step * attempt);
    answer = await read();
    if (answer != null) onRetryAnswered?.(attempt);
  }
  return answer;
}

// ── Keeping Room right when the first reads fail ─────────────────────────────

/** Reads made because the window grew with no native answer yet, at most: then no more IPC for it. */
export const RECOVERY_READS_MAX = 4;
/** Each recovery read is one try and this many retries. */
export const RECOVERY_RETRIES = 2;
/** Single late reads while there is still no native answer, after the start-up ones; then it stops. */
export const LATE_RETRY_MS: readonly number[] = [2000, 6000];
const RETRY_STEP_MS = 150;

export interface RoomKeeperDeps<B extends BootWindow> {
  /** One native read of the window; null when there is no answer. */
  read(): Promise<B | null>;
  /** The window the page is drawn in, as the page last saw it (no layout is forced). */
  viewport(): Viewport;
  sink: RoomSink;
  wait(ms: number): Promise<void>;
  /** Every answer that arrives, before it is judged: what else a `boot` says (the cursor poll's owner). */
  onAnswer?(answer: B): void;
}

/**
 * Gets Room right and keeps it right, whatever the first reads do.
 *
 *  - Answers go through `RoomSync`, by count.
 *  - With no native answer at all, the window as it is drawn stands in — but
 *    only once it IS a window: the 240 × 6 wake strip says nothing of the
 *    room. So a start with failed reads and a collapsed island leaves Room at
 *    its default for the moment, and `windowResized` (the page's `resize`,
 *    when the window grows) asks again, at most `RECOVERY_READS_MAX` times, and
 *    falls back to the window it finds if Rust still does not answer. No
 *    `panel-size` event is needed: Rust sends none when nothing changed.
 *  - A few single late reads follow a start with no answer, then it stops.
 */
export class RoomKeeper<B extends BootWindow = BootWindow> {
  readonly sync = new RoomSync();
  private recoveries = 0;
  /** The window size Room was last set to from the window itself, for want of a native answer. */
  private adopted: Viewport | null = null;
  private inFlight: Promise<void> | null = null;
  private background: Promise<void> = Promise.resolve();

  private readonly deps: RoomKeeperDeps<B>;

  constructor(deps: RoomKeeperDeps<B>) {
    this.deps = deps;
  }

  /** An answer already in hand (the first `boot`'s). */
  offer(answer: B | null): Accepted {
    if (!answer) return "stale";
    this.deps.onAnswer?.(answer);
    // The window is looked at BEFORE the answer is judged: a late reply that still carries
    // Rust's default must meet the window as it is, wherever it arrives in the order of things.
    if (this.sync.revision < 0) this.sync.observe(this.deps.viewport());
    return this.sync.accept(windowSnapshot(answer), this.deps.sink);
  }

  /** One bounded read, applied by count; with no native answer ever, the window as drawn stands in. */
  async refresh(retries: number): Promise<void> {
    const answer = await readWithRetry(() => this.deps.read(), retries, RETRY_STEP_MS, this.deps.wait);
    this.offer(answer);
    this.fallBack();
  }

  /** After the first reads: refresh, and where Rust still has not answered, a few late reads in the background. */
  async start(retries: number): Promise<void> {
    await this.refresh(retries);
    if (this.sync.revision < 0) this.background = this.lateReads();
  }

  /** The page's `resize`: the window changed size. Only matters while Rust has not answered. */
  windowResized(): void {
    if (this.sync.revision >= 0 || this.inFlight) return;
    if (!viewportIsFullWindow(this.deps.viewport())) return;
    if (this.recoveries >= RECOVERY_READS_MAX) {
      this.fallBack();
      return;
    }
    this.recoveries += 1;
    this.inFlight = this.refresh(RECOVERY_RETRIES).catch(() => {}).finally(() => { this.inFlight = null; });
  }

  /** Resolves once the reads in flight, and the late ones scheduled, are over. */
  async idle(): Promise<void> {
    await this.inFlight;
    await this.background;
  }

  private fallBack() {
    if (this.sync.revision >= 0) return;
    const vp = this.deps.viewport();
    if (!viewportIsFullWindow(vp)) return;
    if (this.adopted && sameSize(this.adopted, vp)) return;
    this.adopted = { w: vp.w, h: vp.h };
    this.sync.observe(vp);
    this.deps.sink.adoptObserved(vp.w, vp.h);
  }

  private async lateReads() {
    for (const ms of LATE_RETRY_MS) {
      await this.deps.wait(ms);
      if (this.sync.revision >= 0) return;
      if (this.inFlight) continue;
      await this.refresh(0);
    }
  }
}

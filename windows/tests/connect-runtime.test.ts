import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Bridge, type ConnectAgent, type ConnectScan } from "../src/core/bridge.ts";
import { refreshConnectScan } from "../src/core/connect-runtime.ts";
import { IntegrationHealth, phaseNeedsSettings } from "../src/core/integration-health.ts";

// These drive the REAL coalescing in connect-runtime.ts: only the Tauri call underneath is replaced.

const REQUIRED: Record<ConnectAgent, string[]> = {
  ClaudeCode: ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop"],
  Codex: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd", "Interrupt", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"],
};
const RELAY = "C:\\NookStandalone\\bin\\nook-hook-standalone.exe";

/** A Standalone inventory with the named agents connected. */
function inventory(...connected: ConnectAgent[]): ConnectScan {
  const hooks: ConnectScan["hooks"] = [];
  for (const agent of connected) {
    for (const event of REQUIRED[agent]) {
      hooks.push({ agent, scope: "User", configPath: `C:\\Users\\sample\\.${agent}.json`, event, ownership: "StandaloneNook", command: RELAY, relayPath: RELAY, relayExists: true });
    }
  }
  return { standaloneRelay: RELAY, standaloneRelayReady: true, detectedAgents: [], configs: [], hooks, duplicates: [], agents: [], issues: [] } as ConnectScan;
}

interface Open { resolve(scan: ConnectScan | null): void; reject(error: unknown): void }

/**
 * Replaces the Tauri call. Every scan the runtime starts becomes an entry the test settles by hand;
 * `open` is how many are reading at once — it must never be more than one.
 */
function stubScanner() {
  const original = Bridge.connectScan;
  const started: Open[] = [];
  const state = { open: 0, maxOpen: 0 };
  Bridge.connectScan = () => new Promise<ConnectScan | null>((resolve, reject) => {
    state.open += 1;
    state.maxOpen = Math.max(state.maxOpen, state.open);
    started.push({
      resolve: (scan) => { state.open -= 1; resolve(scan); },
      reject: (error) => { state.open -= 1; reject(error); },
    });
  });
  return { started, state, restore: () => { Bridge.connectScan = original; } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function withScanner(body: (s: ReturnType<typeof stubScanner>) => Promise<void>) {
  const scanner = stubScanner();
  try {
    await body(scanner);
  } finally {
    // Nothing left running for the next test.
    for (const open of scanner.started) open.resolve(null);
    await tick();
    scanner.restore();
  }
}

test("ordinary callers still share one scan", async () => {
  await withScanner(async ({ started }) => {
    const a = refreshConnectScan();
    const b = refreshConnectScan();
    const c = refreshConnectScan();
    assert.equal(started.length, 1, "one scan for three callers");
    const scan = inventory("ClaudeCode");
    started[0]!.resolve(scan);
    assert.deepEqual(await Promise.all([a, b, c]), [scan, scan, scan]);
    // Once it is over, the next caller starts a new one.
    const d = refreshConnectScan();
    assert.equal(started.length, 2);
    started[1]!.resolve(scan);
    await d;
  });
});

test("a fresh request does not reuse a scan that began earlier, and does not run beside it", async () => {
  await withScanner(async ({ started, state }) => {
    const older = refreshConnectScan();                  // began before the change
    const fresh = refreshConnectScan({ fresh: true });   // the change has been applied
    assert.equal(started.length, 1, "the fresh scan waits: it is not the old one, and not a second at once");
    const stale = inventory();                           // the old files: nothing connected
    started[0]!.resolve(stale);
    assert.equal(await older, stale, "the old caller gets what the old scan read");
    await tick();
    assert.equal(started.length, 2, "now the fresh scan reads the files");
    const current = inventory("ClaudeCode");
    started[1]!.resolve(current);
    assert.equal(await fresh, current, "and the fresh caller gets only the new inventory");
    assert.equal(state.maxOpen, 1, "two scans were never reading at once");
  });
});

test("fresh requests made together share one scan; one made after it began needs another", async () => {
  await withScanner(async ({ started }) => {
    const running = refreshConnectScan();
    const one = refreshConnectScan({ fresh: true });
    const two = refreshConnectScan({ fresh: true });
    const three = refreshConnectScan({ fresh: true });
    assert.equal(one, two);
    assert.equal(two, three);
    started[0]!.resolve(inventory());
    await running;
    await tick();
    assert.equal(started.length, 2, "one fresh scan for all three");
    // A second change is applied while that fresh scan is already reading: it may have read before it.
    const again = refreshConnectScan({ fresh: true });
    assert.notEqual(again, one);
    assert.equal(started.length, 2, "still one at a time");
    started[1]!.resolve(inventory("ClaudeCode"));
    await one;
    await tick();
    assert.equal(started.length, 3);
    started[2]!.resolve(inventory("ClaudeCode", "Codex"));
    assert.equal((await again)?.hooks.length, REQUIRED.ClaudeCode.length + REQUIRED.Codex.length);
  });
});

test("an ordinary caller that comes while a fresh scan is waiting gets the fresh one", async () => {
  await withScanner(async ({ started }) => {
    const running = refreshConnectScan();
    const fresh = refreshConnectScan({ fresh: true });
    const ordinary = refreshConnectScan();
    assert.equal(ordinary, fresh, "the newest scan is the one worth joining");
    started[0]!.resolve(inventory());
    await running;
    await tick();
    const current = inventory("Codex");
    started[1]!.resolve(current);
    assert.equal(await ordinary, current);
  });
});

test("a scan that fails does not block the fresh one behind it", async () => {
  await withScanner(async ({ started }) => {
    const running = refreshConnectScan();
    const fresh = refreshConnectScan({ fresh: true });
    started[0]!.reject(new Error("scan failed"));
    await assert.rejects(running);
    await tick();
    assert.equal(started.length, 2, "the fresh scan still starts");
    started[1]!.resolve(inventory("ClaudeCode"));
    assert.ok(await fresh);
  });
});

// ── With the integration health, end to end through the real runtime ─────────────────────────────

function health() {
  const h = new IntegrationHealth(() => 1_000_000, () => {});
  h.configure("Standalone", refreshConnectScan);
  return h;
}

test("Connect applied while a pre-change scan is still running: the old inventory never reaches the Home view", async () => {
  await withScanner(async ({ started, state }) => {
    const h = health();
    const before = h.verify({ force: true });            // began before the apply: will read the OLD files
    assert.equal(started.length, 1);
    // The apply succeeds; Rust announces it; the island checks again — fresh.
    const after = h.configurationChanged();
    assert.equal(started.length, 1, "no second scan beside the running one");

    started[0]!.resolve(inventory());                    // the old files: nothing connected
    await before;
    assert.notEqual(h.phase, "unconfigured", "the pre-change inventory is not believed, even for a moment");
    assert.equal(phaseNeedsSettings(h.phase), false, "so the link does not come back");

    await tick();
    assert.equal(started.length, 2);
    started[1]!.resolve(inventory("ClaudeCode"));        // what the apply wrote
    await after;
    assert.equal(h.phase, "ready", "the fresh inventory controls the view");
    assert.equal(phaseNeedsSettings(h.phase), false);
    assert.equal(state.maxOpen, 1);
  });
});

test("a Disconnect applied behind a running scan: the link appears from the fresh inventory only", async () => {
  await withScanner(async ({ started }) => {
    const h = health();
    const first = h.verify({ force: true });
    started[0]!.resolve(inventory("ClaudeCode", "Codex"));
    await first;
    assert.equal(h.phase, "ready");
    // A check is running (an ordinary redraw) when both agents are disconnected.
    const running = refreshConnectScan();
    const changed = h.configurationChanged();
    started[1]!.resolve(inventory("ClaudeCode", "Codex"));   // read just before the disconnect landed
    await running;
    await tick();
    assert.equal(h.phase, "ready", "the old picture is not what the user sees after the disconnect");
    started[2]!.resolve(inventory());
    await changed;
    assert.equal(h.phase, "unconfigured");
    assert.equal(phaseNeedsSettings(h.phase), true);
  });
});

test("wiring: the island asks for a fresh scan on a confirmed change, and nowhere else", async () => {
  const health = await readFile(new URL("../src/core/integration-health.ts", import.meta.url), "utf8");
  assert.match(health, /found = await \(options\.changed \|\| options\.fresh \? scan\(\{ fresh: true \}\) : scan\(\)\)/);
  const runtime = await readFile(new URL("../src/core/connect-runtime.ts", import.meta.url), "utf8");
  // Ordinary callers (the hook status, the 30 s timer, focus, hook events) pass no option.
  assert.doesNotMatch(runtime.replace(/export function refreshConnectScan[\s\S]*?\n}\n/, ""), /fresh: true/);
});

// ── The handoff: the old scan is over, the queued fresh scan has not begun ────────────────────────

/**
 * A reaction registered on the old scan BEFORE the fresh request is made runs, when the old scan
 * settles, ahead of the fresh scan's own start. By then the runtime has already cleared `inFlight`,
 * and `queuedFresh` is still waiting: exactly the interval in which a request must not start a scan
 * of its own. `probe` is called from inside it.
 */
async function handoff(oldScan: "succeeds" | "fails", probe: (seen: { gap: Promise<ConnectScan | null>[] }) => void) {
  await withScanner(async ({ started, state }) => {
    const seen = { gap: [] as Promise<ConnectScan | null>[] };
    const older = refreshConnectScan();                          // began before the change
    const settle = () => probe(seen);                            // runs in the handoff interval
    const watching = older.then(settle, settle);                 // registered first on purpose
    const fresh = refreshConnectScan({ fresh: true });           // the change was applied
    assert.equal(started.length, 1);

    if (oldScan === "succeeds") started[0]!.resolve(inventory());   // the old files: nothing connected
    else started[0]!.reject(new Error("scan failed"));
    await watching;
    await tick();

    assert.equal(started.length, 2, "exactly one more scan began: the fresh one, not one per caller");
    assert.equal(state.maxOpen, 1, "never two scans reading at once");
    const current = inventory("ClaudeCode");
    started[1]!.resolve(current);
    assert.equal(await fresh, current);
    for (const joined of seen.gap) {
      assert.equal(joined, fresh, "a caller in the handoff joined the fresh scan");
      assert.equal(await joined, current, "and got the fresh inventory, never the old one");
    }
    assert.ok(seen.gap.length > 0, "the probe really ran");
    // Everything is clear afterwards: the next request starts a plain new scan.
    const next = refreshConnectScan();
    assert.equal(started.length, 3);
    started[2]!.resolve(current);
    await next;
  });
}

test("handoff after a successful old scan: an ordinary caller joins the queued fresh scan", async () => {
  await handoff("succeeds", (seen) => { seen.gap.push(refreshConnectScan()); });
});

test("handoff after a failed old scan: the same", async () => {
  await handoff("fails", (seen) => { seen.gap.push(refreshConnectScan()); });
});

test("handoff: a second fresh request inside the interval coalesces with the queued one", async () => {
  await handoff("succeeds", (seen) => {
    seen.gap.push(refreshConnectScan({ fresh: true }));
    seen.gap.push(refreshConnectScan());
    seen.gap.push(refreshConnectScan({ fresh: true }));
  });
});

test("handoff, end to end with the health: the old inventory never shows, the fresh one decides", async () => {
  await withScanner(async ({ started, state }) => {
    const h = new IntegrationHealth(() => 1_000_000, () => {});
    h.configure("Standalone", refreshConnectScan);
    const before = h.verify({ force: true });                    // pre-change
    const ordinary = refreshConnectScan();                       // something else shares it (hook status, timer…)
    const gapCaller = ordinary.then(() => refreshConnectScan(), () => refreshConnectScan());   // asks inside the handoff
    const after = h.configurationChanged();
    started[0]!.resolve(inventory());                            // old files
    await before;
    assert.notEqual(h.phase, "unconfigured");
    await tick();
    assert.equal(started.length, 2);
    started[1]!.resolve(inventory("ClaudeCode", "Codex"));
    await after;
    assert.equal(h.phase, "ready");
    assert.equal(phaseNeedsSettings(h.phase), false);
    assert.equal((await gapCaller)?.hooks.length, REQUIRED.ClaudeCode.length + REQUIRED.Codex.length);
    assert.equal(state.maxOpen, 1);
  });
});

test("no deadlock: if starting the queued scan throws, the fresh request fails and the next one works", async () => {
  const original = Bridge.connectScan;
  const open: Open[] = [];
  let calls = 0;
  Bridge.connectScan = () => {
    calls += 1;
    if (calls === 2) throw new Error("could not start the scan");   // the fresh scan's start blows up
    return new Promise<ConnectScan | null>((resolve, reject) => { open.push({ resolve, reject }); });
  };
  try {
    const running = refreshConnectScan();
    const fresh = refreshConnectScan({ fresh: true });
    open[0]!.resolve(inventory());
    await running;
    await assert.rejects(fresh, /could not start/);
    // Nothing is left half-queued: the next request starts a scan at once, and a fresh one queues normally.
    const next = refreshConnectScan();
    assert.equal(calls, 3);
    const again = refreshConnectScan({ fresh: true });
    open[1]!.resolve(inventory("Codex"));
    assert.ok(await next);
    await tick();
    assert.equal(calls, 4);
    open[2]!.resolve(inventory("ClaudeCode"));
    assert.ok(await again);
  } finally {
    for (const o of open) o.resolve(null);
    await tick();
    Bridge.connectScan = original;
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { ConnectAgent, ConnectScan } from "../src/core/bridge.ts";
import {
  IntegrationHealth,
  MIN_REVERIFY_MS,
  UNKNOWN_RETRY_MS,
  assessIntegrations,
  phaseNeedsSettings,
  type IntegrationPhase,
} from "../src/core/integration-health.ts";

const REQUIRED: Record<ConnectAgent, string[]> = {
  ClaudeCode: ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop"],
  Codex: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "SessionEnd", "Interrupt", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"],
};
const RELAY = "C:\\NookStandalone\\bin\\nook-hook-standalone.exe";

type Setup = "connected" | "absent" | "incomplete" | "relay-missing";

/** A Standalone-build inventory, with each agent set up as asked; nothing else about it matters here. */
function scanOf(claude: Setup, codex: Setup, extra: Partial<ConnectScan> = {}): ConnectScan {
  const hooks: ConnectScan["hooks"] = [];
  for (const [agent, setup] of [["ClaudeCode", claude], ["Codex", codex]] as const) {
    if (setup === "absent") continue;
    const events = setup === "incomplete" ? REQUIRED[agent].slice(1) : REQUIRED[agent];
    for (const event of events) {
      hooks.push({ agent, scope: "User", configPath: `C:\\Users\\sample\\.${agent}.json`, event, ownership: "StandaloneNook", command: RELAY, relayPath: RELAY, relayExists: setup !== "relay-missing" });
    }
  }
  const agents = (["ClaudeCode", "Codex"] as const).map((agent) => ({
    agent, configurationStatus: "Configured" as const, deliveryState: "WaitingForActivity" as const, lastReceivedEvent: null, lastReceivedAtMs: null,
  }));
  return { standaloneRelay: RELAY, standaloneRelayReady: true, detectedAgents: [], configs: [], hooks, duplicates: [], agents, issues: [], ...extra } as ConnectScan;
}

/** A scan the test settles by hand, to put answers in any order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function health(scan: () => Promise<ConnectScan | null>, build: "Standalone" | "Dev" | "Original" = "Standalone", clock = { now: 0 }) {
  // No real timers: the one retry after an unknown result is exercised, with a fake clock, further down.
  const h = new IntegrationHealth(() => clock.now, () => {});
  h.configure(build, scan);
  return { h, clock };
}

async function verified(setup: [Setup, Setup], extra: Partial<ConnectScan> = {}): Promise<IntegrationPhase> {
  const { h } = health(async () => scanOf(setup[0], setup[1], extra));
  await h.verify({ force: true });
  return h.phase;
}

// ── The model, from a finished inventory ─────────────────────────────────────

test("both integrations configured and no sessions: ready, no way to Settings", async () => {
  const phase = await verified(["connected", "connected"]);
  assert.equal(phase, "ready");
  assert.equal(phaseNeedsSettings(phase), false);
});

test("Claude only, or Codex only: the other agent is optional, not a failure", async () => {
  for (const setup of [["connected", "absent"], ["absent", "connected"]] as [Setup, Setup][]) {
    const phase = await verified(setup);
    assert.equal(phase, "ready", setup.join("/"));
    assert.equal(phaseNeedsSettings(phase), false, setup.join("/"));
  }
});

test("neither configured: unconfigured, and that earns the way to Settings", async () => {
  const phase = await verified(["absent", "absent"]);
  assert.equal(phase, "unconfigured");
  assert.equal(phaseNeedsSettings(phase), true);
});

test("a confirmed broken configuration needs attention, even beside a healthy agent", async () => {
  for (const setup of [["incomplete", "absent"], ["relay-missing", "absent"], ["connected", "incomplete"], ["relay-missing", "connected"]] as [Setup, Setup][]) {
    const phase = await verified(setup);
    assert.equal(phase, "needs_attention", setup.join("/"));
    assert.equal(phaseNeedsSettings(phase), true, setup.join("/"));
  }
  const duplicate = await verified(["connected", "absent"], { duplicates: [{ agent: "ClaudeCode", event: "Stop", relayPath: RELAY, scopes: ["User", "Project"], configPaths: ["a", "b"] }] });
  assert.equal(duplicate, "needs_attention");
});

test("CLI detection, configured hooks and event delivery are three different things", () => {
  // Healthy with no CLI found and no event ever received: still ready — an idle agent has sent nothing.
  const idle = assessIntegrations(scanOf("connected", "connected", { detectedAgents: [] }), "Standalone");
  assert.equal(idle.phase, "ready");
  assert.deepEqual(idle.agents.ClaudeCode, { detected: false, state: "Connected", delivery: "WaitingForActivity" });
  // Not configured but the CLI is installed: installed is not connected.
  const installedOnly = assessIntegrations(scanOf("absent", "absent", { detectedAgents: ["ClaudeCode", "Codex"] }), "Standalone");
  assert.equal(installedOnly.phase, "unconfigured");
  assert.equal(installedOnly.agents.Codex.detected, true);
  assert.equal(installedOnly.agents.Codex.state, "Not connected");
  // Events arriving does not paper over a broken configuration either.
  const receiving = scanOf("incomplete", "absent");
  receiving.agents[0]!.deliveryState = "Receiving";
  assert.equal(assessIntegrations(receiving, "Standalone").phase, "needs_attention");
});

test("no recent events despite healthy configuration is still ready", async () => {
  const scan = scanOf("connected", "connected");
  for (const a of scan.agents) { a.deliveryState = "WaitingForActivity"; a.lastReceivedEvent = null; a.lastReceivedAtMs = null; }
  const { h } = health(async () => scan);
  await h.verify({ force: true });
  assert.equal(h.phase, "ready");
});

test("hooks of another Nook build do not make this build ready", () => {
  const original = scanOf("connected", "absent");
  for (const hook of original.hooks) hook.ownership = "OriginalNook";
  assert.equal(assessIntegrations(original, "Standalone").phase, "unconfigured");
});

// ── Start-up and late results ────────────────────────────────────────────────

test("start-up: while the check runs the phase is 'checking' and no way to Settings is offered", async () => {
  const pending = deferred<ConnectScan | null>();
  const { h } = health(() => pending.promise);
  assert.equal(h.phase, "checking", "before anything is asked");
  assert.equal(phaseNeedsSettings(h.phase), false);
  const run = h.verify({ force: true });
  assert.equal(h.phase, "checking", "while it runs");
  assert.equal(phaseNeedsSettings(h.phase), false, "unknown is never treated as disconnected");
  pending.resolve(scanOf("connected", "connected"));
  await run;
  assert.equal(h.phase, "ready");
});

test("successful verification redraws: subscribers are told once, and only on a change", async () => {
  const { h, clock } = health(async () => scanOf("connected", "absent"));
  let told = 0;
  h.subscribe(() => { told += 1; });
  await h.verify({ force: true });
  assert.equal(told, 1);
  clock.now += MIN_REVERIFY_MS + 1;
  await h.verify();
  assert.equal(told, 1, "the same answer again changes nothing and redraws nothing");
});

test("failed verification is unknown, not a finding: null, a thrown error and a rejection", async () => {
  for (const fail of [async () => null, async () => { throw new Error("scan failed"); }, () => Promise.reject(new Error("boom"))]) {
    const { h } = health(fail as () => Promise<ConnectScan | null>);
    let told = 0;
    h.subscribe(() => { told += 1; });
    await h.verify({ force: true });
    assert.equal(h.phase, "unknown");
    assert.equal(phaseNeedsSettings(h.phase), false, "no troubleshooting for something nobody found out");
    assert.equal(told, 1);
  }
});

test("a later failure keeps what was confirmed before; it does not invent a problem or hide one", async () => {
  for (const [setup, expected] of [[["connected", "connected"], "ready"], [["incomplete", "absent"], "needs_attention"], [["absent", "absent"], "unconfigured"]] as [[Setup, Setup], IntegrationPhase][]) {
    let fail = false;
    const { h } = health(async () => (fail ? null : scanOf(setup[0], setup[1])));
    await h.verify({ force: true });
    assert.equal(h.phase, expected);
    fail = true;
    await h.verify({ force: true });
    assert.equal(h.phase, expected, `${expected} stands after a failed re-check`);
  }
});

test("late asynchronous results: an older scan finishing after a newer one cannot undo it", async () => {
  const slowOld = deferred<ConnectScan | null>();
  const fastNew = deferred<ConnectScan | null>();
  const queue = [slowOld, fastNew];
  const { h } = health(() => queue.shift()!.promise);
  const first = h.verify({ force: true });   // asked first, answers last
  const second = h.verify({ force: true });  // asked second, answers first
  fastNew.resolve(scanOf("connected", "connected"));
  await second;
  assert.equal(h.phase, "ready");
  slowOld.resolve(scanOf("absent", "absent")); // stale: would have said "unconfigured"
  await first;
  assert.equal(h.phase, "ready", "the late, older answer is dropped");
});

test("late asynchronous results: the same order the other way round ends on the newer", async () => {
  const a = deferred<ConnectScan | null>();
  const b = deferred<ConnectScan | null>();
  const queue = [a, b];
  const { h } = health(() => queue.shift()!.promise);
  const first = h.verify({ force: true });
  const second = h.verify({ force: true });
  a.resolve(scanOf("absent", "absent"));
  await first;
  assert.equal(h.phase, "unconfigured");
  b.resolve(scanOf("connected", "absent"));
  await second;
  assert.equal(h.phase, "ready");
});

test("an answer still on its way when the setup changes is discarded", async () => {
  const pending = deferred<ConnectScan | null>();
  const h = new IntegrationHealth(() => 0, () => {});
  h.configure("Standalone", () => pending.promise);
  const run = h.verify({ force: true });
  h.configure("Standalone", async () => null); // starts over
  assert.equal(h.phase, "checking");
  pending.resolve(scanOf("absent", "absent"));
  await run;
  assert.equal(h.phase, "checking", "the old answer found nobody to tell");
});

test("asking again is cheap: it joins a running check, and waits out the interval after one", async () => {
  let scans = 0;
  const pending = deferred<ConnectScan | null>();
  const clock = { now: 1_000 };
  const h = new IntegrationHealth(() => clock.now, () => {});
  h.configure("Standalone", () => { scans += 1; return pending.promise; });
  const a = h.verify();
  const b = h.verify();
  assert.equal(scans, 1, "joined, not repeated");
  pending.resolve(scanOf("connected", "absent"));
  await Promise.all([a, b]);
  await h.verify();
  assert.equal(scans, 1, "too soon after the last");
  clock.now += MIN_REVERIFY_MS + 1;
  const again = deferred<ConnectScan | null>();
  h.configure("Standalone", () => { scans += 1; return again.promise; });
  void h.verify();
  assert.equal(scans, 2);
});

test("Dev never scans and never offers Settings", async () => {
  let scans = 0;
  const { h } = health(async () => { scans += 1; return scanOf("absent", "absent"); }, "Dev");
  await h.verify({ force: true });
  assert.equal(scans, 0);
  assert.equal(h.phase, "unknown");
  assert.equal(phaseNeedsSettings(h.phase), false);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

const [home, main, i18n] = await Promise.all([
  readFile(new URL("../src/views/home.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/core/i18n.ts", import.meta.url), "utf8"),
]);

test("the empty view offers Settings only for a confirmed problem", () => {
  assert.match(home, /if \(!State\.nookDev && phaseNeedsSettings\(phase\)\) empty\.append\(/);
  assert.match(home, /const phase = State\.nookDev \? "unknown" : integrationHealth\.phase;/);
  // The phase is part of what the view was last drawn for, so a finished check redraws it.
  assert.match(home, /const key = none \? `\$\{tracked\}:\$\{State\.nookDev\}:\$\{phase\}` : "";/);
  // Never from "no sessions" alone.
  assert.doesNotMatch(home, /live\.length === 0[^\n]*Settings/);
});

test("the check starts at start-up, before the first awaits of the window path, and redraws on its answer", () => {
  const configure = main.indexOf("integrationHealth.configure(");
  assert.ok(configure > 0);
  assert.ok(configure < main.indexOf("await roomKeeper.start("), "not held back by the window reads");
  assert.match(main, /integrationHealth\.configure\(State\.nookDev \? "Dev" : State\.nookStandalone \? "Standalone" : "Original", refreshConnectScan\)/);
  assert.match(main, /integrationHealth\.subscribe\(\(\) => State\.notify\(\)\)/);
  assert.match(main, /void integrationHealth\.verify\(\{ force: true \}\)/);
  // The existing Connect inventory is reused, not a second scanner.
  assert.match(main, /import \{ refreshConnectScan \} from "\.\/core\/connect-runtime"/);
});

test("the link's text is unchanged and still in both languages", () => {
  assert.match(i18n, /"Check integrations in Settings": \{ en: "Check integrations in Settings", uk: "Перевірте інтеграції в налаштуваннях" \}/);
});

// ── After Connect / Disconnect is applied in Settings ────────────────────────────────────────────

/** The configuration on disk as the scan reads it, changed by a test the way an apply changes files. */
function disk(claude: Setup, codex: Setup) {
  const state = { claude, codex, scans: 0 };
  return { state, scan: async () => { state.scans += 1; return scanOf(state.claude, state.codex); } };
}

function watched(scan: () => Promise<ConnectScan | null>) {
  const clock = { now: 1_000_000 };
  const scheduled: { run: () => void; ms: number }[] = [];
  const h = new IntegrationHealth(() => clock.now, (run, ms) => { scheduled.push({ run, ms }); });
  h.configure("Standalone", scan);
  return { h, clock, scheduled };
}

test("a successful Claude connect: the empty view's link goes at once, inside the throttle", async () => {
  const d = disk("absent", "absent");
  const { h } = watched(d.scan);
  await h.verify({ force: true });
  assert.equal(h.phase, "unconfigured");
  assert.equal(phaseNeedsSettings(h.phase), true);
  d.state.claude = "connected";                // Settings → Connect applied
  await h.configurationChanged();              // the event from Rust
  assert.equal(h.phase, "ready");
  assert.equal(phaseNeedsSettings(h.phase), false);
  assert.equal(d.state.scans, 2);
});

test("a successful Codex connect works the same", async () => {
  const d = disk("absent", "absent");
  const { h } = watched(d.scan);
  await h.verify({ force: true });
  d.state.codex = "connected";
  await h.configurationChanged();
  assert.equal(h.phase, "ready");
});

test("a successful repair: needs_attention becomes ready and the link disappears", async () => {
  const d = disk("incomplete", "absent");
  const { h } = watched(d.scan);
  await h.verify({ force: true });
  assert.equal(h.phase, "needs_attention");
  assert.equal(phaseNeedsSettings(h.phase), true);
  d.state.claude = "connected";
  await h.configurationChanged();
  assert.equal(h.phase, "ready");
  assert.equal(phaseNeedsSettings(h.phase), false);
});

test("a successful disconnect: one agent leaves the other ready; both gone brings the link", async () => {
  const d = disk("connected", "connected");
  const { h } = watched(d.scan);
  await h.verify({ force: true });
  assert.equal(h.phase, "ready");
  d.state.claude = "absent";                   // Claude disconnected
  await h.configurationChanged();
  assert.equal(h.phase, "ready", "Codex is still connected: nothing to fix");
  assert.equal(phaseNeedsSettings(h.phase), false);
  d.state.codex = "absent";                    // and Codex
  await h.configurationChanged();
  assert.equal(h.phase, "unconfigured");
  assert.equal(phaseNeedsSettings(h.phase), true, "the link appears once nothing is connected");
});

test("a failed or cancelled apply sends nothing, so nothing is rechecked and nothing is claimed", async () => {
  const d = disk("absent", "absent");
  const { h, clock } = watched(d.scan);
  await h.verify({ force: true });
  const told: IntegrationPhase[] = [];
  h.subscribe(() => told.push(h.phase));
  // No "integrations-changed" arrives (Rust returns before announcing). Ordinary redraws stay throttled.
  clock.now += 2_000;
  await h.verify();
  await h.verify();
  assert.equal(d.state.scans, 1);
  assert.equal(h.phase, "unconfigured");
  assert.deepEqual(told, []);
});

test("only a confirmed change goes past the throttle; ordinary redraws keep it", async () => {
  const d = disk("connected", "absent");
  const { h, clock } = watched(d.scan);
  await h.verify({ force: true });
  assert.equal(d.state.scans, 1);
  clock.now += 3_000;                           // inside the 10 s
  await h.verify();
  await h.verify();
  assert.equal(d.state.scans, 1, "redraws are throttled");
  await h.configurationChanged();
  assert.equal(d.state.scans, 2, "a change is not");
  clock.now += MIN_REVERIFY_MS + 1;
  await h.verify();
  assert.equal(d.state.scans, 3, "and ordinary checks resume after the interval");
});

test("an older scan still running when the apply lands cannot overwrite the newer status — in either order", async () => {
  for (const olderFirst of [false, true]) {
    const before = deferred<ConnectScan | null>();   // began before the apply: read the OLD files
    const after = deferred<ConnectScan | null>();
    const queue = [before, after];
    const { h } = watched(() => queue.shift()!.promise);
    const older = h.verify({ force: true });
    const newer = h.configurationChanged();
    if (olderFirst) {
      before.resolve(scanOf("absent", "absent"));
      await older;
      assert.notEqual(h.phase, "unconfigured", "the old answer is not believed even before the new one is in");
      after.resolve(scanOf("connected", "connected"));
      await newer;
    } else {
      after.resolve(scanOf("connected", "connected"));
      await newer;
      before.resolve(scanOf("absent", "absent"));
      await older;
    }
    assert.equal(h.phase, "ready", `olderFirst=${olderFirst}`);
  }
});

test("unknown after a failed first scan gets one retry, a moment later, and no more", async () => {
  let attempts = 0;
  const { h, scheduled } = watched(async () => { attempts += 1; return null; });
  await h.verify({ force: true });
  assert.equal(h.phase, "unknown");
  assert.equal(phaseNeedsSettings(h.phase), false);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]!.ms, UNKNOWN_RETRY_MS);
  scheduled[0]!.run();                          // the timer fires
  await h.verify();                             // (joins the retry in flight, or is throttled: still no extra work)
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 2, "exactly one retry");
  assert.equal(h.phase, "unknown", "still not a finding");
  assert.equal(scheduled.length, 1, "and it does not arm another");
});

test("the retry that succeeds settles the phase; one that was overtaken does nothing", async () => {
  let fail = true;
  const d = disk("connected", "absent");
  const { h, scheduled } = watched(async () => (fail ? null : d.scan()));
  await h.verify({ force: true });
  assert.equal(h.phase, "unknown");
  fail = false;
  scheduled[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.phase, "ready");

  // A new setup before the timer fires makes the waiting retry moot.
  let attempts = 0;
  const second = watched(async () => { attempts += 1; return null; });
  await second.h.verify({ force: true });
  assert.equal(second.scheduled.length, 1);
  second.h.configure("Standalone", async () => { attempts += 100; return null; });
  second.scheduled[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 1, "the retry for the old setup did not run");
});

test("a failed check after something was confirmed schedules no retry", async () => {
  let fail = false;
  const d = disk("connected", "absent");
  const { h, scheduled } = watched(async () => (fail ? null : d.scan()));
  await h.verify({ force: true });
  fail = true;
  await h.verify({ force: true });
  assert.equal(h.phase, "ready");
  assert.equal(scheduled.length, 0);
});

test("a change re-arms the one retry for the new situation", async () => {
  const { h, scheduled } = watched(async () => null);
  await h.verify({ force: true });
  assert.equal(scheduled.length, 1);
  await h.configurationChanged();
  assert.equal(scheduled.length, 2, "a confirmed change deserves its own single retry");
  assert.equal(scheduled[1]!.ms, UNKNOWN_RETRY_MS);
});

test("wiring: Rust announces only after the files are written; the island answers with the unthrottled check", async () => {
  const rust = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const apply = rust.slice(rust.indexOf("fn connect_apply("));
  const applied = apply.indexOf("let applied = connect_plan::apply_preview(&reviewed, codex_trust_approved, None)?;");
  const emitted = apply.indexOf('"integrations-changed"');
  assert.ok(applied > 0 && emitted > applied, "the event is after the apply, which returns early on any error (?)");
  assert.match(apply, /app\.emit_to\(\s*island::WINDOW_LABEL,\s*"integrations-changed"/);
  assert.ok(emitted < apply.indexOf("Ok(applied)"));
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(mainSource, /onEvent<string>\("integrations-changed", \(\) => void integrationHealth\.configurationChanged\(\)\)/);
  // The Settings flow itself is untouched: still the same apply, backups and fingerprints.
  const settings = await readFile(new URL("../src/settings/main.ts", import.meta.url), "utf8");
  assert.match(settings, /await nook\.connectApply\(preview\.previewId, preview\.approvedDevScopes, preview\.codexTrustRequired, preview\.requiresOriginalMigration, true\)/);
});

// ── A failed post-change scan gets its one retry (also from an already confirmed phase) ──────────

/** A scan the test fails on demand; otherwise it reads the mutable `disk`. */
function flaky(d: ReturnType<typeof disk>) {
  const state = { fail: false, calls: [] as (boolean | undefined)[] };
  return {
    state,
    scan: async (options?: { fresh?: boolean }) => {
      state.calls.push(options?.fresh);
      return state.fail ? null : d.scan();
    },
  };
}

test("ready -> a failed post-change scan keeps ready, then the retry brings the truth", async () => {
  const d = disk("connected", "connected");
  const f = flaky(d);
  const { h, scheduled } = watched(f.scan);
  await h.verify({ force: true });
  assert.equal(h.phase, "ready");
  d.state.claude = "absent"; d.state.codex = "absent";     // both disconnected
  f.state.fail = true;
  await h.configurationChanged();
  assert.equal(h.phase, "ready", "a failed scan is not 'disconnected': the confirmed state stands");
  assert.equal(phaseNeedsSettings(h.phase), false);
  assert.equal(scheduled.length, 1, "exactly one retry is armed");
  assert.equal(scheduled[0]!.ms, UNKNOWN_RETRY_MS);
  f.state.fail = false;
  scheduled[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.phase, "unconfigured");
  assert.equal(phaseNeedsSettings(h.phase), true, "the link appears once the retry reads the files");
  assert.deepEqual(f.state.calls.slice(-2), [true, true], "the retry is fresh like the check it repeats");
});

test("unconfigured -> failed post-change scan -> retry succeeds and the link disappears", async () => {
  const d = disk("absent", "absent");
  const f = flaky(d);
  const { h, scheduled } = watched(f.scan);
  await h.verify({ force: true });
  assert.equal(phaseNeedsSettings(h.phase), true);
  d.state.codex = "connected";
  f.state.fail = true;
  await h.configurationChanged();
  assert.equal(h.phase, "unconfigured", "nothing new is known yet");
  assert.equal(scheduled.length, 1);
  f.state.fail = false;
  scheduled[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.phase, "ready");
  assert.equal(phaseNeedsSettings(h.phase), false);
});

test("needs_attention -> failed scan -> retry succeeds", async () => {
  const d = disk("incomplete", "absent");
  const f = flaky(d);
  const { h, scheduled } = watched(f.scan);
  await h.verify({ force: true });
  assert.equal(h.phase, "needs_attention");
  d.state.claude = "connected";                              // repaired
  f.state.fail = true;
  await h.configurationChanged();
  assert.equal(h.phase, "needs_attention");
  f.state.fail = false;
  scheduled[0]!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.phase, "ready");
});

test("a retry waiting for a failed post-change scan is cancelled by a newer configuration change", async () => {
  const d = disk("absent", "absent");
  const f = flaky(d);
  const { h, scheduled } = watched(f.scan);
  await h.verify({ force: true });
  d.state.claude = "connected";
  f.state.fail = true;
  await h.configurationChanged();                            // fails: retry #1 armed
  assert.equal(scheduled.length, 1);
  f.state.fail = false;
  d.state.codex = "connected";
  await h.configurationChanged();                            // a newer change, answered
  assert.equal(h.phase, "ready");
  const scansBefore = d.state.scans;
  scheduled[0]!.run();                                       // the old retry's timer fires
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(d.state.scans, scansBefore, "the old retry did nothing");
});

test("the bounded retry that fails too is the last: no second retry, no polling", async () => {
  const d = disk("connected", "absent");
  const f = flaky(d);
  const { h, scheduled } = watched(f.scan);
  await h.verify({ force: true });
  f.state.fail = true;
  await h.configurationChanged();
  assert.equal(scheduled.length, 1);
  scheduled[0]!.run();                                       // the retry fails as well
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.phase, "ready", "still the last confirmed state");
  assert.equal(scheduled.length, 1, "nothing further is armed");
  // Ordinary checks later do not conjure retries either.
  await h.verify({ force: true });
  assert.equal(scheduled.length, 1);
});

test("each confirmed change gets its own single retry, and no more than one", async () => {
  const d = disk("connected", "absent");
  const f = flaky(d);
  const { h, scheduled } = watched(f.scan);
  await h.verify({ force: true });
  f.state.fail = true;
  await h.configurationChanged();
  await h.configurationChanged();
  assert.equal(scheduled.length, 2, "one per change");
  scheduled[1]!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduled.length, 2);
});

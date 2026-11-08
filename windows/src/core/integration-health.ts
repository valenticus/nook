// Whether Nook's agent integrations are set up, as the empty Home view needs to know it.
//
// "No active sessions" says nothing of the integrations: an agent that is
// connected and idle looks exactly like one that is not connected. So the view
// asks the same read-only Connect inventory Settings → Connect shows
// (`connect_scan`, through `summarizeAgentConnection`) and shows a way to
// Settings only when that says something is wrong that the user can act on.
//
// Three different things are kept apart, and only the first decides health:
//   - CONFIGURED: this build's hooks are in the agent's config and complete;
//   - DETECTED: the agent's CLI was found on PATH (informational);
//   - DELIVERING: a real hook event has been received (informational — an idle
//     agent has sent none, and "no event yet" is not "broken").
//
//   checking         verification has not finished: nothing is known, so nothing is claimed
//   ready            at least one integration is configured and healthy (sessions may simply be idle)
//   unconfigured     no supported integration is configured at all
//   needs_attention  an integration is configured but broken in a way Connect can repair
//   unknown          verification ran and gave no answer: not a finding, so no claim either
//
// The view shows a troubleshooting link for `unconfigured` and `needs_attention` only.

import type { ConnectAgent, ConnectDeliveryState, ConnectScan } from "./bridge";
import { summarizeAgentConnection, type AgentConnectionState, type ConnectBuild } from "./connect-status";

export type IntegrationPhase = "checking" | "ready" | "unconfigured" | "needs_attention" | "unknown";

export const SUPPORTED_AGENTS: readonly ConnectAgent[] = ["ClaudeCode", "Codex"];

export interface AgentHealth {
  /** The CLI is on PATH. Informational: it never makes an agent healthy or broken. */
  detected: boolean;
  /** Whether this build's hooks are in place and complete. The only thing that decides health. */
  state: AgentConnectionState;
  /** Whether a real event has arrived. Informational: an idle agent has sent none. */
  delivery: ConnectDeliveryState;
}

export interface IntegrationReport {
  phase: "ready" | "unconfigured" | "needs_attention";
  agents: Record<ConnectAgent, AgentHealth>;
}

/**
 * Health from a finished inventory. An agent that is simply not connected is
 * optional — it is a failure only when nothing at all is connected.
 */
export function assessIntegrations(scan: ConnectScan, build: ConnectBuild): IntegrationReport {
  const agents = {} as Record<ConnectAgent, AgentHealth>;
  for (const agent of SUPPORTED_AGENTS) {
    const summary = summarizeAgentConnection(scan, agent, build);
    agents[agent] = { detected: scan.detectedAgents.includes(agent), state: summary.state, delivery: summary.delivery };
  }
  const states = SUPPORTED_AGENTS.map((agent) => agents[agent].state);
  const phase = states.includes("Needs repair") ? "needs_attention" : states.includes("Connected") ? "ready" : "unconfigured";
  return { phase, agents };
}

/** Only a finding the user can act on earns a way to Settings; checking and unknown never do. */
export const phaseNeedsSettings = (phase: IntegrationPhase): boolean => phase === "unconfigured" || phase === "needs_attention";

/** How soon an already-verified answer may be asked for again when the empty view comes back. */
export const MIN_REVERIFY_MS = 10_000;
/** One more try, this long after a first check that found nothing out (never a loop). */
export const UNKNOWN_RETRY_MS = 3_000;

type Schedule = (run: () => void, ms: number) => void;

/** `fresh`: must not be an answer to a scan that began before now (the files were just changed). */
type Scan = (options?: { fresh?: boolean }) => Promise<ConnectScan | null>;

/**
 * Verifies the integrations and keeps the answer. One shared instance; the view
 * reads `phase` and is told when it changes.
 *
 * Ordering: every verification gets a number, and an answer is used only if no
 * newer verification has been answered already, so a slow old scan cannot
 * undo a newer result. A failed verification keeps what was last confirmed.
 */
export class IntegrationHealth {
  private scanFn: Scan | null = null;
  private build: ConnectBuild | null = null;
  private current: IntegrationPhase = "checking";
  private currentReport: IntegrationReport | null = null;
  private issued = 0;
  private answered = 0;
  private inFlight: Promise<void> | null = null;
  private lastStartedAt = -Infinity;
  private readonly listeners = new Set<() => void>();
  private readonly clock: () => number;
  private readonly schedule: Schedule;
  /** The one retry after an unknown result has been used (or is waiting); until a change or a new setup. */
  private retried = false;
  /** Bumped by anything that makes a waiting retry moot. */
  private retryToken = 0;

  constructor(clock: () => number = () => Date.now(), schedule: Schedule = (run, ms) => { setTimeout(run, ms); }) {
    this.clock = clock;
    this.schedule = schedule;
  }

  get phase(): IntegrationPhase {
    return this.current;
  }

  get report(): IntegrationReport | null {
    return this.currentReport;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Says which build is running and how to scan. Starts over: what was learnt
   * for another build says nothing about this one, and an answer still on its
   * way for the old setup is discarded when it arrives.
   */
  configure(build: ConnectBuild, scan: Scan | null) {
    this.build = build;
    this.scanFn = scan;
    this.issued += 1;
    this.answered = this.issued;
    this.inFlight = null;
    this.lastStartedAt = -Infinity;
    this.currentReport = null;
    this.retried = false;
    this.retryToken += 1;
    // The Dev build does not inspect integrations: it has nothing to check, and nothing to say.
    this.set(scan && build !== "Dev" ? "checking" : "unknown");
  }

  /**
   * Starts a verification. Asked again while one is running, it joins that one;
   * asked again soon after one finished, it does nothing (`force` asks anyway).
   * Safe to call from a draw: the early exits cost nothing.
   */
  verify(options: { force?: boolean; changed?: boolean; fresh?: boolean } = {}): Promise<void> {
    const scan = this.scanFn;
    const build = this.build;
    if (!scan || !build || build === "Dev") return Promise.resolve();
    const now = this.clock();
    if (!options.force) {
      if (this.inFlight) return this.inFlight;
      if (now - this.lastStartedAt < MIN_REVERIFY_MS) return Promise.resolve();
    }
    this.lastStartedAt = now;
    const id = ++this.issued;
    if (options.changed) {
      // A confirmed change in the configuration: whatever is still being scanned began before it and
      // may have read the old files — it is not to be believed once it comes back.
      this.answered = id;
      this.retried = false;
      this.retryToken += 1;
    }
    const run = (async () => {
      let found: ConnectScan | null = null;
      try {
        found = await (options.changed || options.fresh ? scan({ fresh: true }) : scan());
      } catch {
        found = null;
      }
      if (id < this.answered) return; // a newer verification has already been answered
      this.answered = id;
      if (found) {
        const report = assessIntegrations(found, build);
        this.currentReport = report;
        this.set(report.phase);
      } else {
        if (this.current === "checking" || this.current === "unknown") {
          // Nothing was ever confirmed and nothing came back: unknown — not a finding.
          this.set("unknown");
        }
        // Otherwise a check failed after something was confirmed: that still stands — a failed scan
        // is not "disconnected". Either way a check that found nothing out gets one more try, and
        // so does a post-change check, since the change is exactly when the old answer is least safe.
        if (this.current === "unknown" || options.changed) this.retryOnce(options.changed === true || options.fresh === true);
      }
    })().finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /**
   * The configuration was changed on purpose and the change went through (Connect or Disconnect applied
   * in Settings). Checked at once, whatever the throttle, and an older scan still running is discarded.
   * Not for redraws: those keep the throttle.
   */
  configurationChanged(): Promise<void> {
    return this.verify({ force: true, changed: true });
  }

  /** After a first check that found nothing out, one more try a moment later. Never a second. */
  private retryOnce(fresh: boolean) {
    if (this.retried) return;
    this.retried = true;
    const token = this.retryToken;
    // A retry after a failed post-change scan is fresh too, but it is NOT a "change": it must not
    // give itself another retry.
    this.schedule(() => {
      if (token === this.retryToken) void this.verify({ force: true, fresh });
    }, UNKNOWN_RETRY_MS);
  }

  private set(phase: IntegrationPhase) {
    if (phase === this.current) return;
    this.current = phase;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The one the app uses: configured and started by main.ts, read by the empty Home view. */
export const integrationHealth = new IntegrationHealth();

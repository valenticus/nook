import { Bridge, onEvent, type ConnectScan } from "./bridge";

let snapshot: ConnectScan | null = null;
/** The scan that is reading the files now. */
let inFlight: Promise<ConnectScan | null> | null = null;
/** A scan asked for as FRESH while another was running: it starts when that one ends, and not before. */
let queuedFresh: Promise<ConnectScan | null> | null = null;
let started = false;
const subscribers = new Set<(scan: ConnectScan | null) => void>();

function publish(scan: ConnectScan | null) {
  snapshot = scan;
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

function startScan(): Promise<ConnectScan | null> {
  const run: Promise<ConnectScan | null> = Bridge.connectScan().then((scan) => {
    if (scan) publish(scan);
    return scan;
  }).finally(() => { if (inFlight === run) inFlight = null; });
  inFlight = run;
  return run;
}

/**
 * Reads the Connect inventory. Callers share one scan: asked while one is running, they get that one.
 *
 * `fresh` is for a caller that KNOWS the files have changed since — a Connect or Disconnect just applied
 * — and so must not be given a scan that began before the change (it may have read the old files). Such
 * a request waits for the running scan to finish and then makes its own, so two scans never read the
 * files at once; any number of fresh requests made meanwhile share that one. Ordinary callers that come
 * along while it is waiting (including the instant between the running scan ending and the queued one\n * beginning) also join it, as it is the newest. Scans therefore finish in the order they
 * began, and a stale inventory can never be published after a newer one.
 */
export function refreshConnectScan(options: { fresh?: boolean } = {}): Promise<ConnectScan | null> {
  // First, before `inFlight` is looked at: a queued fresh scan exists from the moment it is asked for
  // until the moment it begins, and in the instant between the running scan ending (it clears
  // `inFlight` as it settles) and the queued one starting, `inFlight` is empty. A request in that
  // instant must join the queued scan — whether it is ordinary or fresh — not start one of its own.
  if (queuedFresh) return queuedFresh;
  if (!inFlight) return startScan();
  if (!options.fresh) return inFlight;
  const begin = () => {
    queuedFresh = null; // from here on it is running, and a later change needs another scan
    return startScan();
  };
  const queued: Promise<ConnectScan | null> = inFlight.then(begin, begin);
  queuedFresh = queued;
  return queued;
}

export function subscribeConnectScan(subscriber: (scan: ConnectScan | null) => void): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot);
  if (!started) {
    started = true;
    void refreshConnectScan();
    void onEvent("hook", () => { void refreshConnectScan(); });
    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => { void refreshConnectScan(); });
      window.setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void refreshConnectScan();
      }, 30_000);
    }
  }
  return () => subscribers.delete(subscriber);
}

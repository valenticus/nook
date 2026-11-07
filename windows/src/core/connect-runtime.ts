import { Bridge, onEvent, type ConnectScan } from "./bridge";

let snapshot: ConnectScan | null = null;
let refresh: Promise<ConnectScan | null> | null = null;
let started = false;
const subscribers = new Set<(scan: ConnectScan | null) => void>();

function publish(scan: ConnectScan | null) {
  snapshot = scan;
  subscribers.forEach((subscriber) => subscriber(snapshot));
}

export async function refreshConnectScan(): Promise<ConnectScan | null> {
  if (refresh) return refresh;
  refresh = Bridge.connectScan().then((scan) => {
    if (scan) publish(scan);
    return scan;
  }).finally(() => { refresh = null; });
  return refresh;
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

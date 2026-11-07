import type { SessionAgent } from "./state";

// Stop can be delivered more than once. Keep only the latest turn identity for
// each session in memory: completion cards and their dedupe state never survive
// an application restart.
const completedTurns = new Map<string, string>();

const sessionKey = (agent: SessionAgent, sessionId: string) => `${agent}:${sessionId}`;

export function hasCompletionEvent(agent: SessionAgent, sessionId: string, eventKey: string): boolean {
  return completedTurns.get(sessionKey(agent, sessionId)) === eventKey;
}

export function recordCompletionEvent(agent: SessionAgent, sessionId: string, eventKey: string): boolean {
  const key = sessionKey(agent, sessionId);
  if (completedTurns.get(key) === eventKey) return false;
  completedTurns.set(key, eventKey);
  if (completedTurns.size > 512) completedTurns.delete(completedTurns.keys().next().value!);
  return true;
}

/** A new prompt starts a new turn and permits an identical reply to complete again. */
export function beginCompletionTurn(agent: SessionAgent, sessionId: string): void {
  completedTurns.delete(sessionKey(agent, sessionId));
}

/** Remove only the legacy completion inbox key; other saved settings stay intact. */
export function clearLegacyCompletionNotifications(): void {
  try {
    globalThis.localStorage?.removeItem("nook.completion-notifications.dev.v1");
    globalThis.localStorage?.removeItem("nook.completion-notifications.production.v1");
  } catch {
    // Storage may be unavailable in a restricted WebView.
  }
}

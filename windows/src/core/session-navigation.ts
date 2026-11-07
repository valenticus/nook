import type { ClaudeSession } from "./state";

const navigating = new WeakSet<ClaudeSession>();

/** A true result means the target window was focused or its launcher accepted the folder. */
export async function navigateToSessionTarget(
  session: ClaudeSession,
  navigate: (sessionId: string) => Promise<boolean | null>,
): Promise<boolean> {
  if (navigating.has(session)) return false;
  navigating.add(session);
  try {
    return (await navigate(session.id)) === true;
  } catch {
    return false;
  } finally {
    navigating.delete(session);
  }
}

export type UsageAgent = "claude" | "codex";

export const COMPACT_USAGE_ROTATION_MS = 5_000;
const ORDER: readonly UsageAgent[] = ["claude", "codex"];

/**
 * When both quota snapshots are usable, pin the folded Island to the sole
 * provider with a live turn. With both or neither active, keep the normal
 * rotation. Availability takes precedence, so a single usable provider never
 * rotates and an empty set leaves the caller's existing fallback untouched.
 */
export function compactUsageAgentsForActivity(
  available: readonly UsageAgent[],
  active: readonly UsageAgent[],
): UsageAgent[] {
  const usable = ORDER.filter((agent) => available.includes(agent));
  if (usable.length !== 2) return usable;
  const activeUsable = ORDER.filter((agent) => active.includes(agent) && usable.includes(agent));
  return activeUsable.length === 1 ? activeUsable : usable;
}

/**
 * While the folded Island is hovered, hold the provider on show: a change in
 * activity takes effect once the pointer leaves. If the shown provider's quota
 * stops being usable, the regular selection and its fallback apply at once.
 */
export function compactUsageAgentsWhileHovered(
  next: readonly UsageAgent[],
  usable: readonly UsageAgent[],
  shown: UsageAgent,
  hovered: boolean,
): readonly UsageAgent[] {
  return hovered && usable.includes(shown) ? [shown] : next;
}

export interface CompactUsageCycle {
  configure(available: readonly UsageAgent[], visible: boolean, hovered: boolean): void;
  current(): UsageAgent;
  destroy(): void;
}

/** A single one-shot timer for the folded usage slots. No polling and no catch-up after a pause. */
export function createCompactUsageCycle(
  changed: (agent: UsageAgent) => void,
  schedule: (callback: () => void, delay: number) => number = (callback, delay) => window.setTimeout(callback, delay),
  cancel: (id: number) => void = (id) => window.clearTimeout(id),
): CompactUsageCycle {
  let available: UsageAgent[] = [];
  let agent: UsageAgent = "claude";
  let visible = false;
  let hovered = false;
  let timer: number | null = null;
  let destroyed = false;

  const stop = () => {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  };

  const canRotate = () => !destroyed && visible && !hovered && available.length === 2;
  const start = () => {
    if (timer != null || !canRotate()) return;
    timer = schedule(() => {
      timer = null;
      if (!canRotate()) return;
      agent = agent === "claude" ? "codex" : "claude";
      changed(agent);
      start();
    }, COMPACT_USAGE_ROTATION_MS);
  };

  return {
    configure(next, isVisible, isHovered) {
      if (destroyed) return;
      const normalized = ORDER.filter((candidate) => next.includes(candidate));
      const listChanged = normalized.join("|") !== available.join("|");
      const gateChanged = isVisible !== visible || isHovered !== hovered;
      if (listChanged) {
        stop();
        available = normalized;
        const nextAgent = available.length === 1 ? available[0]! : available.includes(agent) ? agent : "claude";
        agent = nextAgent;
      }
      visible = isVisible;
      hovered = isHovered;
      if (gateChanged && (!visible || hovered)) stop();
      start();
    },
    current: () => agent,
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      available = [];
    },
  };
}

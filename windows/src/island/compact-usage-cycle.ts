export type UsageAgent = "claude" | "codex";

export const COMPACT_USAGE_ROTATION_MS = 5_000;
const ORDER: readonly UsageAgent[] = ["claude", "codex"];

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

/** Keeps each agent's latest preview request authoritative. */
export function createConnectPreviewGate<Agent extends string>() {
  const generations = new Map<Agent, number>();
  return {
    begin(agent: Agent): number {
      const next = (generations.get(agent) ?? 0) + 1;
      generations.set(agent, next);
      return next;
    },
    isCurrent(agent: Agent, token: number): boolean {
      return generations.get(agent) === token;
    },
    cancel(agent: Agent, token?: number): void {
      if (token !== undefined && generations.get(agent) !== token) return;
      generations.set(agent, (generations.get(agent) ?? 0) + 1);
    },
  };
}

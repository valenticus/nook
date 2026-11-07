// Which tool a session belongs to, shown the same way wherever a session
// appears: a mark and a name. State colours say what a session is doing and are
// never used for this.

import type { SessionAgent } from "../core/state";
import { BRANDS, CLAUDE_MARK, LUCIDE, OPENAI_BRAND_MARK, brand, lucide } from "./iconset";
import { h } from "./dom";

export const TOOL_NAME: Record<SessionAgent, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex", unknown: "Unknown" };

/** Claude's warm orange; Cursor's and Codex's marks are the plain text colour. */
export const CLAUDE_ORANGE = "#D97757";

/** Shared agent identity mark mapping; tool-step icons remain separate. */
export function toolMarkAsset(agent: SessionAgent): { kind: "brand" | "lucide"; path: string } {
  if (agent === "cursor") return { kind: "brand", path: BRANDS.cursor };
  if (agent === "codex") return { kind: "brand", path: OPENAI_BRAND_MARK };
  if (agent === "unknown") return { kind: "lucide", path: LUCIDE.info };
  return { kind: "lucide", path: CLAUDE_MARK };
}

/** What the folded island's legend says, for the tooltip. */
export const DOT_LEGEND = "Solid dot: Claude Code or Codex · Ringed dot: Cursor";

/** The agent's mark at `size`: Claude's orange symbol, or the monochrome Cursor/OpenAI brand mark. */
export function toolMark(agent: SessionAgent, size = 12): HTMLElement {
  const mark = toolMarkAsset(agent);
  const svg = mark.kind === "brand" ? brand(mark.path, size) : lucide(mark.path, size, agent === "unknown" ? 2 : 2.4);
  if (agent === "claude") svg.style.color = CLAUDE_ORANGE;
  const el = h("span", { class: `tool-mark ${agent}`, title: TOOL_NAME[agent], role: "img", "aria-label": TOOL_NAME[agent] });
  el.append(svg);
  return el;
}

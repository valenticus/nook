import type { ConnectAgent, ConnectPreview, ConnectScan } from "../core/bridge";

function pathKey(path: string): string {
  return path.replaceAll("/", "\\").replaceAll(/\\+/g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** Compares the exact files represented by a preview with the latest read-only scan. */
export function connectPreviewIsFresh(preview: ConnectPreview, scan: ConnectScan, agent: ConnectAgent): boolean {
  const planned = preview.files.filter((file) => file.agent === agent);
  const plannedPaths = new Set(planned.map((file) => pathKey(file.path)));

  for (const file of planned) {
    const current = scan.configs.find((config) => config.agent === agent && pathKey(config.path) === pathKey(file.path));
    if (!current || current.status !== file.status || (current.fingerprint ?? null) !== (file.fingerprint ?? null)) return false;
  }

  // Connect/Repair plans must account for every supported config candidate;
  // Disconnect may omit scopes it proved contain no Standalone-owned records.
  if (preview.operation !== "Disconnect" && scan.configs.some((config) => config.agent === agent && !plannedPaths.has(pathKey(config.path)))) return false;

  // A newly added Standalone-owned scope also invalidates a Disconnect plan.
  if (scan.hooks.some((hook) => hook.agent === agent && hook.ownership === "StandaloneNook" && !plannedPaths.has(pathKey(hook.configPath)))) return false;
  return true;
}

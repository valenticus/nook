export type ReduceMotionSetting = "system" | "on" | "off";

/** Resolve the saved choice without coupling callers to a particular OS API. */
export function reduceMotionEnabled(choice: ReduceMotionSetting, systemPrefersReducedMotion: boolean): boolean {
  if (choice === "on") return true;
  if (choice === "off") return false;
  return systemPrefersReducedMotion;
}

// Lets node load the app's TypeScript as it is written: its relative imports
// carry no extension. Registered by gullu-color.test.ts's own command line.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL && !/\.[cm]?[jt]s$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
}

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (url.endsWith(".ts") && loaded.source) {
    let source = String(loaded.source).replaceAll("import.meta.env", "({ DEV: false })");
    if (url.includes("/src/")) source = source
      .replaceAll("__NOOK_DEV_BUILD__", "(globalThis.__nookDevBuildFlag ?? false)")
      .replaceAll("__NOOK_STANDALONE_BUILD__", "(globalThis.__nookStandaloneBuildFlag ?? false)");
    return {
      ...loaded,
      source,
    };
  }
  return loaded;
}

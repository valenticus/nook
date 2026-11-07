import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vite = resolve(root, "node_modules/vite/bin/vite.js");
const result = spawnSync(process.execPath, [vite, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, NOOK_DEV_BUILD: "0", NOOK_STANDALONE_BUILD: "0" },
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

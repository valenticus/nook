import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const testsDir = resolve(packageDir, "tests");
const testFiles = readdirSync(testsDir)
  .filter((name) => /\.test\.(?:ts|mjs)$/.test(name))
  .sort()
  .map((name) => resolve(testsDir, name));

if (testFiles.length === 0) {
  console.error("No frontend test files found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  "--import",
  "./tests/frontend-test-register.mjs",
  "--test",
  ...testFiles,
], { cwd: packageDir, stdio: "inherit", env: process.env });

if (result.error) throw result.error;
process.exit(result.status ?? 1);

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const testScript = join(scriptsDir, "test-dev-build-artifact.ps1");
const windowsPowerShell = "powershell.exe";
const args = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", testScript];

function run(executable, label, required) {
  const result = spawnSync(executable, args, { cwd: join(scriptsDir, ".."), encoding: "utf8", windowsHide: true });
  if (result.error) {
    if (!required && result.error.code === "ENOENT") {
      console.log(`${label}: not installed; skipped.`);
      return;
    }
    throw result.error;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${label} artifact-copy test failed with exit code ${result.status}.`);
}

if (process.platform !== "win32") throw new Error("Dev artifact tests require Windows PowerShell.");
run(windowsPowerShell, "Windows PowerShell 5.1", true);
run("pwsh.exe", "PowerShell 7", false);

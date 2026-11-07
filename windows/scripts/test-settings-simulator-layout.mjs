import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = process.argv[2] ?? "settings-simulator-layout.html";
const query = process.env.NOOK_UI_QUERY ?? "";
const portNumber = fixture === "settings-simulator-layout.html" ? 1429 : 1428;
const base = `http://127.0.0.1:${portNumber}`;
const candidates = [
  process.env.CHROME_PATH,
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).flatMap((dir) => [
    join(dir, "Microsoft/Edge/Application/msedge.exe"), join(dir, "Google/Chrome/Application/chrome.exe"),
  ]),
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
].filter(Boolean);
const browser = candidates.find((path) => existsSync(path));
if (!browser) throw new Error("Home/Settings UI layout tests need Chrome or Edge. Set CHROME_PATH to its executable.");

const server = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(portNumber), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
  env: { ...process.env, NOOK_DEV_BUILD: "1" },
});
const profile = mkdtempSync(join(tmpdir(), "nook-ui-layout-test-"));
let browserProcess;
let socket;
const timeout = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(`${base}/tests/${fixture}`)).ok; } catch { /* wait for Vite */ }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error(`Vite did not serve the ${fixture} fixture.`);

  browserProcess = spawn(browser, [
    "--headless=new", "--disable-gpu", "--disable-gpu-shader-disk-cache", "--disable-gpu-program-cache",
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let browserErrors = "";
  browserProcess.stderr.setEncoding("utf8").on("data", (chunk) => { browserErrors += chunk; });
  let port;
  for (let attempt = 0; attempt < 80 && !port; attempt++) {
    try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null; } catch { /* wait for Chrome */ }
    if (!port) await delay(100);
  }
  if (!port) throw new Error(`Headless Chrome did not start its DevTools endpoint.\n${browserErrors.slice(-2000)}`);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((target) => target.type === "page");
  if (!page) throw new Error("Headless Chrome has no page target.");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await timeout(new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }),
    5_000, "Headless browser DevTools WebSocket did not open.");
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  });
  const send = (method, params = {}) => timeout(new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  }), 5_000, `Headless browser timed out on ${method}.`);
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: fixture === "home-usage-layout.html" ? 900 : 390, height: 720, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/tests/${fixture}${query ? `?${query}` : ""}` });
  let detail = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    await delay(100);
    const result = await send("Runtime.evaluate", {
      expression: "({ status: document.querySelector('#test-result')?.dataset.testResult, detail: document.querySelector('#test-result')?.textContent })",
      returnByValue: true,
    });
    const value = result.result?.value;
    if (value?.status === "pass" || value?.status === "fail") { detail = value.detail; break; }
  }
  if (!detail || !JSON.parse(detail).ok) throw new Error(`${fixture} DOM/layout test failed.\n${detail || "The page did not complete its DOM checks."}`);
  console.log(`${fixture}${query ? `?${query}` : ""} DOM/layout: ${detail}`);
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  browserProcess?.kill();
  server.kill();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

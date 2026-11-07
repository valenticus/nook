import "../src/settings/settings.css";
import "../src/dev-simulator.css";
import { createDevSimulatorControl } from "../src/dev-simulator";

const host = document.querySelector<HTMLElement>("#simulator-host")!;
const pane = document.querySelector<HTMLElement>("#connect-pane")!;
host.append(createDevSimulatorControl());

const expected = [
  "Start Claude", "Start Codex", "Start both",
  "Claude: prompt + tool", "Codex: prompt + tool",
  "Claude: permission (8 s)", "Codex: permission (8 s)",
  "Stop Claude turn", "Stop Codex turn",
  "End Claude session", "End Codex session", "Clear simulated sessions",
];

function check() {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
  const missing = expected.filter((label) => !buttons.some((button) => button.textContent?.trim() === label));
  const unavailable = buttons.filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return !rect.width || !rect.height || style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
  });
  const last = buttons.at(-1);
  const scrollable = pane.scrollHeight > pane.clientHeight;
  if (scrollable && last) pane.scrollTop = pane.scrollHeight;
  const lastAfterScroll = last?.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const lastReachable = !!lastAfterScroll && lastAfterScroll.bottom <= paneRect.bottom && lastAfterScroll.top >= paneRect.top;
  const ok = !missing.length && !unavailable.length && buttons.length === expected.length && scrollable && lastReachable;
  const detail = { ok, buttonCount: buttons.length, expected: expected.length, missing, unavailable: unavailable.length, scrollable, lastReachable, paneWidth: pane.clientWidth };
  const output = document.querySelector<HTMLElement>("#test-result")!;
  output.dataset.testResult = ok ? "pass" : "fail";
  output.textContent = JSON.stringify(detail);
  (window as typeof window & { __shotReady?: boolean }).__shotReady = true;
}

requestAnimationFrame(check);

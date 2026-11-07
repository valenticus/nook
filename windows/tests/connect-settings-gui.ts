const result = document.querySelector<HTMLElement>("#test-result")!;
const params = new URLSearchParams(location.search);
const scenario = params.get("connect") ?? "none";
const mode = params.get("mode") ?? "original";

const fail = (message: string): never => { throw new Error(message); };
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}
const delay = (ms = 80) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function run() {
  let cards: NodeListOf<HTMLElement> | null = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    cards = document.querySelectorAll<HTMLElement>("#pane-connect .sp-connect-card");
    if (cards.length === 2) break;
    await delay();
  }
  assert(cards?.length === 2, "Expected exactly two agent cards");
  const claude = cards![0]!;
  const codex = cards![1]!;
  assert(claude.getAttribute("aria-label") === "Claude Code connection", "Claude card is missing or mislabelled");
  assert(codex.getAttribute("aria-label") === "Codex connection", "Codex card is missing or mislabelled");

  const expected: Record<string, string> = {
    none: "Not connected", configured: "Configured", receiving: "Configured", repair: "Needs repair",
    original: "Not connected", dev: "Not connected", mixed: "Configured", "relay-missing": "Not connected",
  };
  assert(claude.textContent?.includes(expected[scenario] ?? "Not connected"), `Unexpected Claude status for ${scenario}`);
  assert(codex.textContent?.includes(expected[scenario] ?? "Not connected"), `Unexpected Codex status for ${scenario}`);
  assert(claude.getBoundingClientRect().width > 0 && codex.getBoundingClientRect().width > 0, "Agent cards must have visible dimensions");
  assert(document.querySelectorAll("#pane-connect .sp-tool.cursor").length === 0, "Cursor must not be part of the Connect UI");
  if (scenario === "receiving") assert(claude.textContent?.includes("Receiving events"), "Real receiving state was not shown");
  if (scenario === "repair") assert(claude.textContent?.includes("Repair"), "Repair action is missing");
  if (scenario === "configured") assert(claude.textContent?.includes("Disconnect") && claude.textContent.includes("Repair"), "Configured actions are missing");
  if (scenario === "relay-missing") assert(claude.textContent?.includes("Standalone relay is not installed yet"), "Missing relay guidance is absent");

  const action = claude.querySelector<HTMLButtonElement>(".sp-connect-actions button");
  assert(action, "The expected primary action is missing");
  action.click();
  for (let attempt = 0; attempt < 40 && !claude.querySelector(".sp-connect-preview"); attempt++) await delay();
  const preview = claude.querySelector<HTMLElement>(".sp-connect-preview");
  assert(preview, "Action did not open a preview");
  if (["configured", "repair", "original", "dev", "mixed"].includes(scenario)) {
    assert(preview.querySelector("details summary"), "Preview is missing file and scope details");
    preview.querySelector("details summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  if (scenario === "original") assert(preview.textContent?.includes("Original Nook") && preview.textContent.includes("I approve migrating"), "Original ownership or migration confirmation is missing");
  if (scenario === "dev") {
    assert(preview.textContent?.includes("Nook Dev hooks"), "Dev scope confirmation is missing");
    assert(preview.querySelector<HTMLButtonElement>("button.sp-btn.primary")?.disabled, "Apply must be disabled in Dev");
  }
  if (scenario === "mixed") assert(preview.textContent?.includes("ThirdParty") && preview.textContent.includes("Unknown"), "Foreign and unknown ownership must be visible");
  if (scenario === "mixed") {
    const scopes = [...preview.querySelectorAll("details summary")].map((node) => node.textContent ?? "").join(" ");
    assert(scopes.includes("Project") && scopes.includes("ProjectLocal"), "Mixed preview must expose user and project scopes");
    assert(preview.textContent?.includes("OriginalNook") && preview.textContent.includes("NookDev"), "Mixed preview must identify Original and Dev entries");
  }
  if (scenario === "relay-missing") assert(preview.textContent?.includes("Standalone relay is not installed yet") && preview.querySelector<HTMLButtonElement>("button.sp-btn.primary")?.disabled, "Missing relay must block Apply");
  assert(!preview.querySelector(".sp-connect-error"), "Unexpected preview error");

  const longPathDetails = preview.querySelector("details");
  longPathDetails?.setAttribute("open", "");
  const app = document.querySelector<HTMLElement>(".sp-app");
  if (app) assert(app.scrollWidth <= app.clientWidth + 2, `Connect content overflows its pane (${app.scrollWidth}/${app.clientWidth})`);
  const cancel = [...preview.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel");
  assert(cancel, "Cancel action is missing");
  cancel.click();
  await delay();
  assert(!claude.querySelector(".sp-connect-preview"), "Cancel did not close the preview");
  assert(claude.textContent?.includes(expected[scenario] ?? "Not connected"), "Cancel changed the connection state");

  const codexAction = codex.querySelector<HTMLButtonElement>(".sp-connect-actions button");
  assert(codexAction, "Codex action is missing");
  codexAction.click();
  for (let attempt = 0; attempt < 40 && !codex.querySelector(".sp-connect-preview"); attempt++) await delay();
  const codexPreview = codex.querySelector<HTMLElement>(".sp-connect-preview");
  assert(codexPreview, "Codex action did not open its independent preview");
  if (mode === "standalone" && scenario !== "relay-missing" && codexAction.textContent !== "Disconnect") {
    assert(codexPreview.textContent?.includes("Codex may ask me to trust"), "Codex trust confirmation is missing");
  }
  const codexCancel = [...codexPreview.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel");
  assert(codexCancel, "Codex Cancel action is missing");
  codexCancel.click();

  document.querySelector<HTMLButtonElement>("#tab-agents")?.click();
  await delay();
  assert(!document.querySelector<HTMLElement>("#pane-agents")?.hidden, "Other Settings section did not open");
  document.querySelector<HTMLButtonElement>("#tab-connect")?.click();
  await delay();
  assert(document.querySelectorAll("#pane-connect .sp-connect-card").length === 2, "Returning to Connect rebuilt or lost agent cards");
  const right = Math.max(claude.getBoundingClientRect().right, codex.getBoundingClientRect().right);
  assert(right <= window.innerWidth + 2, `Card extends beyond viewport (${right}/${window.innerWidth})`);
  return { ok: true, scenario, mode, cards: 2, width: window.innerWidth, cancel: "closed without apply" };
}

void run().then((value) => {
  result.dataset.testResult = "pass";
  result.textContent = JSON.stringify(value);
}).catch((error: unknown) => {
  result.dataset.testResult = "fail";
  result.textContent = JSON.stringify({ ok: false, scenario, mode, error: error instanceof Error ? error.message : String(error) });
});

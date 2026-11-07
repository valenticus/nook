import test from "node:test";
import assert from "node:assert/strict";

test("Shelf trace is Dev-gated and transfers only bounded, sanitized rows", async () => {
  const callbacks = new Map<number, (event: unknown) => void>();
  const subscriptions = new Map<number, { event: string; callback: number }>();
  let nextCallback = 0;
  let nextSubscription = 0;
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      transformCallback(callback: (event: unknown) => void) {
        const id = ++nextCallback;
        callbacks.set(id, callback);
        return id;
      },
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") {
          const id = ++nextSubscription;
          subscriptions.set(id, { event: args.event, callback: args.handler });
          return id;
        }
        if (command === "plugin:event|emit") {
          for (const [id, subscription] of subscriptions) {
            if (subscription.event === args.event) {
              callbacks.get(subscription.callback)?.({ id, event: args.event, payload: args.payload });
            }
          }
          return;
        }
        throw new Error(`Unexpected Tauri command: ${command}`);
      },
    },
  };
  const trace = await import("../src/core/shelf-trace.ts");

  (globalThis as any).__nookDevBuildFlag = false;
  await trace.enableShelfTraceCapture(true);
  await trace.startShelfTrace();
  assert.equal(trace.shelfTraceCount(), 0);

  (globalThis as any).__nookDevBuildFlag = true;
  await trace.enableShelfTraceSource(true);
  await trace.enableShelfTraceCapture(true);
  trace.shelfTrace("startup-greeting-skipped", { source: "setting-on" });
  trace.shelfTrace("home-dom-created", { locale: "uk", source: "buildHome" });
  trace.shelfTrace("locale-runtime-change", { locale: "en", previousLocale: "uk", newLocale: "en", languagePreference: "auto", source: "island.settings-changed" });
  await trace.startShelfTrace();
  trace.shelfTrace("pointer-region", { source: "enter.expanded.overview" });
  trace.shelfTrace("pointer-dom-event", { source: "click.expanded.overview.button.auto" });
  trace.shelfTrace("draw-row", {
    shown: ["todo", "media"],
    previousWidth: 640,
    nextWidth: 430,
    sessionText: "private session text",
    credentials: "private credential",
  });
  trace.shelfTrace("home-translation", {
    locale: "uk",
    source: "i18n.home-bot",
    mutationType: "text",
    changed: true,
    count: 1,
    visibleText: "private UI content",
  });
  await trace.stopShelfTrace();

  const output = trace.exportShelfTrace();
  const exportedRows = output.split("\n").slice(1).map((line) => line.split("\t"));
  const created = exportedRows.find((row) => row[1] === "home-dom-created");
  assert.equal(created?.[2], "uk");
  assert.equal(created?.[6], "buildHome");
  const localeChange = exportedRows.find((row) => row[1] === "locale-runtime-change");
  assert.deepEqual(localeChange?.slice(2, 7), ["en", "uk", "en", "auto", "island.settings-changed"]);
  const draw = exportedRows.find((row) => row[1] === "draw-row");
  assert.equal(draw?.[9], "2");
  assert.equal(draw?.[10], "430");
  assert.match(output, /trace-start/);
  assert.match(output, /startup-greeting-skipped.*setting-on/);
  assert.match(output, /pointer-region.*enter\.expanded\.overview/);
  assert.match(output, /pointer-dom-event.*click\.expanded\.overview\.button\.auto/);
  assert.match(output, /home-translation\tuk\t\t\t\ti18n\.home-bot\ttext\ttrue\t1/);
  assert.match(output, /trace-stop/);
  assert.doesNotMatch(output, /todo|media|sessionText|private session|credential|private UI content|visibleText/);
  assert.equal(trace.isShelfTraceRecording(), false);

  await trace.startShelfTrace();
  for (let i = 0; i < 510; i++) trace.shelfTrace("width-settled", { width: i, shelfCards: 1 });
  assert.equal(trace.shelfTraceCount(), 500);
  assert.doesNotMatch(trace.exportShelfTrace(), /510\.00\twidth-settled/);
  await trace.stopShelfTrace();
});

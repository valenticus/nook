import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

// In-memory Shelf resize diagnostics. The event bridge carries only sanitized rows
// between the Dev Island and Settings webviews; it never persists or contacts a server.
export interface ShelfTraceRow {
  elapsedMs: number;
  event: string;
  locale?: "en" | "uk";
  previousLocale?: "en" | "uk";
  newLocale?: "en" | "uk";
  languagePreference?: "auto" | "en" | "uk";
  source?: string;
  mutationType?: string;
  changed?: boolean;
  widgetCount?: number;
  previousWidth?: number;
  targetWidth?: number;
  height?: number;
  springState?: string;
  domX?: number;
  domY?: number;
  actualTarget?: string;
  hitTestTarget?: string;
  interactiveTarget?: string;
  expectedTarget?: string;
  rectX?: number;
  rectY?: number;
  rectW?: number;
  rectH?: number;
  pointerEvents?: string;
  visibility?: string;
  opacity?: number;
  disabled?: boolean;
  captureTarget?: string;
}

const LIMIT = 500;
const CONTROL_EVENT = "nook:shelf-trace-control";
const ROW_EVENT = "nook:shelf-trace-row";
const EVENTS = new Set([
  "settings-event", "settings-applied", "state-dirty", "sync-dom", "draw-row",
  "on-shelf-change", "sync", "actions-resized", "target-size", "animate-geometry", "geometry-request-skipped",
  "page-transition-start", "page-transition-commit", "ui-handler", "ui-state",
  "width-settled", "trace-start", "trace-stop",
  "home-open", "home-close", "home-dom-created", "home-dom-attached", "home-dom-visible", "home-first-raf",
  "home-dom-present",
  "home-sync-start", "home-sync-end", "home-translation", "home-mutation", "home-mutation-observer", "home-resize", "home-quota-update",
  "home-sync-request",
  "locale-before-boot", "locale-after-boot", "locale-settings-update", "locale-runtime-change",
  "locale-before-home-open", "locale-before-home-sync", "locale-first-frame",
  "startup-greeting-started", "startup-greeting-skipped", "greeting-first-frame", "greeting-canvas-revealed", "greeting-interrupted", "greeting-audio",
  "pointer-region", "pointer-dom-event", "pointer-dom-detail", "ui-control-layout",
]);
const PRETRACE_EVENTS = new Set([
  "home-dom-created", "locale-before-boot", "locale-after-boot", "locale-settings-update", "locale-runtime-change",
  "startup-greeting-started", "startup-greeting-skipped", "greeting-first-frame", "greeting-canvas-revealed", "greeting-interrupted", "greeting-audio",
]);
let available = false;
let recording = false;
let sourceRecording = false;
let startedAt = 0;
let rows: ShelfTraceRow[] = [];
const pendingRows: { row: ShelfTraceRow; at: number }[] = [];
let controlUnlisten: UnlistenFn | undefined;
let rowUnlisten: UnlistenFn | undefined;
const listeners = new Set<() => void>();

/** Install the Island-side receiver before Settings can start a trace. */
export async function enableShelfTraceSource(on: boolean) {
  if (!__NOOK_DEV_BUILD__ || !on) return;
  controlUnlisten?.();
  controlUnlisten = await listen<string>(CONTROL_EVENT, ({ payload }) => {
    if (payload === "start") {
      sourceRecording = true;
      startedAt = performance.now();
      flushPendingRows();
      shelfTrace("trace-start");
      const home = typeof document !== "undefined" ? document.querySelector(".home") : null;
      shelfTrace("home-dom-present", { source: home ? "trace-start-snapshot" : "missing", changed: !!home?.isConnected, count: home?.childElementCount ?? 0 });
      shelfTrace("home-dom-attached", { source: home?.isConnected ? "attached" : "detached", changed: !!home?.isConnected });
    } else if (payload === "stop" && sourceRecording) {
      shelfTrace("trace-stop");
      sourceRecording = false;
    }
  });
}

/** Install the Settings-side receiver; its bounded buffer exists only in memory. */
export async function enableShelfTraceCapture(on: boolean) {
  available = __NOOK_DEV_BUILD__ && on;
  rowUnlisten?.();
  rowUnlisten = undefined;
  if (!available) return;
  rowUnlisten = await listen<ShelfTraceRow>(ROW_EVENT, ({ payload }) => {
    if (!recording || !validRow(payload)) return;
    rows.push(copyRow(payload));
    if (rows.length > LIMIT) rows = rows.slice(rows.length - LIMIT);
    if (payload.event === "trace-stop") recording = false;
    publish();
  });
}

export async function startShelfTrace() {
  if (!available) return;
  rows = [];
  startedAt = performance.now();
  recording = true;
  flushPendingRows();
  publish();
  await emit(CONTROL_EVENT, "start");
}

export async function stopShelfTrace() {
  if (!recording) return;
  await emit(CONTROL_EVENT, "stop");
}

export function isShelfTraceRecording() {
  return recording;
}

export function shelfTraceCount() {
  return rows.length;
}

/** Whether the Dev-only in-memory trace is collecting on the Island webview. */
export function isShelfTraceSourceRecording() {
  return __NOOK_DEV_BUILD__ && sourceRecording;
}

export function subscribeShelfTrace(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportShelfTrace(): string {
  const lines = ["elapsed_ms\tevent\tlocale\tprevious_locale\tnew_locale\tlanguage_preference\tsource\tmutation_type\tchanged\tcount\twidth\theight\tspring_state\tdom_x\tdom_y\tactual_target\thit_test_target\tinteractive_target\texpected_target\trect_x\trect_y\trect_w\trect_h\tpointer_events\tvisibility\topacity\tdisabled\tcapture_target"];
  for (const row of rows) {
    lines.push([
      row.elapsedMs.toFixed(2), row.event, row.locale ?? "", row.previousLocale ?? "", row.newLocale ?? "",
      row.languagePreference ?? "", row.source ?? "", row.mutationType ?? "",
      row.changed ?? "", row.widgetCount ?? "", row.targetWidth ?? row.previousWidth ?? "",
      row.height ?? "", row.springState ?? "", row.domX ?? "", row.domY ?? "",
      row.actualTarget ?? "", row.hitTestTarget ?? "", row.interactiveTarget ?? "", row.expectedTarget ?? "",
      row.rectX ?? "", row.rectY ?? "", row.rectW ?? "", row.rectH ?? "",
      row.pointerEvents ?? "", row.visibility ?? "", row.opacity ?? "", row.disabled ?? "", row.captureTarget ?? "",
    ].join("\t"));
  }
  return lines.join("\n");
}

export function shelfTrace(event: string, detail: Record<string, unknown> = {}) {
  if (!__NOOK_DEV_BUILD__ || !EVENTS.has(event)) return;
  const settingsCapture = !sourceRecording && available && recording;
  if (!sourceRecording && !settingsCapture) {
    if (PRETRACE_EVENTS.has(event)) {
      pendingRows.push({ row: traceRow(event, detail, 0), at: performance.now() });
      if (pendingRows.length > 24) pendingRows.shift();
    }
    return;
  }
  void emit(ROW_EVENT, traceRow(event, detail, Math.max(0, performance.now() - startedAt)));
}

function traceRow(event: string, detail: Record<string, unknown>, elapsedMs: number): ShelfTraceRow {
  // Deliberately copy only numeric geometry/count data and a fixed event label.
  // Never retain IDs, text, arbitrary objects, settings, or widget/session data.
  const row: ShelfTraceRow = { elapsedMs, event };
  if (detail.locale === "en" || detail.locale === "uk") row.locale = detail.locale;
  if (detail.previousLocale === "en" || detail.previousLocale === "uk") row.previousLocale = detail.previousLocale;
  if (detail.newLocale === "en" || detail.newLocale === "uk") row.newLocale = detail.newLocale;
  if (detail.languagePreference === "auto" || detail.languagePreference === "en" || detail.languagePreference === "uk") row.languagePreference = detail.languagePreference;
  if (typeof detail.source === "string" && /^[a-zA-Z0-9._:-]{1,80}$/.test(detail.source)) row.source = detail.source;
  if (typeof detail.mutationType === "string" && /^[a-zA-Z0-9._:+-]{1,40}$/.test(detail.mutationType)) row.mutationType = detail.mutationType;
  if (typeof detail.changed === "boolean") row.changed = detail.changed;
  const height = typeof detail.height === "number" ? detail.height : detail.heightTo;
  if (typeof height === "number" && Number.isFinite(height)) row.height = height;
  const count = typeof detail.widgetCount === "number" ? detail.widgetCount
    : typeof detail.count === "number" ? detail.count
    : typeof detail.visibleCount === "number" ? detail.visibleCount
      : typeof detail.shelfCards === "number" ? detail.shelfCards
        : Array.isArray(detail.shown) ? detail.shown.length : undefined;
  if (count != null && Number.isFinite(count)) row.widgetCount = count;

  const previousWidth = typeof detail.previousWidth === "number" ? detail.previousWidth : detail.widthFrom;
  if (typeof previousWidth === "number" && Number.isFinite(previousWidth)) row.previousWidth = previousWidth;
  const targetWidth = typeof detail.nextWidth === "number" ? detail.nextWidth
    : typeof detail.widthTo === "number" ? detail.widthTo : detail.width;
  if (typeof targetWidth === "number" && Number.isFinite(targetWidth)) row.targetWidth = targetWidth;

  const springState = typeof detail.springState === "string" ? detail.springState
    : event === "animate-geometry" ? (detail.shrinking ? "close-curve" : "spring")
      : event === "width-settled" ? "settled" : undefined;
  if (springState) row.springState = springState;
  for (const key of ["domX", "domY", "rectX", "rectY", "rectW", "rectH", "opacity"] as const) {
    const value = detail[key];
    if (typeof value === "number" && Number.isFinite(value)) row[key] = Math.round(value * 10) / 10;
  }
  for (const key of ["actualTarget", "hitTestTarget", "interactiveTarget", "expectedTarget", "pointerEvents", "visibility", "captureTarget"] as const) {
    const value = detail[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_.:#-]{1,100}$/.test(value)) row[key] = value;
  }
  if (typeof detail.disabled === "boolean") row.disabled = detail.disabled;
  return row;
}

function flushPendingRows() {
  for (const item of pendingRows) {
    const row = { ...item.row, elapsedMs: item.at - startedAt };
    if (!row.source) row.source = "before-trace";
    void emit(ROW_EVENT, row);
  }
  pendingRows.length = 0;
}

function validRow(value: unknown): value is ShelfTraceRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.elapsedMs === "number" && Number.isFinite(row.elapsedMs)
    && typeof row.event === "string" && EVENTS.has(row.event)
    && (row.locale === undefined || row.locale === "en" || row.locale === "uk")
    && (row.previousLocale === undefined || row.previousLocale === "en" || row.previousLocale === "uk")
    && (row.newLocale === undefined || row.newLocale === "en" || row.newLocale === "uk")
    && (row.languagePreference === undefined || row.languagePreference === "auto" || row.languagePreference === "en" || row.languagePreference === "uk")
    && (row.source === undefined || typeof row.source === "string" && /^[a-zA-Z0-9._:-]{1,80}$/.test(row.source))
    && (row.mutationType === undefined || typeof row.mutationType === "string" && /^[a-zA-Z0-9._:+-]{1,40}$/.test(row.mutationType))
    && (row.changed === undefined || typeof row.changed === "boolean")
    && (row.widgetCount === undefined || typeof row.widgetCount === "number" && Number.isFinite(row.widgetCount))
    && (row.previousWidth === undefined || typeof row.previousWidth === "number" && Number.isFinite(row.previousWidth))
    && (row.targetWidth === undefined || typeof row.targetWidth === "number" && Number.isFinite(row.targetWidth))
    && (row.height === undefined || typeof row.height === "number" && Number.isFinite(row.height))
    && (row.springState === undefined || ["spring", "close-curve", "settled"].includes(String(row.springState)))
    && (["domX", "domY", "rectX", "rectY", "rectW", "rectH", "opacity"] as const).every((key) => row[key] === undefined || typeof row[key] === "number" && Number.isFinite(row[key]))
    && (["actualTarget", "hitTestTarget", "interactiveTarget", "expectedTarget", "pointerEvents", "visibility", "captureTarget"] as const).every((key) => row[key] === undefined || typeof row[key] === "string" && /^[a-zA-Z0-9_.:#-]{1,100}$/.test(row[key] as string))
    && (row.disabled === undefined || typeof row.disabled === "boolean");
}

function copyRow(row: ShelfTraceRow): ShelfTraceRow {
  return {
    elapsedMs: row.elapsedMs,
    event: row.event,
    ...(row.locale === undefined ? {} : { locale: row.locale }),
    ...(row.previousLocale === undefined ? {} : { previousLocale: row.previousLocale }),
    ...(row.newLocale === undefined ? {} : { newLocale: row.newLocale }),
    ...(row.languagePreference === undefined ? {} : { languagePreference: row.languagePreference }),
    ...(row.source === undefined ? {} : { source: row.source }),
    ...(row.mutationType === undefined ? {} : { mutationType: row.mutationType }),
    ...(row.changed === undefined ? {} : { changed: row.changed }),
    ...(row.widgetCount === undefined ? {} : { widgetCount: row.widgetCount }),
    ...(row.previousWidth === undefined ? {} : { previousWidth: row.previousWidth }),
    ...(row.targetWidth === undefined ? {} : { targetWidth: row.targetWidth }),
    ...(row.height === undefined ? {} : { height: row.height }),
    ...(row.springState === undefined ? {} : { springState: row.springState }),
    ...(row.domX === undefined ? {} : { domX: row.domX }),
    ...(row.domY === undefined ? {} : { domY: row.domY }),
    ...(row.actualTarget === undefined ? {} : { actualTarget: row.actualTarget }),
    ...(row.hitTestTarget === undefined ? {} : { hitTestTarget: row.hitTestTarget }),
    ...(row.interactiveTarget === undefined ? {} : { interactiveTarget: row.interactiveTarget }),
    ...(row.expectedTarget === undefined ? {} : { expectedTarget: row.expectedTarget }),
    ...(row.rectX === undefined ? {} : { rectX: row.rectX }),
    ...(row.rectY === undefined ? {} : { rectY: row.rectY }),
    ...(row.rectW === undefined ? {} : { rectW: row.rectW }),
    ...(row.rectH === undefined ? {} : { rectH: row.rectH }),
    ...(row.pointerEvents === undefined ? {} : { pointerEvents: row.pointerEvents }),
    ...(row.visibility === undefined ? {} : { visibility: row.visibility }),
    ...(row.opacity === undefined ? {} : { opacity: row.opacity }),
    ...(row.disabled === undefined ? {} : { disabled: row.disabled }),
    ...(row.captureTarget === undefined ? {} : { captureTarget: row.captureTarget }),
  };
}

function publish() {
  for (const fn of listeners) fn();
}

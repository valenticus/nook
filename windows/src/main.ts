// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { Bridge, IS_TAURI, onEvent, type PanelSize } from "./core/bridge";
import { enableShelfTraceSource, shelfTrace } from "./core/shelf-trace";
import { Reply } from "./core/reply";
import { Sound } from "./core/sound";
import { State, readUsage, type Settings } from "./core/state";
import { clearLegacyCompletionNotifications } from "./core/completion-events";
import { currentLanguage, resolveLanguage, setLanguage, trayMenuLabels } from "./core/i18n";
import { QuotaSnapshotGate } from "./settings/codex-quota-view";
import { Update } from "./core/update";
import { startAgentsFeed } from "./agents/feed";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { startWidgets } from "./widgets";

const CODEX_QUOTA_BUILD = __NOOK_DEV_BUILD__ || __NOOK_STANDALONE_BUILD__;

/**
 * Asks Rust for something that may not be there: a command of the usage
 * limits, which another build of the app may not have. Null then, and nothing
 * is said of it.
 */
async function ask(command: string): Promise<unknown> {
  if (!IS_TAURI) return null;
  try {
    return await invoke(command);
  } catch {
    return null;
  }
}

/** Whether usage limits are switched on in Settings, as far as Rust says: it words why no usage has come. */
async function readUsageInstalled() {
  const status = await ask("usage_status");
  const installed = (status as { installed?: unknown } | null)?.installed;
  if (typeof installed === "boolean") State.usageInstalled = installed;
}

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  if (__NOOK_DEV_BUILD__) shelfTrace("locale-before-boot", { locale: currentLanguage(), languagePreference: State.settings.language, source: "island" });
  setLanguage(resolveLanguage(State.settings.language), "island.pre-boot");

  void Sound.preload();
  const boot = await Bridge.boot();
  const codexQuotaGate = new QuotaSnapshotGate();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
    State.nookDev = boot.nookDev === true;
    State.nookStandalone = boot.nookStandalone === true;
    setLanguage(resolveLanguage(State.settings.language), "island.boot");
    void Bridge.setTrayLabels(trayMenuLabels());
    if (__NOOK_DEV_BUILD__ && boot.nookDev) void enableShelfTraceSource(true);
    codexQuotaGate.setEnabled(CODEX_QUOTA_BUILD && !!(boot.nookDev || boot.nookStandalone) && !!boot.settings.codexQuotaEnabled);
  }
  clearLegacyCompletionNotifications();
  if (__NOOK_DEV_BUILD__) shelfTrace("locale-after-boot", { locale: currentLanguage(), languagePreference: State.settings.language, source: boot ? "island.boot" : "island.boot-unavailable" });

  // Build the Island only after the persisted locale and settings are known.
  // Views render synchronously from state; constructing them before `boot`
  // makes the default English UI visible before the saved language arrives.
  const island = new Island(root);
  // The constructor has now attached every view. Translate it in this same
  // task so its first painted frame uses the persisted locale too.
  setLanguage(resolveLanguage(State.settings.language), "island.after-create");
  if (boot) {
    island.setRoom(boot.panel.width, boot.panel.height, boot.panel.dock);
    island.setScreenWidth(boot.screen.width, boot.screen.height);
    State.notify();
  }
  if (CODEX_QUOTA_BUILD && (boot?.nookDev || boot?.nookStandalone)) {
    await Bridge.onCodexQuota((snapshot) => {
      const accepted = codexQuotaGate.acceptEvent(snapshot);
      if (accepted && State.settings.codexQuotaEnabled) {
        if (__NOOK_DEV_BUILD__) shelfTrace("home-quota-update", { source: "codex-event", mutationType: "quota" });
        State.setCodexQuota(accepted as import("./core/bridge").CodexQuotaSnapshot);
      }
    });
    if (boot.settings.codexQuotaEnabled) {
      void Bridge.codexQuotaLast().then((snapshot) => {
        if (!codexQuotaGate.prime(snapshot)) return;
        const accepted = codexQuotaGate.acceptEvent(snapshot);
        if (accepted) {
          if (__NOOK_DEV_BUILD__) shelfTrace("home-quota-update", { source: "codex-last", mutationType: "quota" });
          State.setCodexQuota(accepted as import("./core/bridge").CodexQuotaSnapshot);
        }
      });
    }
  }
  // Another display, or the same one at another size: the window was sized again.
  await onEvent<PanelSize>("panel-size", ({ width, height, dock }) => {
    island.setRoom(width, height, dock);
    // The display's own width caps the folded island (its height, on a side): asked again, it may be another display.
    void Bridge.boot().then((again) => again && island.setScreenWidth(again.screen.width, again.screen.height));
  });

  // Claude's usage limits arrive only when Claude Code reports them.
  await onEvent<unknown>("usage", (payload) => {
    const usage = readUsage(payload);
    if (!usage) return;
    // Usage that arrives was relayed: the limits are switched on.
    State.usageInstalled = true;
    if (__NOOK_DEV_BUILD__) shelfTrace("home-quota-update", { source: "claude-event", mutationType: "quota" });
    State.setUsage(usage);
  });
  // What was last reported, before this page was listening.
  void ask("usage_last").then((last) => {
    const usage = readUsage(last);
    if (usage) {
      if (__NOOK_DEV_BUILD__) shelfTrace("home-quota-update", { source: "claude-last", mutationType: "quota" });
      State.setUsage(usage);
    }
  });
  void readUsageInstalled();
  // A reply typed in the island: which command lines can take one, and when a run of ours is over.
  await onEvent<unknown>("reply_ended", (payload) => Reply.ended(payload));
  // The Original build may report its upstream update state. Personal Edition
  // has no Original updater commands or release endpoint.
  if (!__NOOK_STANDALONE_BUILD__) {
    await onEvent<unknown>("update_checked", (payload) => Update.checked(payload));
    void Update.load();
  }
  island.applySettings();
  // The Shelf's widgets read what they kept, and arm what must run on its own.
  startWidgets();
  State.loadIntegrationTasks();
  if (boot && !boot.cursorPoll) island.followPageCursor();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  const setPaused = (on: boolean) => {
    State.paused = on;
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) {
          island.hideWhy = "paused";
          island.fsm.forceHidden();
        }
        else island.reveal();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // The window was hidden by the shortcut or the tray, and is on show again (Rust, visibility.rs).
  await onEvent<boolean>("island-shown", (shown) => {
    if (shown) island.onShown();
  });

  // A full-screen app came in front on the island's display, or left: said
  // by Rust's poll, which runs only while the island is on show.
  await onEvent<boolean>("fullscreen", (full) => island.onFullscreen(full === true));

  // A global shortcut, pressed anywhere: the session panel large or back to
  // its normal size, the panel at its normal size, or the way to the session that needs the user.
  await onEvent<string>("shortcut", (which) => {
    if (State.paused) return;
    if (which === "goto") island.goToNeedy();
    else if (which === "panel") island.summonPanelNormal();
    else island.summonPanel();
  });

  // The settings window writes preferences; apply them here without a restart.
  const agentsFeed = startAgentsFeed();
  await onEvent<Settings>("settings-changed", (s) => {
    const previousLocale = currentLanguage();
    const previousPreference = State.settings.language;
    const previousShelfHidden = State.settings.shelfHidden;
    if (__NOOK_DEV_BUILD__) {
      if (JSON.stringify(previousShelfHidden) !== JSON.stringify(s.shelfHidden)) {
        shelfTrace("settings-event", { previousHidden: previousShelfHidden, nextHidden: s.shelfHidden });
      }
    }
    const wasQuotaEnabled = State.settings.codexQuotaEnabled;
    State.settings = { ...State.settings, ...s };
    setLanguage(resolveLanguage(State.settings.language), "island.settings-changed");
    void Bridge.setTrayLabels(trayMenuLabels());
    if (__NOOK_DEV_BUILD__) shelfTrace("locale-settings-update", {
      locale: currentLanguage(), previousLocale, newLocale: currentLanguage(),
      languagePreference: State.settings.language,
      source: previousPreference === State.settings.language ? "island.settings-refresh" : "island.settings-changed",
    });
    if (__NOOK_DEV_BUILD__) {
      if (JSON.stringify(previousShelfHidden) !== JSON.stringify(State.settings.shelfHidden)) {
        shelfTrace("settings-applied", { shelfHidden: State.settings.shelfHidden });
      }
    }
    if (State.settings.codexQuotaEnabled !== wasQuotaEnabled) {
      codexQuotaGate.setEnabled(CODEX_QUOTA_BUILD && !!(boot?.nookDev || boot?.nookStandalone) && !!State.settings.codexQuotaEnabled);
      if (CODEX_QUOTA_BUILD && (boot?.nookDev || boot?.nookStandalone) && State.settings.codexQuotaEnabled) {
        void Bridge.codexQuotaLast().then((snapshot) => {
          if (!codexQuotaGate.prime(snapshot)) return;
          const accepted = codexQuotaGate.acceptEvent(snapshot);
          if (accepted) State.setCodexQuota(accepted as import("./core/bridge").CodexQuotaSnapshot);
        });
      }
    }
    if (!State.settings.codexQuotaEnabled) State.clearCodexQuota();
    island.applySettings();
    // The agents list may have just been turned on: it is sent the rows.
    agentsFeed.poke();
    State.loadIntegrationTasks();
    // Usage limits are switched on and off in that window too.
    void readUsageInstalled().then(() => State.setUsage(State.usage));
  });

  registerHookHandlers(island);
  // Switched on in the last run, the list is there at launch: it is sent the rows at once.
  agentsFeed.poke();

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();

import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGES, detectSystemLanguage, message, plural, resolveLanguage, setLanguage, trayMenuLabels } from "../src/core/i18n.ts";

test("every phrase has explicit English and Ukrainian text", () => {
  assert.ok(Object.keys(MESSAGES).length >= 100);
  for (const [key, value] of Object.entries(MESSAGES)) {
    assert.equal(value.en.length > 0, true, `${key} has English text`);
    assert.equal(value.uk.length > 0, true, `${key} has Ukrainian text`);
  }
});

test("identical translations are limited to brands and language-neutral templates", () => {
  const intentional = new Set([
    "{agent} · {status}", "{agent} · {status} · {activity}", "Claude Code", "Codex", "Cursor",
    "{name} · {detail}", "Nook", "Claude", "{agent} · {label} — {state}",
    "{agent} · {label} — {state}\n{legend}", "{label} — {state}", "{label} — {state}\n{legend}",
    "{agent} — {folder} — {title}{model} — {status}{children}", "{tip} (Ctrl+Enter)",
    "{name}{model} — {status}", "{app} · {path}", "{name} {state}", "{name} {state} — {attention}",
    "{name} {state}{attention}", " — {attention}", "{agent} — {folder} — {title}{model} — {state}{children}",
    "{tool} · {path}{created}", "{event}: {action}", "Nook Dev",
  ]);
  for (const [key, value] of Object.entries(MESSAGES)) {
    if (value.en === value.uk) assert.ok(intentional.has(key), `unexpected untranslated phrase: ${key}`);
  }
  setLanguage("uk");
  assert.equal(message("English"), "Англійська");
});

test("Connect controls and tray labels follow the selected language", () => {
  setLanguage("uk");
  assert.equal(message("Connect"), "Підключити");
  assert.equal(message("Disconnect"), "Відключити");
  assert.equal(message("Repair"), "Відновити підключення");
  assert.equal(message("Not charging"), "Не заряджається");
  assert.equal(message("Battery {percent} percent, not charging", { percent: 42 }), "Заряд батареї: 42%, не заряджається");
  assert.deepEqual(trayMenuLabels(), {
    openNook: "Відкрити Nook", hideIsland: "Приховати острівець", showIsland: "Показати острівець",
    showAgentsList: "Показати список агентів", hideAgentsList: "Приховати список агентів",
    settings: "Налаштування…", pause: "Призупинити", quit: "Вийти",
  });
  setLanguage("en");
  assert.equal(message("Disconnect"), "Disconnect");
  assert.equal(message("Battery {percent} percent, not charging", { percent: 42 }), "Battery 42 percent, not charging");
  assert.deepEqual(trayMenuLabels(), {
    openNook: "Open Nook", hideIsland: "Hide island", showIsland: "Show island",
    showAgentsList: "Show agents list", hideAgentsList: "Hide agents list",
    settings: "Settings…", pause: "Pause", quit: "Quit",
  });
});

test("unknown phrases use the documented source-language fallback", () => {
  setLanguage("uk");
  assert.equal(message("Uncatalogued diagnostic"), "Uncatalogued diagnostic");
  setLanguage("en");
  assert.equal(message("Uncatalogued diagnostic"), "Uncatalogued diagnostic");
});

test("Windows locale selects Ukrainian only for Ukrainian locales; other locales fall back to English", () => {
  assert.equal(detectSystemLanguage("uk-UA"), "uk");
  assert.equal(detectSystemLanguage("uk"), "uk");
  assert.equal(detectSystemLanguage("pl-PL"), "en");
  assert.equal(resolveLanguage("auto", "uk-UA"), "uk");
  assert.equal(resolveLanguage("auto", "pl-PL"), "en");
  assert.equal(resolveLanguage("en", "uk-UA"), "en");
  assert.equal(resolveLanguage("unknown", "uk-UA"), "uk");
});

test("pluralization follows Ukrainian and English rules", () => {
  const forms = { one: "{count} session", few: "{count} sessions-few", many: "{count} sessions-many", other: "{count} sessions" };
  assert.equal(plural(1, forms, "uk"), "1 session");
  assert.equal(plural(2, forms, "uk"), "2 sessions-few");
  assert.equal(plural(5, forms, "uk"), "5 sessions-many");
  assert.equal(plural(21, forms, "uk"), "21 session");
  assert.equal(plural(1, forms, "en"), "1 session");
  assert.equal(plural(2, forms, "en"), "2 sessions");
});

test("message interpolation preserves display values and language changes in place", () => {
  setLanguage("uk");
  assert.equal(message("Nothing matches “{query}”. Try a simpler word.", { query: "battery" }), "За запитом «battery» нічого не знайдено. Спробуйте простіше слово.");
  setLanguage("en");
  assert.equal(message("Nothing matches “{query}”. Try a simpler word.", { query: "battery" }), "Nothing matches “battery”. Try a simpler word.");
});

test("dynamic resting-session copy is localized with correct plural grammar", () => {
  setLanguage("uk");
  assert.equal(message("1 session is at rest. It will appear here when it works again."), "1 сесія зараз неактивна. Вона з’явиться тут, коли відновить роботу.");
  assert.equal(message("2 sessions are at rest. They will appear here when they work again."), "2 сесії зараз неактивні. Вони з’являться тут, коли відновлять роботу.");
  setLanguage("en");
  assert.equal(message("2 sessions are at rest. They will appear here when they work again."), "2 sessions are at rest. They will appear here when they work again.");
  assert.equal(message("2 сесії зараз неактивні. Вони з’являться тут, коли відновлять роботу."), "2 sessions are at rest. They will appear here when they work again.");
});

test("parameterized UI templates translate in both directions without translating their values", () => {
  setLanguage("uk");
  assert.equal(message("Resets 10:30 (local time)"), "Скидання о 10:30 (місцевий час)");
  assert.equal(message("Reply to Project Settings…"), "Відповісти сесії «Project Settings»…");
  assert.equal(message("Battery 74 percent, charging"), "Заряд батареї: 74%, заряджається");
  setLanguage("en");
  assert.equal(message("Скидання о 10:30 (місцевий час)"), "Resets 10:30 (local time)");
  assert.equal(message("Відповісти сесії «Project Settings»…"), "Reply to Project Settings…");
});

test("remaining theme, palette, Home and changing quota labels have immediate translations", () => {
  setLanguage("uk");
  assert.equal(message("Light"), "Світла");
  assert.equal(message("Dark"), "Темна");
  assert.equal(message("Match computer"), "Як у Windows");
  assert.equal(message("Sky"), "Небесний");
  assert.equal(message("Turn on the agents list first."), "Спочатку увімкніть список агентів.");
  assert.equal(message("Turn on…"), "Увімкнути…");
  assert.equal(message("Off. No shortcut is registered."), "Вимкнено. Сполучення клавіш не зареєстровано.");
  assert.equal(message("None yet"), "Ще немає");
  assert.equal(message("Stale data"), "Застарілі дані");
  assert.equal(message("Sessions waiting for you"), "Сесії, що очікують на вас");
  assert.equal(message("Restart Nook first: a part of it is missing."), "Спочатку перезапустіть Nook: бракує одного з його компонентів.");
  assert.equal(message("Turn on sounds first."), "Спочатку увімкніть звуки.");
  assert.equal(message("Claude usage"), "Ліміти Claude");
  assert.equal(message("Codex usage"), "Ліміти Codex");
  assert.equal(message("{count}m ago", { count: 4 }), "4 хв тому");
  assert.equal(message("{count} subagents running", { count: 2 }), "Працюють субагенти: 2");
  setLanguage("en");
  assert.equal(message("{count}m ago", { count: 4 }), "4m ago");
});

test("Claude Usage connection and migration copy is localized in both languages", () => {
  setLanguage("uk");
  assert.equal(message("Original statusLine found"), "Знайдено statusLine оригінального Nook");
  assert.equal(message("Connect Claude statistics…"), "Підключити статистику Claude…");
  assert.equal(message("Migrate Original statusLine…"), "Перенести statusLine оригінального Nook…");
  assert.equal(message("Turn off…"), "Вимкнути…");
  assert.equal(message("Scope: {scope} — {path}", { scope: message("User scope"), path: "C:/Users/me/.claude/settings.json" }), "Область: Область користувача — C:/Users/me/.claude/settings.json");
  setLanguage("en");
  assert.equal(message("Connect Claude statistics…"), "Connect Claude statistics…");
  assert.equal(message("Turn off…"), "Turn off…");
});

test("dynamic interface templates translate while preserving user and numeric values", () => {
  setLanguage("uk");
  assert.equal(message("resets in 2h 14m"), "скидання через 2 год 14 хв");
  assert.equal(message("resets in <1m"), "скидання через менше хвилини");
  assert.equal(message("{agent}: {percent}% used{countdown}. {source}", {
    agent: "Claude Code", percent: 74, countdown: " · Resets 10:30 (local time)", source: "Usage only updates while Claude Code runs. Usage from claude.ai and the desktop app counts toward the same limits but isn't visible to Nook.",
  }), "Claude Code: використано 74% · Resets 10:30 (local time). Дані про використання оновлюються лише під час роботи Claude Code. Використання claude.ai та настільного застосунку враховується в тих самих лімітах, але Nook його не бачить.");
  assert.equal(message("{count} decisions further down", { count: 3 }), "Нижче ще рішень: 3");
  assert.equal(message("{percent}%. Підключіть зарядний пристрій.", { percent: 20 }), "20%. Підключіть зарядний пристрій.");
  setLanguage("en");
  assert.equal(message("скидання через 2 год 14 хв"), "resets in 2h 14m");
  assert.equal(message("20%. Підключіть зарядний пристрій."), "20%. Connect the charger.");
  assert.equal(message("{summary}: {running} running{waiting}", {
    summary: "2 subagents", running: 1, waiting: ", 1 waiting for you",
  }), "2 subagents: 1 running, 1 waiting for you");
});

test("rendered text and accessible labels switch languages in place", () => {
  class FakeText {
    readonly nodeType = 3;
    parentElement: FakeElement | null = null;
    data: string;
    constructor(data: string) { this.data = data; }
  }
  class FakeElement {
    readonly nodeType = 1;
    readonly tagName = "DIV";
    readonly childNodes: Array<FakeElement | FakeText> = [];
    readonly attributes = new Map<string, string>();
    lang = "";
    closest() { return null; }
    append(child: FakeElement | FakeText) { if (child instanceof FakeText) child.parentElement = this; this.childNodes.push(child); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  }
  const root = new FakeElement();
  const label = new FakeText("Reset this section");
  const button = new FakeElement();
  button.setAttribute("aria-label", "Open the island large, or shrink it");
  button.append(label);
  root.append(button);
  const globals = globalThis as any;
  const previous = Object.fromEntries(["Node", "Text", "Element", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globals, key)]));
  try {
    Object.defineProperty(globals, "Node", { configurable: true, value: { TEXT_NODE: 3, ELEMENT_NODE: 1 } });
    Object.defineProperty(globals, "Text", { configurable: true, value: FakeText });
    Object.defineProperty(globals, "Element", { configurable: true, value: FakeElement });
    Object.defineProperty(globals, "document", { configurable: true, value: { documentElement: root } });
    setLanguage("uk");
    assert.equal(label.data, "Скинути цей розділ");
    assert.equal(button.getAttribute("aria-label"), "Розгорнути або згорнути острівець");
    assert.equal(root.lang, "uk");
    setLanguage("en");
    assert.equal(label.data, "Reset this section");
    assert.equal(button.getAttribute("aria-label"), "Open the island large, or shrink it");
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else delete globals[key];
    }
  }
});

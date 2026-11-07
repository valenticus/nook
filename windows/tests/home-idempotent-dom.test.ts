import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  removeAttributeIfPresent, removeStylePropertyIfPresent, setAttributeIfChanged, setHiddenIfChanged,
  setStylePropertyIfChanged, setTextIfChanged,
} from "../src/views/dom.ts";

function countedText(initial: string) {
  let value: string | null = initial;
  let writes = 0;
  const node = {
    get textContent() { return value; },
    set textContent(next: string | null) { writes++; value = next; },
  } as unknown as Node;
  return { node, writes: () => writes, value: () => value };
}

test("opening Home and reopening with unchanged data do not rewrite displayed text", () => {
  const label = countedText("No active sessions");
  setTextIfChanged(label.node, "No active sessions");
  setTextIfChanged(label.node, "No active sessions");
  assert.equal(label.writes(), 0);
});

test("a newly appearing session and its removal still update the visible label", () => {
  const label = countedText("No active sessions");
  setTextIfChanged(label.node, "Build agent");
  setTextIfChanged(label.node, "No active sessions");
  assert.equal(label.value(), "No active sessions");
  assert.equal(label.writes(), 2);
});

test("locale changes still replace text when the translation differs", () => {
  const label = countedText("No active sessions");
  setTextIfChanged(label.node, "Немає активних сесій");
  assert.equal(label.value(), "Немає активних сесій");
  assert.equal(label.writes(), 1);
});

test("a quota refresh is silent when the displayed quota is unchanged and updates when it changes", () => {
  const value = countedText("73%");
  setTextIfChanged(value.node, "73%");
  setTextIfChanged(value.node, "74%");
  assert.equal(value.value(), "74%");
  assert.equal(value.writes(), 1);
});

test("unchanged attributes, visibility and progress styles are not re-applied", () => {
  const attrs = new Map<string, string>([["title", "5 hours"]]);
  let attributeWrites = 0;
  let hidden = false;
  let hiddenWrites = 0;
  const styleValues = new Map<string, string>([["--used", "0.73"]]);
  let styleWrites = 0;
  const el = {
    getAttribute: (key: string) => attrs.get(key) ?? null,
    hasAttribute: (key: string) => attrs.has(key),
    setAttribute: (key: string, value: string) => { attributeWrites++; attrs.set(key, value); },
    removeAttribute: (key: string) => { attributeWrites++; attrs.delete(key); },
    get hidden() { return hidden; },
    set hidden(value: boolean) { hiddenWrites++; hidden = value; },
    style: {
      getPropertyValue: (key: string) => styleValues.get(key) ?? "",
      setProperty: (key: string, value: string) => { styleWrites++; styleValues.set(key, value); },
      removeProperty: (key: string) => { styleWrites++; styleValues.delete(key); },
    },
  } as any;

  setAttributeIfChanged(el, "title", "5 hours");
  setHiddenIfChanged(el, false);
  setStylePropertyIfChanged(el, "--used", "0.73");
  assert.equal(attributeWrites + hiddenWrites + styleWrites, 0);
  setAttributeIfChanged(el, "title", "6 hours");
  setHiddenIfChanged(el, true);
  setStylePropertyIfChanged(el, "--used", "0.74");
  assert.equal(attributeWrites + hiddenWrites + styleWrites, 3);
  removeAttributeIfPresent(el, "title");
  removeStylePropertyIfPresent(el, "--used");
  const count = attributeWrites + hiddenWrites + styleWrites;
  removeAttributeIfPresent(el, "title");
  removeStylePropertyIfPresent(el, "--used");
  assert.equal(attributeWrites + hiddenWrites + styleWrites, count);
});

test("the Home render path uses equality-guarded writes while retaining state-driven render calls", async () => {
  const home = await readFile(new URL("../src/views/home.ts", import.meta.url), "utf8");
  const usage = await readFile(new URL("../src/views/home-usage.ts", import.meta.url), "utf8");
  assert.match(home, /sync\(\)\s*\{[\s\S]*?drawMain\(live\[0\] \?\? null\)/);
  assert.match(home, /setTextIfChanged\(whoName/);
  assert.match(home, /toolKey !== shownToolKey/);
  assert.match(home, /kidsKey !== cell\.kidsKey/);
  assert.match(usage, /setTextIfChanged\(row\.value/);
  assert.match(usage, /setAttributeIfChanged\(row\.resets, "title"/);
  assert.match(usage, /setStylePropertyIfChanged\(row\.fill, "--used"/);
  assert.match(usage, /State\.onGauges\(draw\)/);
});

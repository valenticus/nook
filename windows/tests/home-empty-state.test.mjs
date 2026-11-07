import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/views/home.ts", import.meta.url), "utf8");

test("Home does not infer hook installation from an empty session list", () => {
  assert.match(source, /No active sessions/);
  assert.doesNotMatch(source, /Hooks not installed|Claude Code can't reach Nook|hooksInstalled/);
});

test("Home uses neutral Claude Code and Codex copy, with an explicit Dev limitation", () => {
  assert.match(source, /Claude Code and Codex sessions/);
  assert.match(source, /This Dev build does not inspect or install global agent integrations/);
  assert.match(source, /if \(!State\.nookDev\).*openSettingsWindow/s);
});

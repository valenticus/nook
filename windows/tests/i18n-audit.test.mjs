import test from "node:test";
import assert from "node:assert/strict";
import { auditReport } from "../scripts/audit-i18n.mjs";

test("all statically detected UI strings have translations or a documented narrow allowlist", () => {
  assert.deepEqual(auditReport.missingUiStrings, []);
  assert.deepEqual(auditReport.placeholderMismatches, []);
  assert.deepEqual(auditReport.incomplete, []);
  assert.ok(auditReport.dictionaryEntries >= 400);
  for (const entry of auditReport.allowlistedUiStrings) assert.ok(entry.reason.length > 15, entry.location);
});

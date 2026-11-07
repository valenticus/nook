import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../src");
const dictionaryFile = path.join(root, "core/i18n.ts");
const source = fs.readFileSync(dictionaryFile, "utf8");
const parsed = ts.createSourceFile(dictionaryFile, source, ts.ScriptTarget.Latest, true);
let dictionary;
for (const statement of parsed.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.name.text === "MESSAGES" && declaration.initializer) {
      let initializer = declaration.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
      if (ts.isObjectLiteralExpression(initializer)) dictionary = initializer;
    }
  }
}
if (!dictionary) throw new Error("Could not parse MESSAGES dictionary");

const messages = new Map();
for (const entry of dictionary.properties) {
  if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name) || !ts.isObjectLiteralExpression(entry.initializer)) continue;
  const value = {};
  for (const lang of entry.initializer.properties) {
    if (ts.isPropertyAssignment(lang) && ts.isIdentifier(lang.name) && ts.isStringLiteral(lang.initializer)) value[lang.name.text] = lang.initializer.text;
  }
  messages.set(entry.name.text, value);
}

const uiProps = new Set(["text", "title", "aria-label", "aria-description", "placeholder", "alt", "lede", "group", "help", "description", "emptyLabel", "buttonLabel", "statusLabel"]);
const uiCalls = new Map([
  ["action", [0]], ["button", [0]], ["row", [0, 1]], ["group", [0]], ["bare", [0]],
  ["head", [0]], ["rowText", [0, 1]], ["stackRow", [0, 1]], ["connectGroup", [1, 2]],
  ["setAttribute", [0, 1]],
]);
// These named records feed UI later, so their strings do not appear inside
// h()/row() calls where the ordinary JSX/DOM-text scan can see them.
const uiMetadata = new Set(["INFO", "SHORTCUTS", "WIDGETS", "COMPACT_CELLS", "SHELF_WIDGETS", "RESET_WORDS", "CHANGE_WORDS"]);
const metadataTextFields = new Set(["name", "group", "lede", "label", "does", "short", "about", "install", "remove", "done"]);
const ALLOWLIST = new Map([
  ["settings/main.ts|connect", "Internal integration enum; the visible category title is a separate translated value."],
  ["settings/main.ts|hooks", "Internal settings command key; not rendered as copy."],
  ["settings/main.ts|usage", "Internal settings command key; not rendered as copy."],
  ["settings/main.ts|reply", "Internal settings command key; not rendered as copy."],
  ["settings/main.ts|codex", "Internal agent key; visible product name has its own translation entry."],
  ["settings/main.ts|cursor", "Internal agent key; visible product name has its own translation entry."],
  ["settings/main.ts|shortcuts", "Internal settings page key."],
  ["settings/main.ts|sounds", "Internal settings page key."],
  ["settings/main.ts|agents", "Internal settings page key."],
  ["settings/main.ts|island", "Internal settings page key."],
  ["settings/main.ts|look", "Internal settings page key."],
  ["settings/main.ts|shelf", "Internal settings page key."],
  ["settings/main.ts|about", "Internal settings page key."],
  ["settings/main.ts|Gullu", "Character/product proper name."],
  ["settings/main.ts|Zubair Bin Shaukat", "Creator's personal name; proper name is intentionally unchanged."],
  ["widgets/fake.ts|Paper Lanterns", "Fictional track title shown only in the fake media fixture."],
  ["widgets/fake.ts|Night Bus Home", "Fictional track title shown only in the fake media fixture."],
  ["widgets/fake.ts|Soft Static", "Fictional track title shown only in the fake media fixture."],
  ["views/views.ts|{value}/{value}", "Numeric question position/total display; contains no language-dependent words."],
  ["views/views.ts|{value}{value}/{value}", "Numeric question position/total display; contains no language-dependent words."],
  ["settings/island-preview.ts|{value} × {value}{value} px", "Numeric preview dimensions in device-independent pixels."],
  ["settings/island-preview.ts|{value}{value} px", "Numeric preview dimension in device-independent pixels."],
]);
const candidates = new Map();
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (item.isFile() && file.endsWith(".ts") && !file.endsWith(".d.ts")) files.push(file);
  }
}
walk(root);

function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}
let constStrings = new Map();
function uiPatterns(node) {
  const fixed = literal(node);
  if (fixed != null) return [fixed];
  if (ts.isIdentifier(node)) return constStrings.has(node.text) ? [constStrings.get(node.text)] : [];
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["message", "plural"].includes(node.expression.text)) {
    return node.arguments[0] ? uiPatterns(node.arguments[0]) : [];
  }
  if (ts.isConditionalExpression(node)) return [...uiPatterns(node.whenTrue), ...uiPatterns(node.whenFalse)];
  if (ts.isTemplateExpression(node)) {
    let results = [node.head.text];
    for (const span of node.templateSpans) {
      const parts = uiPatterns(span.expression);
      results = results.flatMap((lead) => (parts.length ? parts : ["{value}"]).map((part) => `${lead}${part}${span.literal.text}`));
    }
    return results;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = uiPatterns(node.left), right = uiPatterns(node.right);
    return (left.length ? left : ["{value}"]).flatMap((a) => (right.length ? right : ["{value}"]).map((b) => a + b));
  }
  return [];
}
function addExpression(node) {
  for (const value of uiPatterns(node)) add(node, value);
}
const signature = (value) => value.replace(/\{[a-zA-Z][\w]*\}/g, "{}");
function eligible(value) {
  const text = value.trim();
  const words = text.replace(/\{[a-zA-Z][\w]*\}/g, " value ").match(/[A-Za-zА-Яа-яІіЇїЄєҐґ]+/g) ?? [];
  if (text.length < 3 || words.length < 2) return false;
  if (/^(https?:|[A-Z]:\\|\\\\|#[0-9a-f]{3,8}$)/i.test(text)) return false;
  if (/^(SessionStart|SessionEnd|PermissionRequest|UserPromptSubmit|PreToolUse|PostToolUse|Stop|Interrupt|SubagentStart|SubagentStop|Allow|Deny|Ask|Passthrough|explicit|never|always|acceptEdits|bypassPermissions)$/i.test(text)) return false;
  return true;
}
function add(node, value) {
  value = value.trim();
  const covered = messages.has(value) || [...messages.values()].some((m) => m.en === value || m.uk === value)
    || [...messages.keys()].some((key) => signature(key) === signature(value));
  if (eligible(value.replace(/\{[a-zA-Z][\w]*\}/g, "value")) && !covered) {
    const file = node.getSourceFile();
    const at = file.getLineAndCharacterOfPosition(node.getStart(file));
    const relative = path.relative(root, file.fileName).replaceAll("\\", "/");
    candidates.set(`${relative}:${at.line + 1}: ${value}`, { file: relative, value });
  }
}
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  constStrings = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && node.parent && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) {
      const value = literal(node.initializer);
      if (value != null) constStrings.set(node.name.text, value);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && uiMetadata.has(node.name.text) && node.initializer) {
      const visitMetadata = (child) => {
        if (ts.isPropertyAssignment(child) && ts.isIdentifier(child.name) && metadataTextFields.has(child.name.text)) {
          addExpression(child.initializer);
        }
        ts.forEachChild(child, visitMetadata);
      };
      visitMetadata(node.initializer);
    }
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const key = node.name.text;
      if (uiProps.has(key)) {
        addExpression(node.initializer);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && ["textContent", "title", "placeholder"].includes(node.left.name.text)) {
      addExpression(node.right);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === "h") {
        for (const child of node.arguments.slice(2)) {
          addExpression(child);
        }
      }
      for (const index of uiCalls.get(name) ?? []) {
        const arg = node.arguments[index];
        if (arg) addExpression(arg);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

const placeholders = (value) => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((m) => m[1]).sort().join(",");
const placeholderMismatches = [...messages].filter(([, m]) => placeholders(m.en) !== placeholders(m.uk)).map(([key, m]) => `${key}: en {${placeholders(m.en)}} vs uk {${placeholders(m.uk)}}`);
const incomplete = [...messages].filter(([key, m]) => !m.en?.trim() || !m.uk?.trim() || !m.en || !m.uk).map(([key]) => key);
const allowlisted = [...candidates].filter(([, item]) => ALLOWLIST.has(`${item.file}|${item.value}`));
const missing = [...candidates].filter(([, item]) => !ALLOWLIST.has(`${item.file}|${item.value}`));
export const auditReport = {
  filesScanned: files.length,
  dictionaryEntries: messages.size,
  missingUiStrings: missing.map(([key]) => key).sort(),
  allowlistedUiStrings: allowlisted.map(([key, item]) => ({ location: key, reason: ALLOWLIST.get(`${item.file}|${item.value}`) })).sort((a, b) => a.location.localeCompare(b.location)),
  placeholderMismatches,
  incomplete,
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(import.meta.filename)) {
  if (process.argv.includes("--json")) console.log(JSON.stringify(auditReport, null, 2));
  else {
    console.log(`Scanned ${auditReport.filesScanned} TypeScript files; ${auditReport.dictionaryEntries} translation entries.`);
    console.log(`Untranslated candidate UI strings: ${auditReport.missingUiStrings.length}`);
    console.log(`Narrow allowlist entries: ${auditReport.allowlistedUiStrings.length}`);
    for (const item of auditReport.missingUiStrings) console.log(`  ${item}`);
    for (const item of auditReport.placeholderMismatches) console.error(`Placeholder mismatch: ${item}`);
    for (const item of auditReport.incomplete) console.error(`Incomplete translation: ${item}`);
  }
  if (auditReport.placeholderMismatches.length || auditReport.incomplete.length || (process.argv.includes("--check") && auditReport.missingUiStrings.length)) process.exitCode = 1;
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { loadConfigFromFile } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

test("Tauri production, Dev and Standalone configs point at isolated Vite outputs", () => {
  const production = json("src-tauri/tauri.conf.json");
  const dev = json("src-tauri/tauri.nook-dev.conf.json");
  const standalone = json("src-tauri/tauri.nook-standalone.conf.json");
  assert.equal(production.build.frontendDist, "../dist");
  assert.equal(production.build.beforeBuildCommand, "npm run build");
  assert.equal(dev.build.frontendDist, "../dist-dev");
  assert.equal(dev.build.beforeBuildCommand, "npm run build:dev");
  assert.equal(dev.build.beforeDevCommand, "npm run dev:dev");
  assert.equal(standalone.build.frontendDist, "../dist-standalone");
  assert.equal(standalone.build.beforeBuildCommand, "npm run build:standalone");
});

test("Vite output and shared sounds follow the selected build directory", () => {
  const config = read("vite.config.ts");
  assert.match(config, /process\.env\.NOOK_DEV_BUILD === "1"/);
  assert.match(config, /isNookDevBuild \? "dist-dev" : isNookStandaloneBuild \? "dist-standalone" : "dist"/);
  assert.match(config, /outDir: frontendOutDir/);
  assert.match(config, /outputDir = config\.build\.outDir/);
  assert.match(config, /resolve\(outputDir, "sounds"\)/);
});

test("Vite resolves the production and Dev defaults to different directories", async () => {
  const previous = process.env.NOOK_DEV_BUILD;
  try {
    process.env.NOOK_DEV_BUILD = "0";
    const production = await loadConfigFromFile({ command: "build", mode: "production" }, resolve(root, "vite.config.ts"));
    assert.equal(production?.config.build?.outDir, "dist");

    process.env.NOOK_DEV_BUILD = "1";
    const dev = await loadConfigFromFile({ command: "build", mode: "production" }, resolve(root, "vite.config.ts"));
    assert.equal(dev?.config.build?.outDir, "dist-dev");
  } finally {
    if (previous === undefined) delete process.env.NOOK_DEV_BUILD;
    else process.env.NOOK_DEV_BUILD = previous;
  }
});

test("Dev commands set the nook-dev flag and the folder is ignored", () => {
  const pkg = json("package.json");
  const devBuild = read("scripts/vite-dev.mjs");
  const productionBuild = read("scripts/vite-production.mjs");
  const ignore = read(".gitignore");
  const buildScript = read("scripts/build-dev.ps1");
  const rustBuild = read("src-tauri/build.rs");
  assert.equal(pkg.scripts["build:dev"], "tsc --noEmit && node scripts/vite-dev.mjs build");
  assert.equal(pkg.scripts["dev:dev"], "node scripts/vite-dev.mjs");
  assert.equal(pkg.scripts.build, "tsc --noEmit && node scripts/vite-production.mjs build");
  assert.equal(pkg.scripts.dev, "node scripts/vite-production.mjs");
  assert.equal(pkg.scripts["preview:dev"].includes("dist-dev"), true);
  assert.match(devBuild, /NOOK_DEV_BUILD: "1"/);
  assert.match(productionBuild, /NOOK_DEV_BUILD: "0"/);
  assert.match(ignore, /^dist-dev\/$/m);
  assert.match(buildScript, /tauri\.nook-dev\.conf\.json/);
  assert.match(buildScript, /--features nook-dev --config src-tauri\/tauri\.nook-dev\.conf\.json/);
  assert.match(rustBuild, /NOOK_DEV_BUILD requires Cargo feature `nook-dev`/);
});

test("built production and Dev entry points reference isolated bundles", {
  skip: !process.env.NOOK_PROD_DIST || !process.env.NOOK_DEV_DIST,
}, () => {
  const assets = (directory) => {
    const html = ["index.html", "settings.html", "agents.html"]
      .map((name) => readFileSync(resolve(directory, name), "utf8"));
    const bundles = readdirSync(resolve(directory, "assets"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:js|css)$/.test(entry.name))
      .map((entry) => readFileSync(resolve(directory, "assets", entry.name), "utf8"));
    return [...html, ...bundles].join("\n");
  };
  const prodDir = resolve(root, process.env.NOOK_PROD_DIST);
  const devDir = resolve(root, process.env.NOOK_DEV_DIST);
  assert.ok(existsSync(prodDir), `missing production output ${prodDir}`);
  assert.ok(existsSync(devDir), `missing Dev output ${devDir}`);
  const production = assets(prodDir);
  const dev = assets(devDir);
  // User-facing labels also live in the shared UA/EN dictionary, so their
  // presence does not mean a production Dev control was bundled. Use markers
  // from the actual Dev simulator and trace transport instead.
  for (const marker of ["createDevSimulatorControl", "nook:shelf-trace-control"]) {
    assert.ok(!production.includes(marker), `production bundle contains ${marker}`);
    assert.ok(dev.includes(marker), `Dev bundle is missing ${marker}`);
  }
  assert.ok(readdirSync(prodDir).includes("sounds"));
  assert.ok(readdirSync(devDir).includes("sounds"));
});

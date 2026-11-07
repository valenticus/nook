import { defineConfig, type Plugin } from "vite";
import { existsSync, mkdirSync, readdirSync, copyFileSync, createReadStream } from "node:fs";
import { resolve, join, extname } from "node:path";

const isNookDevBuild = process.env.NOOK_DEV_BUILD === "1";
const isNookStandaloneBuild = process.env.NOOK_STANDALONE_BUILD === "1";
const frontendOutDir = isNookDevBuild ? "dist-dev" : isNookStandaloneBuild ? "dist-standalone" : "dist";

// ───────────────────────────────────────────────────────────────────────────────
// THE one and only place the sound folder is declared: the 28 WAVs in `sounds/`.
export const SOUNDS_DIR = resolve(__dirname, "sounds");
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Serves SOUNDS_DIR at /sounds/*.wav in dev, and copies it into the selected
 * frontend output directory on build.
 */
function sharedSounds(): Plugin {
  const prefix = "/sounds/";
  let outputDir = resolve(__dirname, frontendOutDir);
  return {
    name: "nook-shared-sounds",
    configResolved(config) {
      outputDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        const name = decodeURIComponent(req.url.slice(prefix.length).split("?")[0]);
        if (name.includes("/") || name.includes("\\") || extname(name) !== ".wav") return next();
        const file = join(SOUNDS_DIR, name);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", "audio/wav");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(outputDir, "sounds");
      if (!existsSync(SOUNDS_DIR)) {
        this.warn(`sounds not found at ${SOUNDS_DIR} — the build will ship without audio`);
        return;
      }
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(SOUNDS_DIR)) {
        if (extname(f) === ".wav") copyFileSync(join(SOUNDS_DIR, f), join(out, f));
      }
    },
  };
}

export default defineConfig({
  define: {
    __NOOK_DEV_BUILD__: JSON.stringify(isNookDevBuild),
    __NOOK_STANDALONE_BUILD__: JSON.stringify(isNookStandaloneBuild),
  },
  plugins: [sharedSounds()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: frontendOutDir,
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        island: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        agents: resolve(__dirname, "agents.html"),
      },
    },
  },
});

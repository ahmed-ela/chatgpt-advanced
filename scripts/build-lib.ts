import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const appDir = resolve(scriptsDir, "..");
export const distDir = resolve(appDir, "dist");
export const defaultDevPort = Number(process.env.PLANNOTATOR_EXTENSION_DEV_PORT ?? "19445");
const devReloadHosts = [
  "https://chatgpt.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*",
];

interface BuildExtensionOptions {
  dev?: boolean;
  buildId?: string;
  devOrigin?: string;
}

export async function buildExtension(options: BuildExtensionOptions = {}): Promise<void> {
  const dev = options.dev ?? false;
  const buildId = options.buildId ?? (dev ? createBuildId() : "prod");
  const devOrigin = normalizeDevOrigin(options.devOrigin ?? `http://127.0.0.1:${defaultDevPort}`);

  mkdirSync(distDir, { recursive: true });

  const entrypoints = [resolve(appDir, "src/content.ts")];
  if (dev) {
    entrypoints.push(resolve(appDir, "src/dev-worker.ts"));
  }

  const result = await Bun.build({
    entrypoints,
    outdir: distDir,
    target: "browser",
    format: "esm",
    minify: !dev,
    sourcemap: "linked",
    naming: {
      entry: "[name].js",
    },
    define: {
      __PLANNOTATOR_DEV__: JSON.stringify(dev),
      __PLANNOTATOR_BUILD_ID__: JSON.stringify(buildId),
      __PLANNOTATOR_DEV_ORIGIN__: JSON.stringify(dev ? devOrigin : ""),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("Browser extension build failed");
  }

  const manifest = await loadManifest();
  if (dev) {
    manifest.background = {
      service_worker: "dev-worker.js",
      type: "module",
    };
    manifest.permissions = uniqueStrings(manifest.permissions, ["storage", "tabs", "scripting"]);
    manifest.host_permissions = uniqueStrings(manifest.host_permissions, [...devReloadHosts, `${devOrigin}/*`]);
  } else {
    delete manifest.background;
    delete manifest.permissions;
    delete manifest.host_permissions;
  }

  await Bun.write(resolve(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function createBuildId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadManifest(): Promise<Record<string, unknown>> {
  const manifestFile = Bun.file(resolve(appDir, "manifest.json"));
  return JSON.parse(await manifestFile.text()) as Record<string, unknown>;
}

function normalizeDevOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function uniqueStrings(value: unknown, extras: string[]): string[] {
  const seen = new Set<string>();
  const combined = [
    ...(Array.isArray(value) ? value : []),
    ...extras,
  ];

  for (const entry of combined) {
    if (typeof entry === "string" && entry.trim()) {
      seen.add(entry);
    }
  }

  return [...seen];
}

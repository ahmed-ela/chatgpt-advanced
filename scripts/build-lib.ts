import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectVersion } from "./version";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const appDir = resolve(scriptsDir, "..");
export const distDir = resolve(appDir, "dist");
export const defaultDevPort = Number(process.env.PLANNOTATOR_EXTENSION_DEV_PORT ?? "19445");

export const providerMatches = ["https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*"];
export const fixtureMatches = ["http://127.0.0.1/*", "http://localhost/*"];
export const iconSizes = [16, 32, 48, 128];

interface BuildExtensionOptions {
  dev?: boolean;
  buildId?: string;
  devOrigin?: string;
  outdir?: string;
}

export async function buildExtension(options: BuildExtensionOptions = {}): Promise<void> {
  const dev = options.dev ?? false;
  const outputDir = resolve(options.outdir ?? distDir);
  const buildId = options.buildId ?? (dev ? createBuildId() : "prod");
  const devOrigin = normalizeDevOrigin(options.devOrigin ?? `http://127.0.0.1:${defaultDevPort}`);
  // Read fresh for every rebuild. Refuse inconsistent release metadata before
  // touching the installed extension's files.
  const version = await readProjectVersion(appDir);
  const manifest = await loadManifest();
  if ("version" in manifest || "version_name" in manifest) throw new Error("Set the version in package.json only; manifest.json is a build template.");
  manifest.version = version;
  if (dev) manifest.version_name = `${version} (development)`;
  const contentScripts = manifest.content_scripts as Array<Record<string, unknown>>;
  if (contentScripts.length !== 1) throw new Error("Expected one supported-provider content script registration.");
  contentScripts[0]!.matches = [...providerMatches, ...(dev ? fixtureMatches : [])];

  // Validate required local assets before changing the output directory.
  const assets = [
    ...iconSizes.map(size => ({ source: `assets/icons/${size}.png`, destination: `assets/icons/${size}.png` })),
    { source: "store/privacy.html", destination: "privacy.html" },
    { source: "node_modules/lucide/LICENSE", destination: "THIRD_PARTY_NOTICES.txt" },
  ];
  await Promise.all(assets.map(asset => readFile(resolve(appDir, asset.source))));
  await mkdir(outputDir, { recursive: true });

  const entrypoints = [
    resolve(appDir, "src/content.ts"),
    resolve(appDir, "src/queue-ui.ts"),
    resolve(appDir, "src/queue-worker.ts"),
  ];

  const result = await Bun.build({
    entrypoints,
    outdir: outputDir,
    target: "browser",
    format: "iife",
    minify: !dev,
    sourcemap: dev ? "linked" : "none",
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

  manifest.background = { service_worker: "queue-worker.js", type: "module" };
  delete manifest.permissions;
  if (dev) {
    // Only the worker contacts the local build server. Reloading needs no
    // tabs, scripting, or storage permissions and never forces busy pages.
    manifest.host_permissions = [`${devOrigin}/*`];
  } else {
    delete manifest.host_permissions;
  }

  await Bun.write(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const asset of assets) {
    const destination = resolve(outputDir, asset.destination);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(appDir, asset.source), destination);
  }
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

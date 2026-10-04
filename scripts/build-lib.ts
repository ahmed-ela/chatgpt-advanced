import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readProjectVersion } from "./version";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const appDir = resolve(scriptsDir, "..");
export const distDir = resolve(appDir, "dist");
export const firefoxDistDir = resolve(appDir, "dist-firefox");
export const defaultDevPort = Number(process.env.PLANNOTATOR_EXTENSION_DEV_PORT ?? "19445");
export type BrowserTarget = "chrome" | "firefox";
export const firefoxExtensionId = "threadlane@extensions.invalid";
// Firefox 140 introduced built-in install consent for these data categories.
// Queued prompts and annotation excerpts are sent to the user's AI provider;
// local-only storage and the absence of telemetry do not make this "none".
// https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
export const firefoxMinimumVersion = "140.0";
export const firefoxDataPermissions = ["personalCommunications", "websiteContent"];

export const providerMatches = ["https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*"];
export const fixtureMatches = ["http://127.0.0.1/*", "http://localhost/*"];
export const iconSizes = [16, 32, 48, 128];

export interface BuildExtensionOptions {
  target?: BrowserTarget;
  dev?: boolean;
  buildId?: string;
  devOrigin?: string;
  outdir?: string;
}

export async function buildExtension(options: BuildExtensionOptions = {}): Promise<void> {
  const target = browserTarget(options.target);
  const dev = options.dev ?? false;
  const outputDir = resolve(options.outdir ?? defaultOutputDirectory(target));
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

  if (target === "firefox") {
    // MV3 event pages are nonpersistent implicitly; Firefox rejects the
    // legacy persistent property even when its value is false.
    manifest.background = { scripts: ["queue-worker.js"] };
    // Omitting gecko_android keeps distribution desktop-only. web-ext #3561
    // can still warn about Android 142 consent support; do not opt into an
    // untested mobile platform just to suppress that warning.
    manifest.browser_specific_settings = {
      gecko: {
        id: firefoxExtensionId,
        strict_min_version: firefoxMinimumVersion,
        data_collection_permissions: { required: [...firefoxDataPermissions] },
      },
    };
    // Durable saved notes/queues must not include private browsing sessions.
    manifest.incognito = "not_allowed";
  } else {
    manifest.background = { service_worker: "queue-worker.js", type: "module" };
    delete manifest.browser_specific_settings;
  }
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

export function browserTarget(value: unknown = "chrome"): BrowserTarget {
  if (value !== "chrome" && value !== "firefox") throw new Error("Choose --target chrome or --target firefox.");
  return value;
}

export function defaultOutputDirectory(target: BrowserTarget = "chrome"): string {
  return browserTarget(target) === "firefox" ? firefoxDistDir : distDir;
}

/** Shared CLI flags; reject duplicates and missing values before any build writes. */
export function parseBuildArguments(args: string[]): { target: BrowserTarget; outdir?: string } {
  let target: BrowserTarget = "chrome";
  let outdir: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;
    const value = args[index + 1];
    if (!["--target", "--outdir"].includes(flag) || seen.has(flag) || !value || value.startsWith("--")) {
      throw new Error("Use [--target chrome|firefox] [--outdir <directory>], once per option.");
    }
    seen.add(flag);
    if (flag === "--target") target = browserTarget(value);
    else outdir = value;
  }
  return { target, ...(outdir ? { outdir } : {}) };
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

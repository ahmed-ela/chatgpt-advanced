import { watch } from "node:fs";
import { resolve } from "node:path";

import { appDir, buildExtension, createBuildId, defaultDevPort } from "./build-lib";
import { devIdentity } from "./dev-identity";

const devPort = defaultDevPort;
const identity = devIdentity(appDir, process.env.PLANNOTATOR_EXTENSION_DEV_OUTDIR);
const devOrigin = `http://127.0.0.1:${devPort}`;
const versionPath = "/__plannotator/version";
const rebuildPath = "/__plannotator/rebuild";
const corsHeaders = {
  "access-control-allow-origin": devOrigin,
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const watchTargets = [
  { path: resolve(appDir, "src"), recursive: true },
  // Watch the parent so atomic version-file replacements stay observable.
  { path: appDir, recursive: false },
];

let currentBuildId = "booting";
let pendingReason: string | null = null;
let buildPromise: Promise<void> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

await requestRebuild("startup");

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: devPort,
  routes: {
    [versionPath]: () => Response.json({ buildId: currentBuildId, ...identity }, {
      headers: corsHeaders,
    }),
    [rebuildPath]: async (request) => {
      const origin = request.headers.get("origin");
      if (origin && origin !== devOrigin) {
        return new Response("origin not allowed\n", { status: 403 });
      }
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      if (request.method !== "POST") {
        return new Response("method not allowed\n", {
          status: 405,
          headers: corsHeaders,
        });
      }

      await requestRebuild("manual request");
      return Response.json({ buildId: currentBuildId, ...identity }, {
        headers: corsHeaders,
      });
    },
  },
  fetch() {
    return new Response("plannotator browser-extension dev server\n", {
      headers: {
        ...corsHeaders,
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },
});

console.log(`[browser-extension] watching source and release metadata in ${appDir}`);
console.log(`[browser-extension] dev server ${devOrigin}${versionPath}`);
console.log(`[browser-extension] load unpacked ${identity.outputDir} once, then keep this running`);

for (const target of watchTargets) {
  watch(target.path, { recursive: target.recursive }, (_eventType, filename) => {
    const changed = typeof filename === "string" ? filename : target.path;
    if (target.path === appDir && !["manifest.json", "package.json", "CHANGELOG.md"].includes(changed)) return;
    scheduleRebuild(changed);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await new Promise(() => {});

function scheduleRebuild(reason: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void requestRebuild(reason);
  }, 80);
}

function requestRebuild(reason: string): Promise<void> {
  pendingReason = pendingReason ? `${pendingReason}, ${reason}` : reason;

  if (!buildPromise) {
    buildPromise = runRebuildLoop();
  }

  return buildPromise;
}

async function runRebuildLoop(): Promise<void> {
  while (pendingReason) {
    const reason = pendingReason;
    pendingReason = null;
    const nextBuildId = createBuildId();

    try {
      await buildExtension({
        dev: true,
        buildId: nextBuildId,
        devOrigin,
        outdir: identity.outputDir,
      });
      currentBuildId = nextBuildId;
      console.log(`[browser-extension] built ${currentBuildId} (${reason})`);
    } catch (error) {
      console.error(`[browser-extension] build failed (${reason})`);
      console.error(error);
    }
  }

  buildPromise = null;
}

function shutdown(code: number): never {
  server.stop(true);
  process.exit(code);
}

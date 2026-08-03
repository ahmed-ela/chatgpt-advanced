import { statSync, watch } from "node:fs";
import { resolve } from "node:path";

import { appDir, buildExtension, createBuildId, defaultDevPort } from "./build-lib";

const devPort = defaultDevPort;
const devOrigin = `http://127.0.0.1:${devPort}`;
const versionPath = "/__plannotator/version";
const rebuildPath = "/__plannotator/rebuild";
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const watchTargets = [
  resolve(appDir, "src"),
  resolve(appDir, "manifest.json"),
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
    [versionPath]: () => Response.json({ buildId: currentBuildId }, {
      headers: corsHeaders,
    }),
    [rebuildPath]: async (request) => {
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
      return Response.json({ buildId: currentBuildId }, {
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

console.log(`[browser-extension] watching ${watchTargets.join(", ")}`);
console.log(`[browser-extension] dev server ${devOrigin}${versionPath}`);
console.log(`[browser-extension] load unpacked ${resolve(appDir, "dist")} once, then keep this running`);

for (const target of watchTargets) {
  const recursive = statSync(target).isDirectory();
  watch(target, { recursive }, (_eventType, filename) => {
    const changed = typeof filename === "string" ? filename : target;
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

import { closeSync, mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { appDir, defaultDevPort } from "./build-lib";

const devOrigin = `http://127.0.0.1:${defaultDevPort}`;
const logPath = resolve(appDir, ".local/plannotator-dev.log");

try {
  await reload();
} catch (error) {
  console.error(`[browser-extension] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function reload(): Promise<void> {
  if (!Number.isInteger(defaultDevPort) || defaultDevPort < 1 || defaultDevPort > 65535) {
    throw new Error("PLANNOTATOR_EXTENSION_DEV_PORT must be a valid local port (1–65535).");
  }

  let previous = await readVersion();
  if (!previous) {
    mkdirSync(resolve(appDir, ".local"), { recursive: true });
    const log = openSync(logPath, "a");
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, ["run", resolve(appDir, "scripts/dev.ts")], {
        cwd: appDir,
        env: process.env,
        detached: true,
        stdio: ["ignore", log, log],
      });
    } finally { closeSync(log); }
    let startupError: Error | undefined;
    child.on("error", error => { startupError = error; });
    child.unref();

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (startupError) throw new Error(`Could not start the dev watcher: ${startupError.message}`);
      if (child.exitCode !== null) throw new Error(`Dev watcher exited (${child.exitCode}). See ${logPath}`);
      previous = await readVersion();
      if (previous) break;
      await Bun.sleep(150);
    }
    if (!previous) throw new Error(`Dev watcher did not become ready within 15 seconds. See ${logPath}`);
    console.log(`[browser-extension] started local watcher (PID ${child.pid})`);
  } else {
    console.log(`[browser-extension] using local watcher at ${devOrigin}`);
  }

  const response = await fetch(`${devOrigin}/__plannotator/rebuild`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Dev rebuild failed (HTTP ${response.status}). See ${logPath}`);
  const built = parseVersion(await response.json());
  if (built === "booting" || built === previous) {
    throw new Error(`The watcher did not produce a new successful build. See ${logPath}`);
  }
  const confirmed = await readVersion();
  if (!confirmed || confirmed === "booting") throw new Error(`Could not verify the rebuilt extension. See ${logPath}`);

  console.log(`[browser-extension] built ${built}`);
  console.log(`[browser-extension] watcher logs: ${logPath}`);
  console.log("[browser-extension] the watcher remains running and rebuilds future source edits automatically.");
  console.log("[browser-extension] one-time setup: Reload Threadlane in chrome://extensions, then refresh ChatGPT to activate the dev reload hook.");
}

async function readVersion(): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${devOrigin}/__plannotator/version`, { signal: AbortSignal.timeout(1_000) });
  } catch (error) {
    // Do not overwrite a different local service or spin up competing watchers
    // when a listener exists but is unresponsive.
    const code = (error as { code?: string; cause?: { code?: string } })?.code ??
      (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "ECONNREFUSED" || code === "ConnectionRefused") return null;
    throw new Error(`Cannot reach the dev watcher at ${devOrigin}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`A service at ${devOrigin} returned HTTP ${response.status}; refusing to start a second watcher.`);
  try { return parseVersion(await response.json()); }
  catch { throw new Error(`The service at ${devOrigin} is not a Threadlane dev watcher.`); }
}

function parseVersion(value: unknown): string {
  const buildId = value && typeof value === "object" ? (value as { buildId?: unknown }).buildId : undefined;
  if (typeof buildId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(buildId)) throw new Error("Invalid dev build response");
  return buildId;
}

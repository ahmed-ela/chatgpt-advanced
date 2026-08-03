import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(appDir, "dist");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const hostId = "plannotator-chatgpt-root";
const rebuildPath = "/__plannotator/rebuild";
const versionPath = "/__plannotator/version";

const harnessFile = Bun.file(resolve(appDir, "test/harness.html"));
const harnessHtml = await harnessFile.text();

const harnessServer = createServer((req, res) => {
  if (!req.url || req.url === "/" || req.url === "/harness.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(harnessHtml);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

await new Promise<void>((resolvePromise) => harnessServer.listen(0, "127.0.0.1", () => resolvePromise()));
const harnessAddress = harnessServer.address();
if (!harnessAddress || typeof harnessAddress === "string") {
  throw new Error("Failed to start harness server");
}

const harnessUrl = `http://127.0.0.1:${harnessAddress.port}/harness.html`;
const devPort = await getFreePort();
const devOrigin = `http://127.0.0.1:${devPort}`;
const profileDir = join(tmpdir(), `plannotator-browser-extension-dev-${Date.now()}`);
mkdirSync(profileDir, { recursive: true });

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
let devProcess: ReturnType<typeof spawn> | undefined;
const devLogs: string[] = [];

try {
  devProcess = spawn("bun", ["run", "scripts/dev.ts"], {
    cwd: appDir,
    env: {
      ...process.env,
      PLANNOTATOR_EXTENSION_DEV_PORT: String(devPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  devProcess.stdout?.on("data", (chunk) => pushDevLog(devLogs, chunk));
  devProcess.stderr?.on("data", (chunk) => pushDevLog(devLogs, chunk));

  await waitFor(async () => {
    try {
      const response = await fetch(`${devOrigin}${versionPath}`);
      if (!response.ok) return false;
      const payload = await response.json() as { buildId?: string };
      return Boolean(payload.buildId && payload.buildId !== "booting");
    } catch {
      return false;
    }
  }, 15_000, 120);

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    pipe: true,
    enableExtensions: [distDir],
    args: [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--window-size=1440,1200",
    ],
    defaultViewport: { width: 1440, height: 1200 },
  });

  const page = await browser.newPage();
  await page.goto(harnessUrl, { waitUntil: "networkidle0" });

  await waitFor(async () => {
    try {
      return await page.evaluate((rootIdValue) => {
        const root = document.getElementById(rootIdValue);
        return Boolean(root?.shadowRoot && root.getAttribute("data-build-id"));
      }, hostId);
    } catch {
      return false;
    }
  }, 15_000, 120);

  const initialBuildId = await page.evaluate((rootIdValue) => {
    return document.getElementById(rootIdValue)?.getAttribute("data-build-id") ?? "";
  }, hostId);

  if (!initialBuildId) {
    throw new Error("Initial dev build id was not exposed on the page");
  }

  const rebuildResponse = await fetch(`${devOrigin}${rebuildPath}`, { method: "POST" });
  if (!rebuildResponse.ok) {
    throw new Error(`Manual rebuild failed with ${rebuildResponse.status}`);
  }

  const rebuildPayload = await rebuildResponse.json() as { buildId?: string };
  const nextBuildId = rebuildPayload.buildId ?? "";
  if (!nextBuildId || nextBuildId === initialBuildId) {
    throw new Error(`Expected a new build id after rebuild, got "${nextBuildId}"`);
  }

  await waitFor(async () => {
    try {
      return await page.evaluate((rootIdValue, expectedBuildId) => {
        return document.getElementById(rootIdValue)?.getAttribute("data-build-id") === expectedBuildId;
      }, hostId, nextBuildId);
    } catch {
      return false;
    }
  }, 20_000, 150);

  console.log("Browser extension dev hot reload passed.");
  console.log(`Build id ${initialBuildId} -> ${nextBuildId}`);
  console.log(`Harness URL: ${harnessUrl}`);
} catch (error) {
  const logs = devLogs.join("");
  if (logs.trim()) {
    console.error("Dev watcher logs:");
    console.error(logs);
  }
  throw error;
} finally {
  await browser?.close();
  if (devProcess && devProcess.exitCode === null) {
    devProcess.kill("SIGTERM");
    await waitForProcessExit(devProcess, 5_000);
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    harnessServer.close((error) => error ? rejectPromise(error) : resolvePromise());
  });
  rmSync(profileDir, { recursive: true, force: true });
}

function pushDevLog(logs: string[], chunk: Buffer | string): void {
  logs.push(String(chunk));
  if (logs.length > 40) {
    logs.shift();
  }
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise()));
  const address = server.address();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
  });

  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate a free port");
  }

  return address.port;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await Bun.sleep(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function waitForProcessExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return;

  await Promise.race([
    new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
    Bun.sleep(timeoutMs),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

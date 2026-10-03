declare const __PLANNOTATOR_DEV_ORIGIN__: string;
declare const __PLANNOTATOR_BUILD_ID__: string;

interface DevMessageSender {
  tab?: { id?: number; url?: string };
  url?: string;
  frameId?: number;
}

type DevReply = { ok: true; scheduled: boolean } | { ok: true; buildId: string; workerBuildId: string } | { ok: false; error: string };
type DevListener = (message: unknown, sender: DevMessageSender, respond: (reply: DevReply) => void) => void | boolean;

export interface DevReloadRuntime {
  reload(): void;
  onMessage: { addListener(listener: DevListener): void };
}

interface DevReloadOptions {
  origin: string;
  workerBuildId: string;
  schedule?: (callback: () => void | Promise<void>, delayMs: number) => unknown;
  canReload?: () => Promise<boolean>;
  fetchVersion?: (input: string, init?: RequestInit) => Promise<Response>;
}

function supportedPage(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? "");
    if (url.username || url.password) return null;
    if (["https://chatgpt.com", "https://claude.ai", "https://gemini.google.com"].includes(url.origin)) return url;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url;
  } catch { /* Unavailable or malformed sender URL. */ }
  return null;
}

function isSupportedSender(sender: DevMessageSender): boolean {
  if (!Number.isInteger(sender.tab?.id) || (sender.tab!.id as number) < 0 || sender.frameId !== 0) return false;
  // sender.url is the document that sent the message. tab.url, when present,
  // additionally rejects a request whose tab already navigated elsewhere.
  const documentUrl = supportedPage(sender.url);
  if (!documentUrl) return false;
  if (sender.tab?.url !== undefined) {
    const tabUrl = supportedPage(sender.tab.url);
    if (!tabUrl || tabUrl.origin !== documentUrl.origin || tabUrl.pathname !== documentUrl.pathname) return false;
  }
  return true;
}

/** Loaded only by the development build. Pages refresh themselves when safe. */
export function registerDevReload(runtime: DevReloadRuntime, options: DevReloadOptions): void {
  const devOrigin = supportedPage(options.origin);
  if (!devOrigin || devOrigin.protocol !== "http:") throw new Error("Development reload requires a localhost HTTP origin.");
  const versionUrl = `${devOrigin.origin}/__plannotator/version`;
  const schedule = options.schedule ?? ((callback: () => void | Promise<void>, delayMs: number) => setTimeout(() => { void callback(); }, delayMs));
  const canReload = options.canReload ?? (async () => true);
  const fetchVersion = options.fetchVersion ?? fetch;
  let reloadQueued = false;
  let pendingSafetyCheck: Promise<boolean> | null = null;
  const checkSafety = (): Promise<boolean> => {
    if (!pendingSafetyCheck) {
      pendingSafetyCheck = Promise.resolve().then(canReload).catch(() => false).finally(() => { pendingSafetyCheck = null; });
    }
    return pendingSafetyCheck;
  };
  runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || typeof message !== "object") return;
    const type = (message as { type?: unknown }).type;
    if (type !== "plannotator:dev-reload" && type !== "plannotator:dev-version") return;
    if (!isSupportedSender(sender)) {
      respond({ ok: false, error: "Dev reload requires a supported top-level page." });
      return false;
    }
    if (type === "plannotator:dev-version") {
      void (async () => {
        try {
          const response = await fetchVersion(versionUrl, { cache: "no-store", signal: AbortSignal.timeout(3000) });
          if (!response.ok) throw new Error("Development server is unavailable.");
          const payload: unknown = await response.json();
          const buildId = payload && typeof payload === "object" ? (payload as { buildId?: unknown }).buildId : undefined;
          if (typeof buildId !== "string" || !buildId.trim()) throw new Error("Development server returned no build ID.");
          respond({ ok: true, buildId, workerBuildId: options.workerBuildId });
        } catch (error) {
          respond({ ok: false, error: error instanceof Error ? error.message : "Development server is unavailable." });
        }
      })();
      return true;
    }
    void (async () => {
      if (!await checkSafety()) { respond({ ok: true, scheduled: false }); return; }
      if (!reloadQueued) {
        reloadQueued = true;
        schedule(async () => {
          // A different tab may start typing, editing, or sending while this
          // request is scheduled. Recheck every page before invalidating it.
          if (!await checkSafety()) { reloadQueued = false; return; }
          try { runtime.reload(); }
          catch (error) {
            reloadQueued = false;
            console.error("[plannotator] development reload failed", error);
          }
        }, 160);
      }
      respond({ ok: true, scheduled: true });
    })();
    return true;
  });
}

export interface DevReloadTabs {
  query(queryInfo: Record<string, never>): Promise<Array<{ id?: number }>>;
  sendMessage(tabId: number, message: { type: "plannotator:dev-can-reload" }, options: { frameId: 0 }): Promise<unknown>;
}

/** Tab IDs and content-script messaging do not require the tabs permission. */
export async function allExtensionPagesSafe(tabs: DevReloadTabs, timeoutMs = 1_000): Promise<boolean> {
  const deadline = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Page safety check timed out")), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  try {
    const openTabs = await deadline(tabs.query({}));
    const readiness = await Promise.all(openTabs.map(async (tab) => {
      if (!Number.isInteger(tab.id) || (tab.id as number) < 0) return false;
      try {
        const reply = await deadline(tabs.sendMessage(tab.id!, { type: "plannotator:dev-can-reload" }, { frameId: 0 }));
        // Only an explicit reply from our content script establishes safety.
        return Boolean(reply && typeof reply === "object" &&
          (reply as { ok?: unknown }).ok === true && (reply as { safe?: unknown }).safe === true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Ordinary tabs have no extension receiver. A closed tab no longer
        // has an editor to protect. Unknown errors and timeouts remain unsafe.
        return /receiving end does not exist|no tab with id|the tab was closed|tab not found/i.test(message);
      }
    }));
    return readiness.every(Boolean);
  } catch { return false; }
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: { runtime?: DevReloadRuntime; tabs?: DevReloadTabs } }).chrome;
if (chromeApi?.runtime) registerDevReload(chromeApi.runtime, {
  origin: __PLANNOTATOR_DEV_ORIGIN__, workerBuildId: __PLANNOTATOR_BUILD_ID__,
  canReload: () => chromeApi.tabs ? allExtensionPagesSafe(chromeApi.tabs) : Promise.resolve(false),
});

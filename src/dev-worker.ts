interface ChromeRuntimeMessage {
  type?: string;
  buildId?: string;
}

interface ChromeMessageSender {
  tab?: {
    id?: number;
  };
}

interface ChromeRuntimeApi {
  reload(): void;
  onMessage: {
    addListener(callback: (message: ChromeRuntimeMessage, sender: ChromeMessageSender) => void | boolean): void;
  };
}

interface ChromeStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  remove(keys: string[]): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ChromeTabsApi {
  query(queryInfo: { url: string[] }): Promise<Array<{ id?: number }>>;
  reload(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: ChromeRuntimeMessage): Promise<unknown>;
}

interface ChromeScriptingApi {
  executeScript(options: {
    target: { tabId: number };
    world?: "MAIN" | "ISOLATED";
    func: (delayMs: number) => void;
    args?: [number];
  }): Promise<unknown>;
}

interface ChromeApi {
  runtime?: ChromeRuntimeApi;
  storage?: {
    local?: ChromeStorageArea;
  };
  tabs?: ChromeTabsApi;
  scripting?: ChromeScriptingApi;
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApi }).chrome;

const pendingReloadKey = "plannotator-dev-reload-queued-at";
const pendingReloadTtlMs = 15_000;
const reloadBroadcastDelayMs = 160;
const watchedUrls = [
  "https://chatgpt.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*",
];
let reloadQueued = false;

if (chromeApi?.runtime && chromeApi.storage?.local && chromeApi.tabs) {
  chromeApi.runtime.onMessage.addListener((message) => {
    if (message?.type !== "plannotator:dev-reload") {
      return;
    }

    void queueExtensionReload(message.buildId).catch((error) => {
      console.error("[browser-extension] dev reload failed", error);
    });
  });

  void resumePendingTabReloads();
}

async function queueExtensionReload(buildId?: string): Promise<void> {
  if (!chromeApi?.runtime || !chromeApi.storage?.local || !chromeApi.tabs || reloadQueued) return;

  reloadQueued = true;
  try {
    await chromeApi.storage.local.set({
      [pendingReloadKey]: Date.now(),
    });

    const tabIds = await getWatchedTabIds();
    await Promise.allSettled(
      tabIds.map((tabId) => chromeApi.tabs!.sendMessage(tabId, {
        type: "plannotator:dev-page-reload",
        buildId,
      })),
    );
    if (chromeApi.scripting) {
      await Promise.allSettled(
        tabIds.map((tabId) => chromeApi.scripting!.executeScript({
          target: { tabId },
          world: "MAIN",
          func: reloadPageInMainWorld,
          args: [reloadBroadcastDelayMs + 180],
        })),
      );
    }

    await delay(reloadBroadcastDelayMs);
    chromeApi.runtime.reload();
  } catch (error) {
    reloadQueued = false;
    throw error;
  }
}

async function resumePendingTabReloads(): Promise<void> {
  if (!chromeApi?.storage?.local || !chromeApi.tabs) return;

  const stored = await chromeApi.storage.local.get([pendingReloadKey]);
  const queuedAt = Number(stored[pendingReloadKey] ?? 0);

  if (!queuedAt || Date.now() - queuedAt > pendingReloadTtlMs) {
    if (queuedAt) {
      await chromeApi.storage.local.remove([pendingReloadKey]);
    }
    return;
  }

  await Promise.all(
    (await getWatchedTabIds()).map((tabId) => chromeApi.tabs!.reload(tabId)),
  );
  await chromeApi.storage.local.remove([pendingReloadKey]);
}

async function getWatchedTabIds(): Promise<number[]> {
  if (!chromeApi?.tabs) return [];

  const tabs = await chromeApi.tabs.query({ url: watchedUrls });
  return tabs
    .map((tab) => tab.id)
    .filter((tabId): tabId is number => typeof tabId === "number");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reloadPageInMainWorld(delayMs: number): void {
  window.setTimeout(() => {
    window.location.reload();
  }, delayMs);
}

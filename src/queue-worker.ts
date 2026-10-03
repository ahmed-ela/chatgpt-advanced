import { getQueueKey, QUEUE_CHANGED_TYPE, QUEUE_MESSAGE_TYPE, QueueStore, type QueueRequest, type QueueResponse } from "./queue-store";

declare const __PLANNOTATOR_DEV__: boolean;
interface QueueSender { tab?: { id?: number; url?: string }; url?: string; frameId?: number }
interface QueueChrome {
  runtime?: {
    onMessage: { addListener(listener: (message: unknown, sender: QueueSender, respond: (response: QueueResponse) => void) => boolean | void): void };
  };
  tabs?: { sendMessage(tabId: number, message: unknown): Promise<unknown> };
}
const chromeApi = (globalThis as typeof globalThis & { chrome?: QueueChrome }).chrome;
const store = new QueueStore();
const seenTabs = new Map<number, string>();

chromeApi?.runtime?.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== "object" || (message as { type?: string }).type !== QUEUE_MESSAGE_TYPE) return;
  const request = message as QueueRequest;
  const tabId = sender.tab?.id;
  const tabKey = getQueueKey(sender.tab?.url ?? sender.url ?? "");
  if (typeof tabId !== "number" || (sender.frameId !== undefined && sender.frameId !== 0) || !tabKey || request.key !== tabKey) {
    respond({ ok: false, error: "Queue conversation does not match the current tab" });
    return false;
  }
  seenTabs.set(tabId, tabKey);
  void store.apply(request, `${tabId}:${request.clientId}`).then((result) => {
    respond({ ok: true, state: result.state, ...(result.claimed ? { claimed: result.claimed } : {}) });
    // Broadcasting lease renewals would make event-driven tabs wake and renew
    // one another indefinitely. Idle releases do wake peers immediately.
    if (result.changed && request.action !== "edit-heartbeat" && (request.action !== "heartbeat" || request.busy === false)) {
      for (const [knownTab, knownKey] of seenTabs) {
        if (knownKey !== request.key) continue;
        void chromeApi?.tabs?.sendMessage(knownTab, {
          type: QUEUE_CHANGED_TYPE, key: request.key, revision: result.state.revision,
        }).catch(() => { seenTabs.delete(knownTab); });
      }
    }
  }).catch((error: unknown) => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Queue could not be saved. Your message has not been cleared." });
  });
  return true;
});

// Keep development auto-reload and the durable queue in one MV3 worker.
if (__PLANNOTATOR_DEV__) void import("./dev-worker");

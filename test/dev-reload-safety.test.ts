import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { runInContext } from "node:vm";

const build = await Bun.build({
  entrypoints: [new URL("../src/content.ts", import.meta.url).pathname],
  target: "browser", format: "esm",
});
if (!build.success) throw new Error(build.logs.join("\n"));
const compiled = await build.outputs[0]!.text();

interface DevMessage { type: string; buildId?: string }
let dom: Window;
let doc: Document;
let composer: HTMLElement;
let action: HTMLButtonElement;
let queueHost: HTMLElement;
let noteHost: HTMLElement;
let calls: DevMessage[];
let response: (message: DevMessage) => unknown;
let interval: () => void;
let onMessage: (message: DevMessage, sender?: unknown, respond?: (reply: unknown) => void) => void;
let reloads: number;
let timers: Array<() => void>;
let helpers: {
  startDevHotReload(): void;
  state: { draftEditorOpen: boolean; draftText: string; actionFeedback: string };
};

beforeEach(() => {
  dom = new Window({ url: "https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  doc = dom.document as unknown as Document;
  doc.write(`
    <div data-composer-body>
      <div data-composer-markdown contenteditable="true" role="textbox"></div>
      <button aria-label="Send message">Send</button>
    </div>
    <div id="plannotator-chatgpt-root"></div>
    <div id="plannotator-message-queue"></div>`);
  composer = doc.querySelector("[data-composer-markdown]")!;
  action = doc.querySelector("button")!;
  noteHost = doc.getElementById("plannotator-chatgpt-root")!;
  queueHost = doc.getElementById("plannotator-message-queue")!;
  noteHost.attachShadow({ mode: "open" });
  queueHost.attachShadow({ mode: "open" });
  calls = []; timers = []; reloads = 0;
  response = message => message.type === "plannotator:dev-version"
    ? { ok: true, buildId: "new-build", workerBuildId: "installed-build" }
    : { ok: true, scheduled: true };
  Object.assign(dom, {
    Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise, URL, atob,
    chrome: { runtime: {
      async sendMessage(message: DevMessage) { calls.push(message); return response(message); },
      onMessage: { addListener(listener: typeof onMessage) { onMessage = listener; } },
    } },
    // Development traffic must go through the worker, never ChatGPT's page origin.
    fetch: () => { throw new Error("Page fetch must not be used for development version checks"); },
    setInterval(callback: () => void) { interval = callback; return 1; },
    setTimeout(callback: () => void) { timers.push(callback); return timers.length; },
  });
  Object.defineProperty(dom, "top", { value: {}, configurable: true });
  Object.defineProperty(dom.location, "reload", { value: () => { reloads++; }, configurable: true });
  Object.defineProperties(dom.HTMLElement.prototype, {
    getClientRects: { value: () => [new dom.DOMRect(100, 650, 700, 100)], configurable: true },
    getBoundingClientRect: { value: () => new dom.DOMRect(100, 650, 700, 100), configurable: true },
  });
  helpers = runInContext(`
    const __PLANNOTATOR_DEV__ = true;
    const __PLANNOTATOR_BUILD_ID__ = "installed-build";
    const __PLANNOTATOR_DEV_ORIGIN__ = "http://127.0.0.1:19445";
    ${compiled}
    ({ startDevHotReload, state });
  `, dom) as typeof helpers;
});

afterEach(async () => { await dom.happyDOM.close(); });
async function flush(): Promise<void> { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); }
async function start(): Promise<void> { helpers.startDevHotReload(); await flush(); }
async function poll(): Promise<void> { interval(); await flush(); }
function runTimer(): void {
  const callback = timers.shift();
  if (!callback) throw new Error("No reload timer was scheduled");
  callback();
}
function reloadRequests(): DevMessage[] { return calls.filter(call => call.type === "plannotator:dev-reload"); }
async function confirmWorkerReload(): Promise<void> {
  response = message => message.type === "plannotator:dev-version"
    ? { ok: true, buildId: "new-build", workerBuildId: "new-build" }
    : { ok: true, scheduled: true };
  await poll();
}

describe("safe development reload", () => {
  test("requests the worker update and refreshes only after its new build is confirmed", async () => {
    await start();
    expect(calls).toEqual([
      { type: "plannotator:dev-version" },
      { type: "plannotator:dev-reload", buildId: "new-build" },
    ]);
    expect(reloads).toBe(0);
    expect(timers).toHaveLength(0);
    await confirmWorkerReload();
    runTimer();
    expect(reloads).toBe(1);
  });

  const blockers: Array<[string, () => void, () => void]> = [
    ["a generating response", () => action.setAttribute("aria-label", "Stop streaming"), () => action.setAttribute("aria-label", "Send message")],
    ["an unsent composer draft", () => { composer.textContent = "Keep my draft"; }, () => { composer.textContent = ""; }],
    ["an attachment", () => composer.parentElement!.insertAdjacentHTML("beforeend", '<div data-attachment-id="upload">file.pdf</div>'), () => doc.querySelector("[data-attachment-id]")!.remove()],
    ["an unfinished note", () => { helpers.state.draftEditorOpen = true; helpers.state.draftText = "Note in progress"; }, () => { helpers.state.draftEditorOpen = false; helpers.state.draftText = ""; }],
    ["an open note editor", () => { noteHost.shadowRoot!.innerHTML = '<textarea data-field="comment">Editing note</textarea>'; }, () => noteHost.shadowRoot!.replaceChildren()],
    ["an open queue editor", () => { queueHost.shadowRoot!.innerHTML = '<textarea aria-label="Edit queued message">Editing message</textarea>'; }, () => queueHost.shadowRoot!.replaceChildren()],
    ["an in-flight queue operation", () => queueHost.setAttribute("data-reload-blocked", "true"), () => queueHost.removeAttribute("data-reload-blocked")],
    ["a note awaiting persistence", () => { runInContext("persistTimer = 42", dom); }, () => { runInContext("persistTimer = null", dom); }],
  ];
  for (const [name, block, unblock] of blockers) {
    test(`waits for ${name} before requesting or refreshing`, async () => {
      block();
      await start();
      expect(reloadRequests()).toHaveLength(0);
      expect(timers).toHaveLength(0);
      expect(noteHost.dataset.reloadState).toBe("waiting-for-idle");
      unblock();
      await poll();
      expect(reloadRequests()).toHaveLength(1);
      await confirmWorkerReload();
      runTimer();
      expect(reloads).toBe(1);
    });
  }

  test("rechecks at refresh time and preserves typing that began after worker acknowledgement", async () => {
    await start();
    await confirmWorkerReload();
    composer.textContent = "Typed during the reload delay";
    runTimer();
    expect(reloads).toBe(0);
    expect(timers).toHaveLength(0);
    expect(noteHost.dataset.reloadState).toBe("waiting-for-idle");
    await poll();
    expect(reloadRequests()).toHaveLength(1);
    expect(timers).toHaveLength(0);
    composer.textContent = "";
    await poll();
    runTimer();
    expect(reloads).toBe(1);
    expect(reloadRequests()).toHaveLength(1);
  });

  test("another busy tab defers the global reload without refreshing this page", async () => {
    response = message => message.type === "plannotator:dev-version"
      ? { ok: true, buildId: "new-build", workerBuildId: "installed-build" }
      : { ok: true, scheduled: false };
    await start(); await poll();
    expect(reloads).toBe(0);
    expect(timers).toHaveLength(0);
    expect(noteHost.dataset.reloadState).toBe("waiting-for-other-tabs");
  });

  test("answers global reload safety checks using current draft and queue-operation state", async () => {
    await start();
    const check = () => {
      let reply: unknown;
      onMessage({ type: "plannotator:dev-can-reload" }, undefined, value => { reply = value; });
      return reply;
    };
    expect(check()).toEqual({ ok: true, safe: true });
    composer.textContent = "Unsent draft";
    expect(check()).toEqual({ ok: true, safe: false });
    composer.textContent = "";
    queueHost.setAttribute("data-reload-blocked", "true");
    expect(check()).toEqual({ ok: true, safe: false });
    queueHost.removeAttribute("data-reload-blocked");
    expect(check()).toEqual({ ok: true, safe: true });
  });

  test("an invalidated context reconnects once safe without repeatedly messaging the dead runtime", async () => {
    response = () => { throw new Error("Extension context invalidated."); };
    composer.textContent = "Preserve this while another tab updates";
    await start();
    expect(calls).toHaveLength(1);
    expect(timers).toHaveLength(0);
    await poll();
    expect(calls).toHaveLength(1);
    composer.textContent = "";
    await poll();
    runTimer();
    expect(reloads).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test("an unavailable dev server neither reloads the extension nor refreshes the page", async () => {
    response = () => ({ ok: false, error: "Dev server unavailable" });
    await start();
    await poll();
    expect(reloadRequests()).toHaveLength(0);
    expect(timers).toHaveLength(0);
    expect(reloads).toBe(0);
  });

  test.each(["Receiving end does not exist", "The message port closed", "The message channel closed"])("transient IPC failure is not evidence to refresh: %s", async message => {
    response = () => { throw new Error(message); };
    await start(); await poll();
    expect(calls).toHaveLength(2);
    expect(timers).toHaveLength(0);
    expect(reloads).toBe(0);
  });

  test("refreshes a stale worker even when this page already has the server's new content build", async () => {
    response = message => message.type === "plannotator:dev-version"
      ? { ok: true, buildId: "installed-build", workerBuildId: "old-worker-build" }
      : { ok: true, scheduled: true };
    await start();
    expect(reloadRequests()).toEqual([{ type: "plannotator:dev-reload", buildId: "installed-build" }]);
    expect(timers).toHaveLength(0);
    response = () => { throw new Error("Extension context invalidated."); };
    await poll();
    runTimer();
    expect(reloads).toBe(1);
  });

  test("refreshes only stale content when another tab already updated the worker", async () => {
    response = () => ({ ok: true, buildId: "new-build", workerBuildId: "new-build" });
    await start();
    expect(calls).toEqual([{ type: "plannotator:dev-version" }]);
    expect(reloadRequests()).toHaveLength(0);
    expect(timers).toHaveLength(1);
    runTimer();
    expect(reloads).toBe(1);
    expect(reloadRequests()).toHaveLength(0);
  });

  test("defers stale content refresh while preserving a draft without reloading the current worker", async () => {
    response = () => ({ ok: true, buildId: "new-build", workerBuildId: "new-build" });
    composer.textContent = "Keep this draft";
    await start();
    await poll();
    expect(calls).toEqual([{ type: "plannotator:dev-version" }]);
    expect(reloadRequests()).toHaveLength(0);
    expect(timers).toHaveLength(0);
    composer.textContent = "";
    await poll();
    runTimer();
    expect(reloads).toBe(1);
    expect(reloadRequests()).toHaveLength(0);
  });

  test("a legacy reload broadcast also waits for queue editing to finish", async () => {
    response = () => ({ ok: true, buildId: "installed-build", workerBuildId: "installed-build" });
    await start();
    queueHost.shadowRoot!.innerHTML = "<textarea>Unfinished edit</textarea>";
    onMessage({ type: "plannotator:dev-page-reload", buildId: "new-build" });
    expect(timers).toHaveLength(0);
    queueHost.shadowRoot!.replaceChildren();
    await poll();
    runTimer();
    expect(reloads).toBe(1);
    expect(reloadRequests()).toHaveLength(0);
  });
});

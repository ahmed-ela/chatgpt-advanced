import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { runInContext } from "node:vm";
import { QueueStore, QUEUE_MESSAGE_TYPE, QUEUE_EDIT_MS, type QueueRequest, type QueueState } from "../src/queue-store";

// Bundle the real adapter/UI together, then run each tab in its own DOM realm.
// This preserves actual event propagation and avoids sharing global document
// state between simultaneous tabs. Only the extension message transport is local.
const build = await Bun.build({ entrypoints: [new URL("../src/queue-ui.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!build.success) throw new Error(build.logs.join("\n"));
const source = (await build.outputs[0]!.text()).replace(/export\s*\{\s*MessageQueue\s*\};?\s*$/, "globalThis.__MessageQueue = MessageQueue;");
const key = "chatgpt:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface QueueView {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  pollTimer: number;
  lastPoll: number;
  polling: boolean;
  dispatching: boolean;
  saving: boolean;
  state: QueueState | null;
}
interface Tab {
  dom: Window;
  doc: Document;
  queue: QueueView;
  composer: HTMLElement;
  action: HTMLButtonElement;
  shadow: ShadowRoot;
  requests: QueueRequest[];
  listener?: (message: { type: string; key: string }) => void;
  before?: (request: QueueRequest) => Promise<void> | void;
  after?: (request: QueueRequest) => Promise<void> | void;
}

let store: QueueStore;
let tabs: Tab[];
let now: number;
const fixture = `
  <main data-chatgpt-selection-conversation-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa">
    <article data-chatgpt-search-unit-key="11111111-1111-4111-8111-111111111111:user" data-chatgpt-search-message-ids="11111111-1111-4111-8111-111111111111">
      <div data-user-message-bubble data-markdown-text-style="user-message">Initial request</div>
    </article>
    <article data-chatgpt-search-unit-key="initial-assistant:assistant" data-chatgpt-selection-message-id="initial-assistant">
      <div data-markdown-text-style="assistant-message">Initial complete response</div>
      <div class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div>
    </article>
  </main>
  <div data-composer-body>
    <div data-composer-markdown contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>
    <button id="native-action" aria-label="Stop streaming">Stop</button>
  </div>`;

beforeEach(() => { store = new QueueStore(new IDBFactory(), `queue-ui-${crypto.randomUUID()}`); tabs = []; now = Date.now(); });
afterEach(async () => {
  for (const tab of tabs) { tab.queue.stop(); await tab.dom.happyDOM.close(); }
  await store.close();
});

async function waitFor(predicate: () => boolean, message = "condition", timeout = 2500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function createTab(options: { newChat?: boolean; idle?: boolean; visibility?: DocumentVisibilityState; before?: Tab["before"]; returnBeforeRead?: boolean } = {}): Promise<Tab> {
  const dom = new Window({ url: options.newChat ? "https://chatgpt.com/" : "https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const doc = dom.document as unknown as Document;
  doc.write(fixture);
  if (options.newChat) {
    doc.querySelector("main")!.replaceChildren();
    doc.querySelector("main")!.removeAttribute("data-chatgpt-selection-conversation-id");
    doc.querySelector("#native-action")!.setAttribute("aria-label", "Send message");
  }
  if (options.idle) doc.querySelector("#native-action")!.setAttribute("aria-label", "Send message");
  Object.assign(dom, { Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise, URL, atob, MessageChannel });
  Object.defineProperty(dom, "top", { value: {}, configurable: true });
  Object.defineProperty(doc, "visibilityState", { value: options.visibility ?? "visible", configurable: true });
  Object.defineProperties(dom.HTMLElement.prototype, {
    getClientRects: { value: () => [new dom.DOMRect(100, 650, 700, 100)], configurable: true },
    getBoundingClientRect: { value: () => new dom.DOMRect(100, 650, 700, 100), configurable: true },
  });
  runInContext(source, dom);
  const Constructor = (dom as unknown as { __MessageQueue: new (runtime: unknown) => QueueView }).__MessageQueue;
  const tab = { dom, doc, requests: [], before: options.before } as unknown as Tab;
  const runtime = {
    onMessage: { addListener(listener: Tab["listener"]) { tab.listener = listener; } },
    async sendMessage(raw: unknown) {
      const request = raw as QueueRequest;
      tab.requests.push(request);
      await tab.before?.(request);
      const result = await store.apply(request, `tab-${tabs.indexOf(tab)}:${request.clientId}`, now);
      await tab.after?.(request);
      if (result.changed && !(request.action === "heartbeat" && request.busy === true) && request.action !== "edit-heartbeat") {
        queueMicrotask(() => {
          for (const other of tabs) other.listener?.({ type: "plannotator:queue:changed", key });
        });
      }
      return { ok: true, state: result.state, claimed: result.claimed };
    },
  };
  tab.queue = new Constructor(runtime);
  tab.composer = doc.querySelector("[data-composer-markdown]")!;
  tab.action = doc.querySelector("#native-action")!;
  tabs.push(tab);
  tab.queue.start();
  tab.shadow = doc.getElementById("plannotator-message-queue")!.shadowRoot!;
  if (!options.returnBeforeRead) await waitFor(() => (options.newChat || Boolean(tab.queue.state)) && !tab.queue.polling, "initial queue read");
  return tab;
}

function draft(tab: Tab, text: string): void {
  tab.composer.textContent = text;
  tab.composer.dispatchEvent(new tab.dom.InputEvent("input", { bubbles: true, composed: true }) as unknown as InputEvent);
}
function draftBuffer(tab: Tab): HTMLTextAreaElement | null {
  return tab.doc.querySelector('[data-plannotator-queue-root="draft-buffer"]')?.shadowRoot?.querySelector("textarea") ?? null;
}
function typeInBuffer(tab: Tab, text: string): HTMLTextAreaElement {
  const buffer = draftBuffer(tab);
  if (!buffer) throw new Error("Expected the protected draft input");
  buffer.value = text;
  buffer.dispatchEvent(new tab.dom.InputEvent("input", { bubbles: true, composed: true }) as unknown as InputEvent);
  return buffer;
}
function enterBuffer(tab: Tab): boolean {
  const buffer = draftBuffer(tab);
  if (!buffer) throw new Error("Expected the protected draft input");
  return buffer.dispatchEvent(new tab.dom.KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, composed: true, cancelable: true,
  }) as unknown as KeyboardEvent);
}
function enter(tab: Tab, options: { shiftKey?: boolean; isComposing?: boolean } = {}): boolean {
  return tab.composer.dispatchEvent(new tab.dom.KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, composed: true, cancelable: true, ...options,
  }) as unknown as KeyboardEvent);
}
function busy(tab: Tab, value: boolean): void {
  tab.action.setAttribute("aria-label", value ? "Stop streaming" : "Send message");
  tab.action.textContent = value ? "Stop" : "Send";
}
function visibility(tab: Tab, state: DocumentVisibilityState): void {
  Object.defineProperty(tab.doc, "visibilityState", { value: state, configurable: true });
  tab.doc.dispatchEvent(new tab.dom.Event("visibilitychange") as unknown as Event);
}
function button(tab: Tab, action: string, id?: string): HTMLButtonElement {
  const selector = `${id ? `li[data-id='${id}'] ` : ""}button[data-action='${action}']`;
  const result = tab.shadow.querySelector<HTMLButtonElement>(selector);
  if (!result) throw new Error(`Missing queue control: ${selector}. ${tab.shadow.textContent}`);
  return result;
}
function drag(tab: Tab, from: Element, to: Element): void {
  const dataTransfer = new tab.dom.DataTransfer();
  // Happy-dom's DragEvent is an Event alias, so attach the native payload.
  for (const [target, type] of [[from, "dragstart"], [to, "dragover"], [to, "drop"], [from, "dragend"]] as const) {
    const event = new tab.dom.Event(type, { bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    target.dispatchEvent(event as unknown as Event);
  }
}
function dragMessage(tab: Tab, fromId: string, toId: string): void {
  const handle = tab.shadow.querySelector(`li[data-id='${fromId}'] [draggable='true']`);
  const target = tab.shadow.querySelector(`li[data-id='${toId}']`);
  if (!handle || !target) throw new Error("Missing queue drag handle or drop target");
  drag(tab, handle, target);
}
async function persisted(): Promise<QueueState> {
  return (await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "read", clientId: "inspector" }, "inspector", now)).state;
}
async function poll(tab: Tab): Promise<void> {
  await waitFor(() => !tab.queue.polling && !tab.queue.dispatching && !tab.queue.saving, "idle before explicit poll");
  tab.queue.lastPoll = 0;
  await tab.queue.tick();
}
async function enqueue(tab: Tab, text: string): Promise<string> {
  draft(tab, text);
  enter(tab);
  await waitFor(() => !tab.queue.saving, "enqueue commit");
  const item = (await persisted()).items.find(entry => entry.text === text);
  if (!item) throw new Error(`Message was not saved: ${text}`);
  return item.id;
}

async function editInComposer(tab: Tab, id: string): Promise<void> {
  button(tab, "edit", id).click();
  await waitFor(() => tab.queue.state?.items.find(item => item.id === id)?.status === "editing" && Boolean(tab.composer.innerText), "queue edit reservation and composer fill");
}

async function savedReview(text: string, paused = false): Promise<string> {
  const id = crypto.randomUUID();
  const apply = (action: QueueRequest["action"], extra: Partial<QueueRequest> = {}) => store.apply({
    type: QUEUE_MESSAGE_TYPE, key, clientId: "previous-tab", action, id, ...extra,
  }, "previous-tab", now);
  await apply("enqueue", { text });
  await apply("claim");
  await apply("attempt");
  await apply("review", { reason: "Could not confirm the send" });
  if (paused) await apply("pause", { paused: true });
  return id;
}

function simulateNativeChat(tab: Tab, renderUser?: (bubble: HTMLElement, text: string) => void): { sent: string[]; stops: number; finish: () => void } {
  const result = { sent: [] as string[], stops: 0, finish: () => {} };
  let pendingAnswer: HTMLElement | null = null;
  result.finish = () => {
    if (pendingAnswer) {
      pendingAnswer.setAttribute("data-chatgpt-selection-message-id", crypto.randomUUID());
      pendingAnswer.insertAdjacentHTML("beforeend", '<div class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div>');
      pendingAnswer = null;
    }
    busy(tab, false);
  };
  tab.action.addEventListener("click", () => {
    if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) { result.stops++; result.finish(); return; }
    // HappyDOM's innerText removes a literal first newline from a text node.
    // The rich fixture captures the editor's submitted text, not that emulation.
    const text = renderUser ? tab.composer.textContent ?? "" : tab.composer.innerText;
    result.sent.push(text);
    const id = crypto.randomUUID();
    const user = tab.doc.createElement("article");
    user.setAttribute("data-chatgpt-search-unit-key", `${id}:user`);
    user.setAttribute("data-chatgpt-search-message-ids", id);
    user.innerHTML = '<div data-user-message-bubble="true"></div>';
    if (renderUser) renderUser(user.firstElementChild as HTMLElement, text);
    else user.firstElementChild!.textContent = text;
    pendingAnswer = tab.doc.createElement("article");
    pendingAnswer.innerHTML = '<div data-markdown-text-style="assistant-message">Response running</div>';
    tab.doc.querySelector("main")!.append(user, pendingAnswer);
    draft(tab, ""); busy(tab, true);
  });
  return result;
}

/**
 * ProseMirror sends its editor state, not textContent. Its blur/focus handlers
 * stop/start the DOM observer; stop() takes pending mutations and schedules a
 * flush 20ms later. Blurring before the mutation checkpoint can therefore leave
 * matching DOM while Send still reads the prior document.
 * https://github.com/ProseMirror/prosemirror-view/blob/master/src/domobserver.ts
 * https://github.com/ProseMirror/prosemirror-view/blob/master/src/input.ts
 */
function simulateObserverBackedNativeChat(tab: Tab): {
  sent: string[]; model: () => string; deferredBlurs: string[]; flush: () => void; finish: () => void; close: () => void;
} {
  let model = tab.composer.textContent ?? "";
  let pending = false;
  let pendingAnswer: HTMLElement | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const abort = new tab.dom.AbortController();
  const options = { signal: abort.signal };
  const result = {
    sent: [] as string[], model: () => model, deferredBlurs: [] as string[],
    flush: () => {
      if (!pending) return;
      pending = false; model = tab.composer.textContent ?? "";
    },
    finish: () => {
      if (pendingAnswer) {
        pendingAnswer.setAttribute("data-chatgpt-selection-message-id", crypto.randomUUID());
        pendingAnswer.insertAdjacentHTML("beforeend", '<div class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div>');
        pendingAnswer = null;
      }
      busy(tab, false);
    },
    close: () => { observer.disconnect(); abort.abort(); for (const timer of timers) clearTimeout(timer); },
  };
  const observer = new tab.dom.MutationObserver(records => {
    if (records.length) pending = true;
    result.flush();
  });
  const observe = () => observer.observe(tab.composer as never, { childList: true, characterData: true, subtree: true });
  const restartObserver = (event: Event) => {
    const records = observer.takeRecords();
    if (records.length) {
      pending = true;
      if (event.type === "blur") result.deferredBlurs.push(tab.composer.textContent ?? "");
      const timer = setTimeout(() => { timers.delete(timer); result.flush(); }, 20);
      timers.add(timer);
    }
    observer.disconnect(); observe();
  };
  tab.composer.addEventListener("focus", restartObserver, options as unknown as AddEventListenerOptions);
  tab.composer.addEventListener("blur", restartObserver, options as unknown as AddEventListenerOptions);
  observe();
  tab.action.addEventListener("click", () => {
    if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) { result.finish(); return; }
    result.sent.push(model);
    postUserBubble(tab, model);
    pendingAnswer = tab.doc.createElement("article");
    pendingAnswer.innerHTML = '<div data-markdown-text-style="assistant-message">Response running</div>';
    tab.doc.querySelector("main")!.append(pendingAnswer);
    // The provider's send transaction immediately consumes its state. The DOM
    // update follows from that state, unlike extension-authored input edits.
    model = ""; pending = false; draft(tab, ""); busy(tab, true);
  }, options as unknown as AddEventListenerOptions);
  tab.composer.addEventListener("keydown", event => {
    if ((event as KeyboardEvent).key === "Enter" && !event.defaultPrevented) tab.action.click();
  }, options as unknown as AddEventListenerOptions);
  return result;
}

/** The user bubble can commit before React clears or remounts the input. */
function simulateDelayedComposerConsumption(tab: Tab): { sent: string[]; clear: () => void; finish: () => void } {
  const sent: string[] = [];
  let pendingAnswer: HTMLElement | null = null;
  tab.action.addEventListener("click", () => {
    if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) return;
    const text = tab.composer.textContent ?? "";
    sent.push(text); postUserBubble(tab, text);
    pendingAnswer = tab.doc.createElement("article");
    pendingAnswer.innerHTML = '<div data-markdown-text-style="assistant-message">Response running</div>';
    tab.doc.querySelector("main")!.append(pendingAnswer);
    busy(tab, true);
  });
  return {
    sent,
    clear: () => draft(tab, ""),
    finish: () => {
      if (pendingAnswer) {
        pendingAnswer.setAttribute("data-chatgpt-selection-message-id", crypto.randomUUID());
        pendingAnswer.insertAdjacentHTML("beforeend", '<div class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div>');
        pendingAnswer = null;
      }
      busy(tab, false);
    },
  };
}

async function localQueueBeforeVirtualization(state: DocumentVisibilityState): Promise<{
  tab: Tab; main: HTMLElement; localId: string; firstTurn: Element[];
  native: ReturnType<typeof simulateNativeChat>; first: string; second: string;
}> {
  const tab = await createTab({ newChat: true, visibility: state });
  const localId = "local-chatgpt:77777777-7777-4777-8777-777777777777";
  const main = tab.doc.querySelector<HTMLElement>("main")!;
  draft(tab, "First native message before older turns are virtualized");
  tab.action.addEventListener("click", () => {
    tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    main.setAttribute("data-chatgpt-selection-conversation-id", localId);
    main.innerHTML = `<article data-chatgpt-search-unit-key="11111111-1111-4111-8111-111111111111:user" data-chatgpt-search-message-ids="11111111-1111-4111-8111-111111111111"><div data-user-message-bubble="true">First native message before older turns are virtualized</div></article>
      <article data-chatgpt-selection-message-id="22222222-2222-4222-8222-222222222222"><div data-markdown-text-style="assistant-message">Completed first response</div><button data-testid="copy-turn-action-button">Copy</button></article>`;
    draft(tab, ""); busy(tab, true);
  }, { once: true });
  tab.action.click(); await poll(tab);
  const firstTurn = Array.from(main.children);
  const first = await enqueue(tab, "First follow-up before virtualization");
  const second = await enqueue(tab, "Second follow-up after virtualization");
  const native = simulateNativeChat(tab);
  busy(tab, false); now += 4000;
  await poll(tab);
  expect(native.sent).toEqual(["First follow-up before virtualization"]);
  expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
  // Observe the later user while the original first turn is still mounted.
  // The subsequent disappearance has positive transcript-continuity evidence.
  await poll(tab);
  return { tab, main, localId, firstTurn, native, first, second };
}

// The live ChatGPT turn has its final-state attribute several wrappers above
// the response. Its native toolbar has no Rate controls or action test IDs.
function currentChatGptResponse(doc: Document, state: string, responseId: string = crypto.randomUUID()): HTMLElement {
  const turn = doc.createElement("div");
  turn.setAttribute("data-talvt-turn-state", state);
  turn.innerHTML = `<div><div><div><div><div data-chatgpt-selection-message-id="${responseId}" data-chatgpt-selection-conversation-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa">
    <div data-markdown-text-style="assistant-message">Native response content</div>
  </div></div></div></div></div>
  <div class="turn-action-controls">
    <button aria-label="Copy">Copy</button><button aria-label="Share">Share</button><button aria-label="Read aloud">Read aloud</button>
    <button aria-label="Regenerate response">Regenerate response</button><button aria-label="More actions">More</button>
  </div>`;
  return turn;
}

function historicalTertiaryStatusTranscript(tab: Tab): { status: HTMLElement; statusBody: HTMLElement; latest: HTMLElement; latestAssistant: HTMLElement } {
  const status = tab.doc.createElement("div");
  status.setAttribute("data-talvt-turn-state", "complete");
  status.innerHTML = `<div>
    <div data-chatgpt-search-unit-key="fallback-turn-7:0:user" data-chatgpt-search-message-ids="22222222-2222-4222-8222-222222222222"><div data-user-message-bubble>Draw an illustration from this description.</div></div>
    <div><span hidden data-chatgpt-agent-turn-start></span><div><div><div><div><div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">Clarified visual intent</div></div></div></div></div></div>
  </div>`;
  const imageTurn = tab.doc.createElement("div");
  imageTurn.setAttribute("data-talvt-turn-state", "complete");
  imageTurn.innerHTML = '<div data-chatgpt-selection-message-id="33333333-3333-4333-8333-333333333333"><div data-markdown-text-style="assistant-message"><img alt="Completed generated image"></div></div>';
  const latest = currentChatGptResponse(tab.doc, "complete");
  const latestUser = tab.doc.createElement("article");
  latestUser.setAttribute("data-chatgpt-search-unit-key", "44444444-4444-4444-8444-444444444444:user");
  latestUser.setAttribute("data-chatgpt-search-message-ids", "44444444-4444-4444-8444-444444444444");
  latestUser.innerHTML = "<div data-user-message-bubble>Thanks. Please explain the result.</div>";
  latest.prepend(latestUser);
  tab.doc.querySelector("main")!.append(status, imageTurn, latest);
  return { status, statusBody: status.querySelector('[data-markdown-text-style="assistant-message"]')!, latest,
    latestAssistant: latest.querySelector('[data-chatgpt-selection-message-id]')! };
}

function simulateCurrentNativeChat(tab: Tab): { sent: string[]; finish: () => void } {
  const sent: string[] = [];
  let pending: HTMLElement | null = null;
  tab.action.addEventListener("click", () => {
    if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) throw new Error("This fixture expects ordinary native sends");
    const text = tab.composer.innerText;
    sent.push(text);
    postUserBubble(tab, text);
    pending = currentChatGptResponse(tab.doc, "streaming");
    pending.prepend(tab.doc.querySelector("main")!.lastElementChild!);
    tab.doc.querySelector("main")!.append(pending);
    draft(tab, ""); busy(tab, true);
  });
  return { sent, finish() {
    if (!pending) throw new Error("No native response is pending");
    // Deliberately no child-list, input, label, visibility, or timer stimulus.
    // The state attribute alone must wake the hidden queue's next dispatch.
    pending.setAttribute("data-talvt-turn-state", "complete");
    pending = null;
  } };
}

// Model the installed model-selector extension: a document capture listener
// cancels the original click, awaits a background decision, then clicks the
// same button with a one-shot bypass of its own interceptor.
function delayedSendInterceptor(tab: Tab): { canceled: Event[]; replay: () => void } {
  const canceled: Event[] = [];
  let bypass = false;
  tab.doc.addEventListener("click", event => {
    if (!event.composedPath().includes(tab.action)) return;
    if (bypass) { bypass = false; return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    canceled.push(event);
  }, { capture: true });
  return { canceled, replay() { bypass = true; try { tab.action.click(); } finally { bypass = false; } } };
}

function wrapComposerInForm(tab: Tab): HTMLFormElement {
  const form = tab.doc.createElement("form");
  const body = tab.composer.closest("[data-composer-body]")!;
  body.before(form); form.append(body);
  tab.action.type = "submit";
  // Keep this browserless fixture's native form default action local.
  form.addEventListener("submit", event => event.preventDefault());
  return form;
}

function postUserBubble(tab: Tab, text: string): void {
  const userId = crypto.randomUUID();
  const article = tab.doc.createElement("article");
  article.setAttribute("data-chatgpt-search-unit-key", `${userId}:user`);
  article.setAttribute("data-chatgpt-search-message-ids", userId);
  const bubble = tab.doc.createElement("div");
  bubble.setAttribute("data-user-message-bubble", "");
  bubble.textContent = text;
  article.append(bubble); tab.doc.querySelector("main")!.append(article);
}

function renderRichUser(bubble: HTMLElement, text: string): void {
  const doc = bubble.ownerDocument;
  const root = doc.createElement("div");
  root.setAttribute("data-markdown-text-tone", "user-message");
  for (const paragraph of text.split("\n\n")) {
    const p = doc.createElement("p");
    paragraph.split("\n").forEach((line, index) => {
      if (index) p.append(doc.createElement("br"));
      const span = doc.createElement("span"); span.textContent = line; p.append(span);
    });
    root.append(p);
  }
  const decoration = doc.createElement("span");
  decoration.setAttribute("aria-hidden", "true"); decoration.textContent = "t";
  const more = doc.createElement("button"); more.textContent = "Show more";
  bubble.replaceChildren(root, decoration, more);
}

function renderCollapsedPlainUser(bubble: HTMLElement, text: string): void {
  const doc = bubble.ownerDocument;
  const target = doc.createElement("div"); target.setAttribute("data-search-result-target", "");
  const wrapper = doc.createElement("div");
  const root = doc.createElement("div");
  root.className = "whitespace-pre-wrap"; root.setAttribute("dir", "auto"); root.textContent = text;
  wrapper.append(root); target.append(wrapper);
  const decoration = doc.createElement("span");
  decoration.setAttribute("aria-hidden", "true"); decoration.className = "block"; decoration.textContent = "…";
  const more = doc.createElement("button"); more.textContent = "Show more";
  bubble.replaceChildren(target, decoration, more);
}

describe("Persistent message queue UI", () => {
  test("empty draft recovery does not leave a readonly input after restart before send cleanup", async () => {
    const tab = await createTab();
    await enqueue(tab, "Queue survives interruption before dispatch");
    tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let saved = false;
    tab.after = request => {
      if (request.action === "draft-save" && request.text === "" && !saved) { saved = true; return gate; }
    };
    tab.before = request => { if (request.action === "draft-remove") throw new Error("Old document disconnected before cleanup"); };
    busy(tab, false); now += 4000;
    try {
      await waitFor(() => saved, "focused empty input checkpoint committed");
      tab.queue.stop();
      const reopened = await createTab();
      expect(Boolean(reopened.shadow.querySelector('[aria-label="Saved unsent draft"]'))).toBe(false);
      expect((await persisted()).drafts ?? []).toEqual([]);
      expect(reopened.composer.textContent).toBe("");
    } finally {
      release();
      await waitFor(() => !tab.queue.dispatching, "interrupted dispatch settles");
    }
  });

  test("empty draft recovery does not leak a blank card when final cleanup fails after a confirmed send", async () => {
    const tab = await createTab();
    await enqueue(tab, "Send once despite empty draft cleanup failure");
    tab.composer.focus();
    tab.before = request => { if (request.action === "draft-remove") throw new Error("Document lost its cleanup connection"); };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "focused empty input send settles");
    expect(native.sent).toEqual(["Send once despite empty draft cleanup failure"]);
    expect(Boolean(tab.shadow.querySelector('[aria-label="Saved unsent draft"]'))).toBe(false);
    expect((await persisted()).drafts ?? []).toEqual([]);
    expect(draftBuffer(tab)).toBeNull();
  });

  test("empty draft recovery keeps new typing after an empty checkpoint acknowledgement", async () => {
    const tab = await createTab();
    await enqueue(tab, "Only this queued prompt sends");
    tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let saved = false;
    tab.after = request => {
      if (request.action === "draft-save" && request.text === "" && !saved) { saved = true; return gate; }
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => saved && Boolean(draftBuffer(tab)), "empty checkpoint awaiting acknowledgement");
    typeInBuffer(tab, "New unfinished typing after the empty checkpoint");
    release();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "new typing restored after queued send");
    expect(native.sent).toEqual(["Only this queued prompt sends"]);
    expect(tab.composer.textContent).toBe("New unfinished typing after the empty checkpoint");
    expect((await persisted()).drafts ?? []).toEqual([]);
  });

  test.each(["Nonempty recovery text", " \n\t "])("empty draft recovery preserves real saved draft %j", async text => {
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "old-document", action: "draft-save", id: "recoverable", text, draftRevision: 1 }, "old-document", now);
    const tab = await createTab({ idle: true });
    expect(tab.shadow.querySelector<HTMLTextAreaElement>('[aria-label="Saved unsent draft"]')?.value).toBe(text);
    button(tab, "restore-draft").click();
    await waitFor(() => !tab.queue.saving && !tab.shadow.querySelector('[aria-label="Saved unsent draft"]'), "manual recovery retained");
    expect(tab.composer.textContent).toBe(text);
    expect((await persisted()).drafts).toEqual([]);
  });

  test("manual draft restore rejects a stale recovery card after navigation to another saved chat", async () => {
    const text = "This unfinished draft belongs only to the original conversation";
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "old-document", action: "draft-save", id: "route-protected", text, draftRevision: 1 }, "old-document", now);
    const tab = await createTab({ idle: true });
    // A recovery-only queue does not schedule a mutation tick. Freeze its
    // fallback timer to inspect the real interval before the next 900ms poll.
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    const restore = button(tab, "restore-draft");
    const destination = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    tab.dom.history.pushState({}, "", `/c/${destination}`);
    tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", destination);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(tab.queue.state?.key).toBe(key);
    expect(restore.isConnected).toBe(true);
    restore.click();
    await waitFor(() => !tab.queue.saving, "stale restore click settles");
    expect(tab.composer.textContent).toBe("");
    expect(tab.requests.filter(request => request.action === "draft-remove")).toHaveLength(0);
    expect((await persisted()).drafts?.map(entry => entry.text)).toEqual([text]);
    expect(Boolean(tab.shadow.querySelector('[aria-label="Saved unsent draft"]'))).toBe(false);
  });

  test("historical completed tertiary status does not intercept an idle native Enter", async () => {
    const tab = await createTab({ idle: true });
    historicalTertiaryStatusTranscript(tab);
    const native = simulateNativeChat(tab);
    tab.composer.addEventListener("keydown", event => {
      if ((event as KeyboardEvent).key === "Enter" && !event.defaultPrevented) tab.action.click();
    });
    draft(tab, "Native message after the image and later text response completed");
    expect(enter(tab)).toBe(true);
    expect(native.sent).toEqual(["Native message after the image and later text response completed"]);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(0);
    expect((await persisted()).items).toHaveLength(0);
  });

  test("historical completed tertiary status cannot strand an automatic queued message", async () => {
    const tab = await createTab();
    historicalTertiaryStatusTranscript(tab);
    const id = await enqueue(tab, "Queue after the latest completed answer");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Queue after the latest completed answer"]);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test.each(["latest idless", "latest incomplete", "status incomplete", "status without completion", "nontertiary status", "unverified route", "latest answer missing"] as const)("historical status handling still blocks a %s transcript", async condition => {
    const tab = await createTab();
    const transcript = historicalTertiaryStatusTranscript(tab);
    if (condition === "latest idless") transcript.latestAssistant.removeAttribute("data-chatgpt-selection-message-id");
    if (condition === "latest incomplete") transcript.latest.setAttribute("data-talvt-turn-state", "streaming");
    if (condition === "status incomplete") transcript.status.setAttribute("data-talvt-turn-state", "thinking");
    if (condition === "status without completion") transcript.status.removeAttribute("data-talvt-turn-state");
    if (condition === "nontertiary status") transcript.statusBody.removeAttribute("data-markdown-text-tone");
    if (condition === "unverified route") {
      for (const marker of Array.from(tab.doc.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) marker.removeAttribute("data-chatgpt-selection-conversation-id");
    }
    if (condition === "latest answer missing") transcript.latestAssistant.remove();
    const id = await enqueue(tab, "Remain saved while transcript safety is unresolved");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("queued");
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
  });

  test("a canceled queued click permits the model extension's delayed replay exactly once", async () => {
    const tab = await createTab();
    wrapComposerInForm(tab);
    const id = await enqueue(tab, "Follow up through the asynchronous model gate");
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "model extension canceled initial send");
    expect(gate.canceled[0]!.defaultPrevented).toBe(true);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    expect(native.sent).toEqual([]);
    // This task boundary is the important distinction from the original click.
    await new Promise(resolve => setTimeout(resolve, 0));
    gate.replay();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "delayed native replay acknowledged", 350);
    expect(native.sent).toEqual(["Follow up through the asynchronous model gate"]);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(1);
  });

  test.each(["click", "submit"] as const)("hiding a tab during a delayed native %s replay preserves exactly one send", async mode => {
    const tab = await createTab();
    const form = wrapComposerInForm(tab);
    const text = "Finish the owned send after switching tabs";
    const id = await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    const sent: string[] = [];
    const acknowledge = () => {
      sent.push(tab.composer.innerText);
      postUserBubble(tab, text);
      draft(tab, "");
      busy(tab, true);
    };
    if (mode === "click") tab.action.addEventListener("click", acknowledge);
    else form.addEventListener("submit", acknowledge);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial send intercepted before hiding");
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueLastDispatchVisibility).toBe("visible");
    expect(host.dataset.queueConfirmedSends).toBe("0");
    visibility(tab, "hidden");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    const replay = () => {
      if (mode === "click") gate.replay();
      else {
        const event = new tab.dom.SubmitEvent("submit", { bubbles: true, cancelable: true });
        Object.defineProperties(event, { isTrusted: { value: true }, submitter: { value: tab.action } });
        form.dispatchEvent(event as unknown as SubmitEvent);
      }
    };
    replay();
    replay();
    await waitFor(() => !tab.queue.dispatching, "hidden native replay acknowledged");
    visibility(tab, "visible");
    replay();
    await poll(tab);
    expect(sent).toEqual([text]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "waiting"]]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(1);
    expect(host.dataset.queueLastDispatchVisibility).toBe("hidden");
    expect(host.dataset.queueConfirmedSends).toBe("1");
  });

  test.each(["native default", "direct delayed same submitter", "direct delayed null submitter"] as const)("a delayed replay permits one %s form submission", async mode => {
    const tab = await createTab();
    const form = wrapComposerInForm(tab);
    const text = "The authorized replay may submit its own form once";
    const id = await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    let submissions = 0;
    form.addEventListener("submit", () => { submissions++; });
    const directSubmit = () => {
      const event = new tab.dom.SubmitEvent("submit", {
        bubbles: true, cancelable: true,
      });
      // requestSubmit() creates a browser-dispatched submit event even
      // when called by script; trust alone cannot identify a user gesture.
      Object.defineProperties(event, {
        isTrusted: { value: true },
        submitter: { value: mode === "direct delayed null submitter" ? null : tab.action },
      });
      form.dispatchEvent(event as unknown as SubmitEvent);
    };
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "model gate initial cancellation");
    await new Promise(resolve => setTimeout(resolve, 0));
    if (mode === "native default") { gate.replay(); form.requestSubmit(tab.action); }
    else { directSubmit(); directSubmit(); }
    expect(submissions).toBe(1);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    postUserBubble(tab, text);
    await waitFor(() => !tab.queue.dispatching, "form delivery acknowledged", 350);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    directSubmit();
    expect(submissions).toBe(1);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test.each(["input event", "DOM mutation only"] as const)("a delayed click replay cannot send a draft changed and restored through %s", async signal => {
    const tab = await createTab();
    const text = "Original queued text";
    const id = await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    const editDraft = (value: string) => {
      if (signal === "input event") draft(tab, value);
      else tab.composer.textContent = value;
    };
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    editDraft("New typing must not be sent by an old click");
    editDraft(text);
    gate.replay();
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerText).toBe(text);
    editDraft("New typing must not be sent by an old click");
    gate.replay();
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerText).toBe("New typing must not be sent by an old click");
    editDraft(text);
    gate.replay();
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(1);
  });

  test.each(["/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "/"])("a delayed click replay remains blocked after navigation to %s", async route => {
    const tab = await createTab();
    const text = "Only send in the original conversation";
    await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    tab.dom.location.href = `https://chatgpt.com${route}`;
    if (route === "/") {
      tab.doc.querySelector("main")!.replaceChildren();
      tab.doc.querySelector("main")!.removeAttribute("data-chatgpt-selection-conversation-id");
    } else tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    gate.replay();
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerText).toBe(text);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
    // A route reset must not turn this stale replay into an ordinary first send.
    await waitFor(() => !tab.queue.dispatching, "old dispatch ends after route change");
    gate.replay();
    expect(native.sent).toEqual([]);
  });

  test("a delayed click replay is bound to the original composer form", async () => {
    const tab = await createTab();
    const original = wrapComposerInForm(tab);
    await enqueue(tab, "Do not replay into a replacement form");
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    const replacement = tab.doc.createElement("form");
    original.before(replacement);
    replacement.append(tab.composer.closest("[data-composer-body]")!);
    gate.replay();
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerText).toBe("Do not replay into a replacement form");
  });

  test("a delayed replay expires and leaves its unconfirmed draft saved for review", async () => {
    const tab = await createTab();
    const text = "An old replay must not fire after the acknowledgement deadline";
    const id = await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    Object.defineProperty(tab.dom, "Date", { value: class extends Date {
      static override now(): number { return Date.now() + 16_000; }
    }, configurable: true });
    gate.replay();
    expect(native.sent).toEqual([]);
    await waitFor(() => !tab.queue.dispatching, "expired delivery requires review", 600);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("review");
    expect(tab.composer.innerText).toBe(text);
    gate.replay();
    expect(native.sent).toEqual([]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test.each(["click", "Enter"] as const)("a trusted physical %s during the attempt revokes its delayed replay without a duplicate send", async activation => {
    const tab = await createTab();
    await enqueue(tab, "One owned send is already awaiting the model extension");
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    const event = activation === "click"
      ? new tab.dom.MouseEvent("click", { bubbles: true, composed: true, cancelable: true })
      : new tab.dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(event, "isTrusted", { value: true });
    const target = activation === "click" ? tab.action : tab.composer;
    target.dispatchEvent(event as unknown as Event);
    expect(event.defaultPrevented).toBe(true);
    gate.replay();
    expect(native.sent).toEqual([]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(1);
  });

  test("a replay click does not grant a third-stage submit in a later task", async () => {
    const tab = await createTab();
    const form = wrapComposerInForm(tab);
    tab.action.type = "button";
    await enqueue(tab, "The replay only carries its synchronous native default action");
    const gate = delayedSendInterceptor(tab);
    let clicks = 0;
    let submissions = 0;
    tab.action.addEventListener("click", () => { clicks++; });
    form.addEventListener("submit", () => { submissions++; });
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    gate.replay();
    expect(clicks).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const event = new tab.dom.SubmitEvent("submit", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "isTrusted", { value: true });
    form.dispatchEvent(event as unknown as SubmitEvent);
    expect(submissions).toBe(0);
  });

  test("a direct delayed submit with another submitter cannot consume the queued message", async () => {
    const tab = await createTab();
    const form = wrapComposerInForm(tab);
    const text = "Only the captured Send button may submit this queued draft";
    await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    let submissions = 0;
    form.addEventListener("submit", () => { submissions++; });
    const other = tab.doc.createElement("button");
    other.type = "submit"; other.textContent = "Another action"; form.append(other);
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    form.requestSubmit(other);
    expect(submissions).toBe(0);
    expect(tab.composer.innerText).toBe(text);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test("only one delayed replay passes while its user bubble is still pending", async () => {
    const tab = await createTab();
    const text = "A single delayed activation before acknowledgement";
    const id = await enqueue(tab, text);
    const gate = delayedSendInterceptor(tab);
    let nativeClicks = 0;
    // Leave the exact draft and button intact until the server's optimistic
    // bubble arrives, so a second click could otherwise duplicate the message.
    tab.action.addEventListener("click", () => { nativeClicks++; });
    busy(tab, false);
    await waitFor(() => gate.canceled.length === 1, "initial canceled click");
    gate.replay();
    gate.replay();
    expect(nativeClicks).toBe(1);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(1);
    const postedId = "33333333-4444-4555-8666-777777777777";
    tab.doc.querySelector("main")!.insertAdjacentHTML("beforeend", `<article data-chatgpt-search-unit-key="${postedId}:user" data-chatgpt-search-message-ids="${postedId}"><div data-user-message-bubble>${text}</div></article>`);
    await waitFor(() => !tab.queue.dispatching, "replay acknowledged");
    gate.replay();
    expect(nativeClicks).toBe(1);
  });

  test("an uncanceled queued click never grants an additional asynchronous activation", async () => {
    const tab = await createTab();
    await enqueue(tab, "No replay allowance without a canceled first click");
    let nativeClicks = 0;
    tab.action.addEventListener("click", () => { nativeClicks++; });
    busy(tab, false);
    await waitFor(() => nativeClicks === 1, "original native click");
    await new Promise(resolve => setTimeout(resolve, 0));
    tab.action.click();
    expect(nativeClicks).toBe(1);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(1);
  });

  test("a canceled initial click which already submitted its form never grants another send", async () => {
    const tab = await createTab();
    const form = wrapComposerInForm(tab);
    await enqueue(tab, "A canceled click is not replay permission after a submit was observed");
    let submissions = 0;
    let originalCanceled = false;
    let targetClicks = 0;
    form.addEventListener("submit", () => { submissions++; });
    tab.action.addEventListener("click", () => { targetClicks++; });
    tab.doc.addEventListener("click", event => {
      if (!event.composedPath().includes(tab.action) || originalCanceled) return;
      form.requestSubmit(tab.action);
      originalCanceled = true;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    busy(tab, false);
    await waitFor(() => originalCanceled, "initial click submitted before cancellation");
    expect(submissions).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    tab.action.click();
    expect(targetClicks).toBe(0);
    expect(submissions).toBe(1);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test("Retry clears its matching retained draft after commit and sends the same item once", async () => {
    const text = "what are parameter values?";
    const id = await savedReview(text);
    const tab = await createTab({ idle: true });
    const native = simulateNativeChat(tab);
    draft(tab, text);
    button(tab, "retry", id).click();
    await waitFor(() => tab.queue.state?.items.find(item => item.id === id)?.status !== "review", "durable retry");
    await waitFor(() => tab.queue.state?.items.find(item => item.id === id)?.status === "waiting", "retried send acknowledgement");
    // Auto-dispatch may refill the cleared composer immediately after Retry.
    // Its acknowledged send is the stable boundary for the final empty draft.
    expect(tab.composer.innerText).toBe("");
    expect(native.sent).toEqual([text]);
    expect((await persisted()).items.map(item => item.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "retry")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "enqueue")).toHaveLength(0);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test("Retry waits for its durable response, preserves pause, and ignores repeat clicks", async () => {
    const text = "Keep this queued until Resume";
    const id = await savedReview(text, true);
    const tab = await createTab({ idle: true });
    const native = simulateNativeChat(tab);
    draft(tab, text);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let committed = false;
    tab.after = async request => { if (request.action === "retry") { committed = true; await gate; } };
    button(tab, "retry", id).click();
    await waitFor(() => committed, "retry database commit");
    button(tab, "retry", id).click();
    expect(tab.composer.innerText).toBe(text);
    expect(native.sent).toEqual([]);
    release();
    await waitFor(() => !tab.queue.saving, "retry response handled");
    expect(tab.composer.innerText).toBe("");
    expect((await persisted()).paused).toBe(true);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "queued"]]);
    expect(tab.requests.filter(request => request.action === "retry")).toHaveLength(1);
    expect(native.sent).toEqual([]);
    button(tab, "pause").click();
    await waitFor(() => native.sent.length === 1, "explicit Resume");
    expect(native.sent).toEqual([text]);
  });

  test("a failed Retry keeps its review item and retained draft", async () => {
    const text = "Do not lose this draft";
    const id = await savedReview(text);
    const tab = await createTab({ idle: true });
    draft(tab, text);
    tab.before = request => { if (request.action === "retry") throw new Error("Retry storage unavailable"); };
    button(tab, "retry", id).click();
    await waitFor(() => tab.shadow.textContent!.includes("Retry storage unavailable"), "visible retry failure");
    expect(tab.composer.innerText).toBe(text);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "review"]]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
  });

  test.each(["different draft", "new typing", "route", "composer", "attachment"] as const)("Retry preserves %s while resetting only the original saved item", async change => {
    const text = "Original retained text";
    const id = await savedReview(text, true);
    const tab = await createTab({ idle: true });
    draft(tab, change === "different draft" ? "Unrelated draft" : text);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let committed = false;
    tab.after = async request => { if (request.action === "retry") { committed = true; await gate; } };
    button(tab, "retry", id).click();
    await waitFor(() => committed, "retry commit before delayed response");
    if (change === "new typing") draft(tab, "New typing during retry");
    if (change === "route") tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    if (change === "composer") {
      const replacement = tab.composer.cloneNode(true) as HTMLElement;
      tab.composer.replaceWith(replacement); tab.composer = replacement;
    }
    if (change === "attachment") tab.composer.closest("[data-composer-body]")!.insertAdjacentHTML("beforeend", '<div data-file-id="new-attachment">New file</div>');
    const expectedDraft = tab.composer.innerText;
    release();
    await waitFor(() => !tab.queue.saving, "retry completion");
    expect(tab.composer.innerText).toBe(expectedDraft);
    expect((await persisted()).items.map(item => [item.id, item.text, item.status])).toEqual([[id, text, "queued"]]);
    expect((await persisted()).paused).toBe(true);
  });

  test("Retry with a composer that refuses to clear cannot append a duplicate on Enter", async () => {
    const text = "Saved item with a retained duplicate draft";
    const id = await savedReview(text, true);
    const tab = await createTab({ idle: true });
    draft(tab, text);
    Object.defineProperty(tab.doc, "execCommand", { value: () => true, configurable: true });
    button(tab, "retry", id).click();
    await waitFor(() => tab.queue.state?.items[0]?.status === "queued" && !tab.queue.saving, "retry retained after failed clear");
    expect(tab.composer.innerText).toBe(text);
    expect(tab.shadow.textContent).toContain("Clear the composer to continue");
    enter(tab);
    await waitFor(() => !tab.queue.saving, "idempotent retained-draft enqueue");
    expect((await persisted()).items.map(item => item.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "enqueue").every(request => request.id === id)).toBe(true);
  });

  test("a lost Retry response preserves the draft and subsequent Enter keeps the same saved ID", async () => {
    const text = "Retry committed but its reply was lost";
    const id = await savedReview(text, true);
    const tab = await createTab({ idle: true });
    draft(tab, text);
    tab.after = request => { if (request.action === "retry") throw new Error("Lost retry response"); };
    button(tab, "retry", id).click();
    await waitFor(() => !tab.queue.saving && tab.shadow.textContent!.includes("Lost retry response"), "lost retry reply");
    expect(tab.composer.innerText).toBe(text);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "queued"]]);
    enter(tab);
    await waitFor(() => !tab.queue.saving, "same-ID draft recovery");
    expect(tab.composer.innerText).toBe("");
    expect((await persisted()).items.map(item => item.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "enqueue").map(request => request.id)).toEqual([id]);
  });

  test.each(["Enter", "click"] as const)("queues %s during ChatGPT initial response after typing replaces Stop with Send", async activation => {
    const tab = await createTab();
    tab.action.setAttribute("aria-label", "Stop");
    tab.doc.querySelector("main")!.insertAdjacentHTML("beforeend", '<span aria-busy="true" role="status"><span class="sr-only">ChatGPT is responding</span><span aria-hidden="true" class="pulsing-dot"></span></span>');
    let nativeSends = 0;
    tab.composer.addEventListener("keydown", event => { if (event.key === "Enter") nativeSends++; });
    tab.action.addEventListener("click", () => nativeSends++);
    draft(tab, "Follow up after the current response");
    tab.action.setAttribute("type", "submit");
    tab.action.setAttribute("aria-label", "Send");
    if (activation === "Enter") expect(enter(tab)).toBe(false);
    else tab.action.click();
    await waitFor(() => !tab.queue.saving, "initial-response queue commit");
    expect(nativeSends).toBe(0);
    expect((await persisted()).items.map(item => ({ text: item.text, status: item.status }))).toEqual([
      { text: "Follow up after the current response", status: "queued" },
    ]);
    expect(tab.composer.innerText).toBe("");
  });

  test("Enter during the initial durable read respects an existing paused queue and clears only after commit", async () => {
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "seed", action: "enqueue", id: "existing-paused-item", text: "Saved before this tab opened" }, "seed", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "seed", action: "pause", paused: true }, "seed", now);
    let releaseRead!: () => void;
    let releaseCommit!: () => void;
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    let firstReadHeld = false;
    let enqueueRequested = false;
    const tab = await createTab({
      idle: true, returnBeforeRead: true,
      before: async request => {
        if (!firstReadHeld && (request.action === "read" || request.action === "heartbeat")) { firstReadHeld = true; await readGate; }
        if (request.action === "enqueue") { enqueueRequested = true; await commitGate; }
      },
    });
    expect(firstReadHeld).toBe(true);
    expect(tab.queue.state).toBeNull();
    let nativeSends = 0;
    tab.composer.addEventListener("keydown", event => { if (event.key === "Enter") nativeSends++; });
    draft(tab, "Typed before the queue finished loading");
    expect(enter(tab)).toBe(false);
    await waitFor(() => enqueueRequested, "cold-start enqueue request");
    expect(nativeSends).toBe(0);
    expect(tab.composer.innerText).toBe("Typed before the queue finished loading");
    expect((await persisted()).items.map(item => item.id)).toEqual(["existing-paused-item"]);
    releaseRead();
    await waitFor(() => Boolean(tab.queue.state?.paused) && !tab.queue.polling, "initial persisted paused state");
    expect(tab.composer.innerText).toBe("Typed before the queue finished loading");
    releaseCommit();
    await waitFor(() => !tab.queue.saving, "cold-start enqueue commit");
    const saved = await persisted();
    expect(saved.items.map(item => item.text)).toEqual(["Saved before this tab opened", "Typed before the queue finished loading"]);
    expect(saved.paused).toBe(true);
    expect(tab.composer.innerText).toBe("");
    expect(nativeSends).toBe(0);
  });

  test.each([
    ["Enter", "", false], ["click", "", false], ["submit", "", false],
    ["Enter", 'aria-hidden="true"', false], ["click", 'style="visibility:hidden"', false],
    ["submit", 'aria-hidden="true"', false], ["submit", 'style="visibility:hidden"', false],
    ["Enter", 'aria-hidden="true"', true],
  ] as const)("observed first native %s permits queued dispatch despite cached hidden turns (%s, long response=%s)", async (activation, hiddenAttributes, longResponse) => {
    const tab = await createTab({ newChat: true });
    const firstUserId = "55555555-5555-4555-8555-555555555555";
    const queuedUserId = "66666666-6666-4666-8666-666666666666";
    const localId = "local-chatgpt:77777777-7777-4777-8777-777777777777";
    if (hiddenAttributes) tab.doc.querySelector("main")!.insertAdjacentHTML("beforeend", `<section ${hiddenAttributes} data-chatgpt-selection-conversation-id="local-chatgpt:99999999-9999-4999-8999-999999999999">
      <div data-markdown-text-style="assistant-message">Cached old reply with layout rectangles</div>
    </section>`);
    let firstSends = 0;
    const nativeFirstSend = () => {
      firstSends++;
      const text = tab.composer.innerText;
      tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const main = tab.doc.querySelector("main")!;
      main.setAttribute("data-chatgpt-selection-conversation-id", localId);
      if (longResponse) main.setAttribute("aria-busy", "true");
      main.innerHTML = `
        <article data-chatgpt-search-unit-key="${firstUserId}:user" data-chatgpt-search-message-ids="${firstUserId}">
          <div data-user-message-bubble="true"></div>
        </article>
        <article id="first-answer" data-chatgpt-selection-conversation-id="${localId}">
          <div data-markdown-text-style="assistant-message">First response is running.</div>
        </article>`;
      main.querySelector("[data-user-message-bubble]")!.textContent = text;
      draft(tab, "");
      busy(tab, true);
    };
    draft(tab, "First native message from a genuinely empty chat");
    if (activation === "click") {
      tab.action.addEventListener("click", nativeFirstSend, { once: true });
      tab.action.click();
    } else if (activation === "Enter") {
      tab.composer.addEventListener("keydown", nativeFirstSend, { once: true });
      enter(tab);
    } else {
      const form = tab.doc.createElement("form");
      const scope = tab.doc.querySelector("[data-composer-body]")!;
      scope.before(form); form.append(scope);
      form.addEventListener("submit", nativeFirstSend, { once: true });
      expect(form.dispatchEvent(new tab.dom.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as SubmitEvent)).toBe(true);
    }
    expect(firstSends).toBe(1);
    expect((await persisted()).items).toHaveLength(0);
    await poll(tab);
    await enqueue(tab, "Follow up after that first reply");
    expect((await persisted()).lastCompletedUserMessageId).toBe(firstUserId);
    if (longResponse) {
      now += 121000;
      Object.defineProperty(tab.dom, "Date", { value: class extends Date { static now() { return now; } }, configurable: true });
      await poll(tab);
      expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("chat-busy");
    }
    let queuedSends = 0;
    tab.action.addEventListener("click", () => {
      queuedSends++;
      const user = tab.doc.createElement("article");
      user.setAttribute("data-chatgpt-search-unit-key", `${queuedUserId}:user`);
      user.setAttribute("data-chatgpt-search-message-ids", queuedUserId);
      user.innerHTML = '<div data-user-message-bubble="true"></div>';
      user.firstElementChild!.textContent = tab.composer.innerText;
      tab.doc.querySelector("main")!.append(user);
      draft(tab, ""); busy(tab, true);
    });
    // Losing Stop alone must not authorize dispatch before the first reply's
    // committed message ID and completion controls arrive.
    busy(tab, false); now += 4000;
    tab.doc.querySelector("main")!.removeAttribute("aria-busy");
    await poll(tab);
    expect(queuedSends).toBe(0);
    const answer = tab.doc.querySelector("#first-answer")!;
    answer.setAttribute("data-chatgpt-selection-message-id", "88888888-8888-4888-8888-888888888888");
    answer.insertAdjacentHTML("beforeend", '<div class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div>');
    await poll(tab);
    expect(queuedSends).toBe(1);
    const saved = await persisted();
    expect(saved.items[0]?.status).toBe("waiting");
    expect(saved.items[0]?.userMessageId).toBe(queuedUserId);
    expect(saved.items[0]?.text).toBe("Follow up after that first reply");
    expect(tab.doc.querySelector("main")!.getAttribute("data-chatgpt-selection-conversation-id")).toBe(localId);
  });

  test("a verified local conversation resumes after a SPA departure and return without inferring aliases for stale DOM", async () => {
    const tab = await createTab({ newChat: true });
    const firstUserId = "55555555-5555-4555-8555-555555555555";
    const localId = "local-chatgpt:77777777-7777-4777-8777-777777777777";
    draft(tab, "Witnessed first native send");
    tab.action.addEventListener("click", () => {
      tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const main = tab.doc.querySelector("main")!;
      main.setAttribute("data-chatgpt-selection-conversation-id", localId);
      main.innerHTML = `<article data-chatgpt-search-unit-key="${firstUserId}:user" data-chatgpt-search-message-ids="${firstUserId}"><div data-user-message-bubble="true">Witnessed first native send</div></article>
        <article data-chatgpt-selection-message-id="88888888-8888-4888-8888-888888888888"><div data-markdown-text-style="assistant-message">Complete answer</div><button data-testid="copy-turn-action-button">Copy</button></article>`;
      draft(tab, ""); busy(tab, true);
    }, { once: true });
    tab.action.click(); await poll(tab);
    await enqueue(tab, "Queued before navigating away");
    const main = tab.doc.querySelector("main")!;
    const originalMarkup = main.innerHTML;
    let sends = 0;
    tab.action.addEventListener("click", () => {
      sends++;
      const user = tab.doc.createElement("article");
      user.setAttribute("data-chatgpt-search-unit-key", "99999999-9999-4999-8999-999999999999:user");
      user.setAttribute("data-chatgpt-search-message-ids", "99999999-9999-4999-8999-999999999999");
      user.innerHTML = '<div data-user-message-bubble="true"></div>';
      user.firstElementChild!.textContent = tab.composer.innerText;
      main.append(user); draft(tab, ""); busy(tab, true);
    });
    // Navigating with stale old DOM cannot authorize a different queue route.
    tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await poll(tab);
    busy(tab, false); await poll(tab);
    expect(sends).toBe(0);
    tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    main.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    await poll(tab);
    expect(sends).toBe(0);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("identity-unverified");
    main.setAttribute("data-chatgpt-selection-conversation-id", localId);
    main.innerHTML = originalMarkup;
    await poll(tab);
    expect(sends).toBe(1);
    expect((await persisted()).items[0]?.status).toBe("waiting");
    expect(tab.shadow.querySelectorAll("li")).toHaveLength(0);
    await enqueue(tab, "Queued behind the confirmed send");
    draft(tab, "Keep this unsent draft");
    main.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    busy(tab, false); await poll(tab);
    expect(tab.composer.innerText).toBe("Keep this unsent draft");
    expect(tab.shadow.textContent).not.toContain("Reload after the response finishes");
    draft(tab, ""); await poll(tab);
    expect(tab.shadow.textContent).toContain("temporary conversation ID is not linked to this saved chat");
    expect(sends).toBe(1);
  });

  test.each(["visible", "hidden"] as const)("a %s local conversation drains queued messages once after ChatGPT virtualizes its first turn", async state => {
    const { tab, main, localId, firstTurn, native, second } = await localQueueBeforeVirtualization(state);
    firstTurn.forEach(node => node.remove());
    expect(main.getAttribute("data-chatgpt-selection-conversation-id")).toBe(localId);
    expect(main.querySelector("[data-chatgpt-search-message-ids='11111111-1111-4111-8111-111111111111']")).toBeNull();
    await poll(tab);
    expect(native.sent).toHaveLength(1);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueIdentitySource).toBe("native-first-send");
    expect(tab.shadow.querySelector(`li[data-id='${second}']`)).not.toBeNull();
    // Retained identity is not completion: only the still-mounted follow-up's
    // committed reply and toolbar can release the next queued message.
    native.finish(); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["First follow-up before virtualization", "Second follow-up after virtualization"]);
    expect(tab.shadow.querySelector(`li[data-id='${second}']`)).toBeNull();
    native.finish(); now += 4000;
    await poll(tab);
    expect((await persisted()).items).toHaveLength(0);
    await poll(tab); await poll(tab);
    expect(native.sent).toHaveLength(2);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(2);
  });

  test.each(["route", "local-ID"] as const)("virtualized local continuity cannot dispatch after a %s change", async change => {
    const { tab, main, firstTurn, native, second } = await localQueueBeforeVirtualization("hidden");
    firstTurn.forEach(node => node.remove());
    await poll(tab);
    if (change === "route") {
      const otherKey = "chatgpt:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await store.apply({ type: QUEUE_MESSAGE_TYPE, key: otherKey, clientId: "other-tab", action: "enqueue", id: "other-route-item", text: "Must stay in the other conversation" }, "other-tab", now);
      tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    } else main.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    native.finish(); now += 4000;
    await poll(tab); await poll(tab);
    expect(native.sent).toEqual(["First follow-up before virtualization"]);
    expect((await persisted()).items.some(item => item.id === second && item.status === "queued")).toBe(true);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("identity-unverified");
  });

  test("native submit from an unrelated form does not bind a new chat's local transcript", async () => {
    const tab = await createTab({ newChat: true });
    draft(tab, "Unsubmitted composer text");
    const form = tab.doc.createElement("form");
    tab.doc.body.append(form);
    form.dispatchEvent(new tab.dom.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as SubmitEvent);
    tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const localId = "local-chatgpt:77777777-7777-4777-8777-777777777777";
    const main = tab.doc.querySelector("main")!;
    main.setAttribute("data-chatgpt-selection-conversation-id", localId);
    main.innerHTML = `<article data-chatgpt-search-unit-key="55555555-5555-4555-8555-555555555555:user" data-chatgpt-search-message-ids="55555555-5555-4555-8555-555555555555"><div data-user-message-bubble="true">Unsubmitted composer text</div></article>
      <article data-chatgpt-selection-message-id="88888888-8888-4888-8888-888888888888"><div data-markdown-text-style="assistant-message">Already completed</div><button data-testid="copy-turn-action-button">Copy</button></article>`;
    draft(tab, ""); busy(tab, true);
    await poll(tab);
    await enqueue(tab, "Keep this queued until identity is verified");
    let sends = 0;
    tab.action.addEventListener("click", () => sends++);
    busy(tab, false);
    await poll(tab);
    expect(sends).toBe(0);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueState).toBe("identity-unverified");
    expect(tab.shadow.textContent).toContain("temporary conversation ID is not linked to this saved chat");
    expect(tab.shadow.textContent).not.toContain("confirm this response finished");
    const id = (await persisted()).items[0]!.id;
    button(tab, "steer", id).click();
    await waitFor(() => !tab.queue.dispatching, "identity-specific Send now warning");
    expect(tab.shadow.textContent).toContain("temporary conversation ID is not linked to this saved chat");
    expect(tab.shadow.textContent).not.toContain("Wait for this conversation to finish loading before using Send now");
    expect(tab.requests.some(request => request.action === "bind-conversation")).toBe(false);
    expect(sends).toBe(0);
  });

  test.each(["visible", "hidden"] as const)("a fresh %s document restores its witnessed local identity and drains two messages once", async state => {
    const original = await createTab({ newChat: true });
    const localId = "local-chatgpt:77777777-7777-4777-8777-777777777777";
    draft(original, "Witnessed first native message");
    original.action.addEventListener("click", () => {
      original.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const main = original.doc.querySelector("main")!;
      main.setAttribute("data-chatgpt-selection-conversation-id", localId);
      main.innerHTML = `<article data-chatgpt-search-unit-key="11111111-1111-4111-8111-111111111111:user" data-chatgpt-search-message-ids="11111111-1111-4111-8111-111111111111"><div data-user-message-bubble="true">Witnessed first native message</div></article>
        <article data-chatgpt-selection-message-id="22222222-2222-4222-8222-222222222222"><div data-markdown-text-style="assistant-message">Completed first response</div><button data-testid="copy-turn-action-button">Copy</button></article>`;
      draft(original, ""); busy(original, true);
    }, { once: true });
    original.action.click(); await poll(original);
    const first = await enqueue(original, "First durable follow-up");
    const second = await enqueue(original, "Second durable follow-up");
    expect((await persisted()).conversationAliases).toEqual([{
      routeKey: key, localId, firstUserId: "11111111-1111-4111-8111-111111111111",
    }]);
    original.queue.stop();
    // A new realm has no module-memory alias. The durable record must supply
    // the exact witnessed tuple before it can acknowledge or send anything.
    const reopened = await createTab({ visibility: state });
    reopened.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", localId);
    const native = simulateNativeChat(reopened);
    busy(reopened, false); now += 4000;
    await poll(reopened);
    expect(native.sent).toEqual(["First durable follow-up"]);
    expect(reopened.doc.getElementById("plannotator-message-queue")!.dataset.queueIdentitySource).toBe("persisted");
    expect(reopened.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    native.finish(); now += 4000;
    await poll(reopened);
    expect(native.sent).toEqual(["First durable follow-up", "Second durable follow-up"]);
    expect(reopened.shadow.querySelector(`li[data-id='${second}']`)).toBeNull();
    native.finish(); now += 4000; await poll(reopened);
    expect((await persisted()).items).toHaveLength(0);
    await poll(reopened);
    expect(native.sent).toHaveLength(2);
  });

  test("a hidden first response captures and persists identity through mutations with its fallback timer disabled", async () => {
    const tab = await createTab({ newChat: true, visibility: "hidden" });
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    draft(tab, "First send before a long background response");
    tab.action.addEventListener("click", () => {
      // ChatGPT can clear the input before the async first-send request assigns
      // its saved URL. Let that input-triggered tick finish on the empty route.
      draft(tab, ""); busy(tab, true);
    }, { once: true });
    tab.action.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await waitFor(() => !tab.queue.polling, "initial input tick before route assignment");
    expect(tab.queue.state).toBeNull();
    tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const main = tab.doc.querySelector("main")!;
    main.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:77777777-7777-4777-8777-777777777777");
    main.innerHTML = `<article data-chatgpt-search-unit-key="11111111-1111-4111-8111-111111111111:user" data-chatgpt-search-message-ids="11111111-1111-4111-8111-111111111111"><div data-user-message-bubble="true">First send before a long background response</div></article>
      <article data-chatgpt-selection-message-id="22222222-2222-4222-8222-222222222222"><div data-markdown-text-style="assistant-message">First response</div><button data-testid="copy-turn-action-button">Copy</button></article>`;
    await waitFor(() => Boolean(tab.queue.state?.conversationAliases?.length), "background first-send identity persisted without polling");
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueIdentityWitness).toBe("verified");
    now += 121000;
    Object.defineProperty(tab.dom, "Date", { value: class extends Date { static now() { return now; } }, configurable: true });
    await enqueue(tab, "Send after the long first response");
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => native.sent.length === 1, "background completion dispatch without polling");
    await waitFor(() => !tab.queue.dispatching, "background send acknowledgement");
    expect(native.sent).toEqual(["Send after the long first response"]);
    expect(tab.shadow.querySelectorAll("li")).toHaveLength(0);
  });

  test("an unresolved first-send witness does not write a heartbeat for each streamed token", async () => {
    const tab = await createTab({ newChat: true, visibility: "hidden" });
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    draft(tab, "Wait for an identity marker");
    tab.action.addEventListener("click", () => { draft(tab, ""); busy(tab, true); }, { once: true });
    tab.action.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const main = tab.doc.querySelector("main")!;
    main.innerHTML = `<article data-chatgpt-search-unit-key="11111111-1111-4111-8111-111111111111:user" data-chatgpt-search-message-ids="11111111-1111-4111-8111-111111111111"><div data-user-message-bubble="true">Wait for an identity marker</div></article><span id="thinking">Thinking</span>`;
    await waitFor(() => Boolean(tab.queue.state) && !tab.queue.polling, "route transition read");
    const before = tab.requests.filter(request => request.action === "heartbeat").length;
    for (let token = 0; token < 10; token++) {
      main.querySelector("#thinking")!.textContent = `Thinking token ${token}`;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(tab.requests.filter(request => request.action === "heartbeat")).toHaveLength(before);
    main.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:77777777-7777-4777-8777-777777777777");
    await waitFor(() => Boolean(tab.queue.state?.conversationAliases?.length), "late identity attribute persisted");
  });

  test.each(["local-id", "first-user", "mixed-id"])("a stored identity cannot authorize a changed %s transcript", async mismatch => {
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "witness", action: "bind-conversation",
      conversationAlias: { routeKey: key, localId: "local-chatgpt:77777777-7777-4777-8777-777777777777", firstUserId: "11111111-1111-4111-8111-111111111111" },
    }, "previous-witness", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "previous-tab", action: "enqueue", id: "saved-item", text: "Never send into a changed transcript" }, "previous-tab", now);
    const tab = await createTab();
    const main = tab.doc.querySelector("main")!;
    main.setAttribute("data-chatgpt-selection-conversation-id", mismatch === "local-id"
      ? "local-chatgpt:88888888-8888-4888-8888-888888888888" : "local-chatgpt:77777777-7777-4777-8777-777777777777");
    if (mismatch === "first-user") main.querySelector("[data-chatgpt-search-message-ids]")!.setAttribute("data-chatgpt-search-message-ids", "99999999-9999-4999-8999-999999999999");
    if (mismatch === "mixed-id") main.lastElementChild!.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:88888888-8888-4888-8888-888888888888");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000; await poll(tab);
    expect(native.sent).toHaveLength(0);
    expect((await persisted()).items[0]?.status).toBe("queued");
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("identity-unverified");
  });

  test("a delayed identity read cannot restore the old chat after navigation", async () => {
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "witness", action: "bind-conversation",
      conversationAlias: { routeKey: key, localId: "local-chatgpt:77777777-7777-4777-8777-777777777777", firstUserId: "11111111-1111-4111-8111-111111111111" },
    }, "previous-witness", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "previous-tab", action: "enqueue", id: "saved-item", text: "Keep in the original chat" }, "previous-tab", now);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let firstRead = true;
    const tab = await createTab({ returnBeforeRead: true, before(request) {
      if (request.action === "heartbeat" && firstRead) { firstRead = false; return blocked; }
    } });
    tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:77777777-7777-4777-8777-777777777777");
    const native = simulateNativeChat(tab);
    tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    busy(tab, false); release();
    await waitFor(() => !tab.queue.polling, "old route read returns");
    await poll(tab);
    expect(native.sent).toHaveLength(0);
    expect((await persisted()).items[0]?.status).toBe("queued");
    expect(tab.requests.some(request => request.action === "bind-conversation")).toBe(false);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("empty");
  });

  test("commits the message before clearing the composer and survives a fresh tab", async () => {
    const tab = await createTab();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let committed = false;
    tab.after = async request => { if (request.action === "enqueue") { committed = true; await gate; } };
    draft(tab, "Save this before clearing");
    expect(enter(tab)).toBe(false);
    await waitFor(() => committed, "database commit");
    expect((await persisted()).items.map(item => item.text)).toEqual(["Save this before clearing"]);
    expect(tab.composer.innerText).toBe("Save this before clearing");
    release();
    await waitFor(() => !tab.queue.saving, "composer clear");
    expect(tab.composer.innerText).toBe("");
    const fresh = await createTab();
    expect(fresh.shadow.textContent).toContain("Save this before clearing");
  });

  test("failed persistence retains the draft and retry uses the same saved ID", async () => {
    const tab = await createTab();
    let attempts = 0;
    tab.after = request => {
      if (request.action === "enqueue" && ++attempts === 1) throw new Error("Simulated lost commit response");
    };
    draft(tab, "Keep my draft");
    enter(tab);
    await waitFor(() => !tab.queue.saving, "failed send");
    expect(tab.composer.innerText).toBe("Keep my draft");
    expect(tab.shadow.textContent).toContain("Your draft is still in the composer");
    enter(tab);
    await waitFor(() => !tab.queue.saving, "retry commit");
    expect((await persisted()).items).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "enqueue").map(request => request.id).every((id, _index, ids) => id === ids[0])).toBe(true);
    expect(tab.composer.innerText).toBe("");
  });

  test("does not clear newer typing while an enqueue commit is pending", async () => {
    const tab = await createTab();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    tab.before = request => request.action === "enqueue" ? gate : undefined;
    draft(tab, "First draft");
    enter(tab);
    draft(tab, "New typing while saving");
    release();
    await waitFor(() => !tab.queue.saving, "enqueue commit");
    expect((await persisted()).items[0]?.text).toBe("First draft");
    expect(tab.composer.innerText).toBe("New typing while saving");
  });

  test("a composer that refuses to clear cannot duplicate the saved message on retry", async () => {
    const tab = await createTab();
    Object.defineProperty(tab.doc, "execCommand", { value: () => true, configurable: true });
    await enqueue(tab, "Saved but still visible");
    expect(tab.composer.innerText).toBe("Saved but still visible");
    expect(tab.shadow.textContent).toContain("Clear the composer to continue");
    enter(tab);
    await waitFor(() => !tab.queue.saving, "retry with retained draft");
    expect((await persisted()).items).toHaveLength(1);
    Object.defineProperty(tab.doc, "execCommand", { value: () => false, configurable: true });
    enter(tab);
    await waitFor(() => !tab.queue.saving, "successful clear");
    expect(tab.composer.innerText).toBe("");
    expect((await persisted()).items).toHaveLength(1);
  });

  test("Enter queues while busy, while Shift+Enter and the native Stop retain their meanings", async () => {
    const tab = await createTab();
    let stopClicks = 0;
    tab.action.addEventListener("click", () => { stopClicks++; });
    draft(tab, "Queued from Enter");
    expect(enter(tab, { shiftKey: true })).toBe(true);
    expect(enter(tab, { isComposing: true })).toBe(true);
    tab.action.click();
    expect(stopClicks).toBe(1);
    expect((await persisted()).items).toHaveLength(0);
    expect(enter(tab)).toBe(false);
    await waitFor(() => !tab.queue.saving, "Enter enqueue");
    expect((await persisted()).items[0]?.text).toBe("Queued from Enter");
  });

  test("reorders, edits, removes, and pauses through the visible queue controls", async () => {
    const tab = await createTab();
    const first = await enqueue(tab, "First");
    const second = await enqueue(tab, "Second");
    await enqueue(tab, "Third");
    dragMessage(tab, second, first);
    await waitFor(() => tab.queue.state?.items[0]?.id === second, "reorder");
    expect((await persisted()).items.map(item => item.text)).toEqual(["Second", "First", "Third"]);
    await editInComposer(tab, first);
    draft(tab, "First, revised");
    button(tab, "save", first).click();
    await waitFor(() => tab.queue.state?.items.some(item => item.text === "First, revised") ?? false, "edit");
    button(tab, "remove", second).click();
    await waitFor(() => tab.queue.state?.items.length === 2, "remove");
    expect((await persisted()).paused).toBe(false);
    expect((await persisted()).items.map(item => item.text)).toEqual(["First, revised", "Third"]);
    button(tab, "pause").click();
    await waitFor(() => tab.queue.state?.paused === true, "pause");
    expect(button(tab, "pause").textContent).toBe("Resume");
  });

  test("only the drag handle reorders messages, leaving message text selectable", async () => {
    const tab = await createTab();
    const first = await enqueue(tab, "First message");
    const second = await enqueue(tab, "Second message");
    const third = await enqueue(tab, "Third message");
    const firstRow = tab.shadow.querySelector<HTMLElement>(`li[data-id='${first}']`)!;
    const thirdRow = tab.shadow.querySelector<HTMLElement>(`li[data-id='${third}']`)!;
    expect(thirdRow.getAttribute("draggable")).not.toBe("true");
    expect(thirdRow.querySelector("[draggable='true']")).not.toBeNull();
    expect(tab.shadow.querySelector("button[data-action='up'], button[data-action='down']")).toBeNull();
    drag(tab, thirdRow.querySelector(".text")!, firstRow);
    expect(tab.requests.filter(request => request.action === "move")).toHaveLength(0);
    expect((await persisted()).items.map(item => item.id)).toEqual([first, second, third]);

    dragMessage(tab, third, first);
    await waitFor(() => tab.queue.state?.items[0]?.id === third, "handle reorder");
    expect((await persisted()).items.map(item => item.id)).toEqual([third, first, second]);
    expect(tab.requests.filter(request => request.action === "move")).toHaveLength(1);

    // Pointer capture keeps targeting the held handle while the coordinates
    // cross another row; distinct bounds stand in for browser layout here.
    const rows = Array.from(tab.shadow.querySelectorAll<HTMLElement>("li[data-id]"));
    rows.forEach((row, index) => Object.defineProperty(row, "getBoundingClientRect", {
      value: () => new tab.dom.DOMRect(100, 100 + index * 50, 500, 50), configurable: true,
    }));
    const handle = rows[2]!.querySelector<HTMLElement>("[draggable='true']")!;
    const pointer = (type: string, y: number) => handle.dispatchEvent(new tab.dom.PointerEvent(type, {
      pointerId: 7, button: 0, buttons: type === "pointerup" ? 0 : 1,
      clientX: 110, clientY: y, bubbles: true, composed: true, cancelable: true,
    }) as unknown as PointerEvent);
    pointer("pointerdown", 225);
    expect(handle.hasPointerCapture(7)).toBe(true);
    pointer("pointermove", 125);
    expect(tab.requests.filter(request => request.action === "move")).toHaveLength(1);
    pointer("pointerup", 125);
    expect(handle.hasPointerCapture(7)).toBe(false);
    await waitFor(() => tab.queue.state?.items[0]?.id === second, "captured pointer reorder");
    expect((await persisted()).items.map(item => item.id)).toEqual([second, third, first]);
    expect(tab.requests.filter(request => request.action === "move")).toHaveLength(2);
  });

  test.each(["Enter", "click"] as const)("editing the middle item through native %s preserves its ID, position, and pause preference", async activation => {
    const tab = await createTab();
    const first = await enqueue(tab, "First in line");
    const middle = await enqueue(tab, "Middle in line");
    const last = await enqueue(tab, "Last in line");
    button(tab, "pause").click();
    await waitFor(() => Boolean(tab.queue.state?.paused), "pause preference");
    await editInComposer(tab, middle);
    expect(tab.composer.innerText).toBe("Middle in line");
    expect(tab.shadow.querySelector("textarea")).toBeNull();
    const native = simulateNativeChat(tab);
    draft(tab, "Middle revised in native composer");
    if (activation === "Enter") enter(tab);
    else { busy(tab, false); tab.action.click(); }
    await waitFor(() => tab.queue.state?.items.find(item => item.id === middle)?.status === "queued", "reserved edit commit");
    expect((await persisted()).items.map(item => item.id)).toEqual([first, middle, last]);
    expect((await persisted()).items.map(item => item.text)).toEqual(["First in line", "Middle revised in native composer", "Last in line"]);
    expect((await persisted()).paused).toBe(true);
    expect(tab.composer.innerText).toBe("");
    expect(native.sent).toEqual([]);
    expect(native.stops).toBe(0);
  });

  test("an edit save failure keeps the revised draft and reservation, then retries the same slot", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Original saved message");
    await editInComposer(tab, id);
    draft(tab, "Revised draft to preserve");
    let failed = false;
    tab.before = request => {
      if (request.action === "edit" && !failed) { failed = true; throw new Error("Simulated edit storage failure"); }
    };
    enter(tab);
    await waitFor(() => Boolean(tab.shadow.textContent?.includes("Simulated edit storage failure")), "failed edit response");
    expect(tab.composer.innerText).toBe("Revised draft to preserve");
    expect((await persisted()).items[0]?.status).toBe("editing");
    expect((await persisted()).items[0]?.text).toBe("Original saved message");
    enter(tab);
    await waitFor(() => tab.queue.state?.items[0]?.status === "queued", "edit retry commit");
    expect((await persisted()).items.map(item => [item.id, item.text])).toEqual([[id, "Revised draft to preserve"]]);
    expect(tab.composer.innerText).toBe("");
    expect((await persisted()).paused).toBe(false);
  });

  test("saving after an edit lease expires preserves the draft, original slot, and recovery pause", async () => {
    const tab = await createTab();
    const first = await enqueue(tab, "First before sleeping");
    const edited = await enqueue(tab, "Original middle message");
    const last = await enqueue(tab, "Last after sleeping");
    await editInComposer(tab, edited);
    draft(tab, "Revised while this tab was sleeping");
    now += QUEUE_EDIT_MS + 1;
    const expired = await persisted();
    expect(expired.items[1]?.status).toBe("queued");
    expect(expired.paused).toBe(true);
    await poll(tab);
    expect(tab.composer.innerText).toBe("Revised while this tab was sleeping");
    button(tab, "save", edited).click();
    await waitFor(() => tab.composer.innerText === "", "expired edit reacquired and saved");
    const saved = await persisted();
    expect(saved.items.map(item => item.id)).toEqual([first, edited, last]);
    expect(saved.items[1]?.text).toBe("Revised while this tab was sleeping");
    expect(saved.items[1]?.status).toBe("queued");
    expect(saved.paused).toBe(true);
    expect(tab.requests.filter(request => request.action === "begin-edit")).toHaveLength(2);
  });

  test("cancelling after an edit lease expires restores the original and releases the local composer", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Original queued text survives");
    await editInComposer(tab, id);
    draft(tab, "Unsaved edit to cancel");
    now += QUEUE_EDIT_MS + 1;
    await poll(tab);
    expect((await persisted()).items[0]?.status).toBe("queued");
    button(tab, "cancel-edit", id).click();
    await waitFor(() => tab.composer.innerText === "", "expired edit cancel");
    const saved = await persisted();
    expect(saved.items.map(item => [item.id, item.text, item.status])).toEqual([[id, "Original queued text survives", "queued"]]);
    expect(saved.paused).toBe(true);
    expect(tab.shadow.querySelector("button[data-action='cancel-edit']")).toBeNull();
    expect(tab.requests.filter(request => request.action === "cancel-edit")).toHaveLength(0);
  });

  test("simultaneous pencil clicks reserve an item for only one tab", async () => {
    const left = await createTab();
    const id = await enqueue(left, "One editable message");
    const right = await createTab();
    button(left, "edit", id).click();
    button(right, "edit", id).click();
    await waitFor(() => Boolean(left.composer.innerText || right.composer.innerText), "one editor composer fill");
    await waitFor(() => left.requests.some(request => request.action === "begin-edit") && right.requests.some(request => request.action === "begin-edit"), "competing reservations");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect([left.composer.innerText, right.composer.innerText].filter(Boolean)).toEqual(["One editable message"]);
    expect((await persisted()).items).toHaveLength(1);
    expect((await persisted()).items[0]?.status).toBe("editing");
    expect((await persisted()).paused).toBe(false);
  });

  test("saving an edit restores automatic sending without an extra Resume step", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Before editing");
    await editInComposer(tab, id);
    draft(tab, "Send the edited version");
    enter(tab);
    await waitFor(() => tab.queue.state?.items[0]?.status === "queued", "edit saved");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Send the edited version"]);
    expect((await persisted()).paused).toBe(false);
    expect((await persisted()).items[0]?.id).toBe(id);
    expect((await persisted()).items[0]?.status).toBe("waiting");
  });

  test("a lost edit acknowledgement retries idempotently without moving or duplicating the item", async () => {
    const tab = await createTab();
    await enqueue(tab, "First unchanged");
    const id = await enqueue(tab, "Edit this second item");
    await editInComposer(tab, id);
    let lost = false;
    let heartbeatHeld = false;
    let releaseHeartbeat!: () => void;
    const heartbeatGate = new Promise<void>(resolve => { releaseHeartbeat = resolve; });
    tab.after = async request => {
      if (request.action === "heartbeat" && !heartbeatHeld) { heartbeatHeld = true; await heartbeatGate; }
      if (request.action === "edit" && !lost) { lost = true; throw new Error("Simulated lost edit acknowledgement"); }
    };
    draft(tab, "Second item edited once");
    const overlappingPoll = poll(tab);
    await waitFor(() => heartbeatHeld, "heartbeat before edit commit");
    enter(tab);
    await waitFor(() => Boolean(tab.shadow.textContent?.includes("Simulated lost edit acknowledgement")), "lost edit response");
    releaseHeartbeat();
    await overlappingPoll;
    expect(tab.shadow.querySelector(".error")?.textContent).toContain("Simulated lost edit acknowledgement");
    expect(tab.composer.innerText).toBe("Second item edited once");
    expect((await persisted()).items[1]?.text).toBe("Second item edited once");
    enter(tab);
    await waitFor(() => tab.composer.innerText === "", "edit acknowledgement retry");
    expect((await persisted()).items.map(item => item.text)).toEqual(["First unchanged", "Second item edited once"]);
    expect((await persisted()).items[1]?.id).toBe(id);
  });

  test("pencil and Send now preserve a pre-existing composer draft", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Saved in queue");
    const native = simulateNativeChat(tab);
    draft(tab, "Unrelated draft that must survive");
    button(tab, "edit", id).click();
    await waitFor(() => Boolean(tab.shadow.textContent?.includes("current draft")), "edit draft guard");
    button(tab, "steer", id).click();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(tab.composer.innerText).toBe("Unrelated draft that must survive");
    expect((await persisted()).items[0]?.status).toBe("queued");
    expect(native.sent).toEqual([]);
    expect(native.stops).toBe(0);
  });

  test("Send now stops once, sends the selected item once, and preserves the paused remaining queue", async () => {
    const tab = await createTab();
    const first = await enqueue(tab, "Response already running");
    const second = await enqueue(tab, "Keep this for later");
    const selected = await enqueue(tab, "Steer with this selected message");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Response already running"]);
    expect((await persisted()).items.find(item => item.id === first)?.status).toBe("waiting");
    button(tab, "pause").click();
    await waitFor(() => Boolean(tab.queue.state?.paused), "paused remaining queue");
    button(tab, "steer", selected).click();
    await waitFor(() => !tab.queue.dispatching, "selected immediate send");
    expect(native.stops).toBe(1);
    expect(native.sent).toEqual(["Response already running", "Steer with this selected message"]);
    const saved = await persisted();
    expect(saved.items.map(item => item.id)).toEqual([selected, second]);
    expect(saved.items.map(item => item.status)).toEqual(["waiting", "queued"]);
    expect(saved.paused).toBe(true);
    native.finish(); now += 4000;
    await poll(tab);
    expect((await persisted()).items.map(item => item.id)).toEqual([second]);
    await poll(tab);
    expect(native.sent).toHaveLength(2);
  });

  test.each(["visible", "hidden"] as const)("Send now removes a rich multiline prompt once in a %s tab and completion sends the next item", async visibility => {
    const tab = await createTab({ visibility });
    const text = "Harmless multiline transcript:\n    Keep indentation.\n\nFirst result.\n\nSecond result.\nA continuation.\n\nThird result.\n\nFourth result.\n\nLast paragraph.";
    const first = await enqueue(tab, text);
    const secondText = "Follow up once the response completes.";
    const second = await enqueue(tab, secondText);
    const native = simulateNativeChat(tab, renderRichUser);
    button(tab, "steer", first).click();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "rich user acknowledgement", 500);
    expect(native.stops).toBe(1);
    expect(native.sent).toEqual([text]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[first, "waiting"], [second, "queued"]]);
    expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "ack").map(request => request.id)).toEqual([first]);
    await poll(tab);
    expect(native.sent).toEqual([text]);
    native.finish();
    await waitFor(() => native.sent.length === 2 && !tab.queue.dispatching, "auto next after rich prompt completion", 500);
    expect(native.sent).toEqual([text, secondText]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[second, "waiting"]]);
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([first, second]);
    expect(tab.requests.filter(request => request.action === "ack").map(request => request.id)).toEqual([first, second]);
    native.finish();
    await waitFor(() => tab.queue.state?.items.length === 0, "final rich prompt retires");
    expect(native.sent).toHaveLength(2);
  });

  test.each(["changed spacing", "changed blank line", "old ID"] as const)("a rich user bubble with %s cannot acknowledge a Send now attempt", async mismatch => {
    const tab = await createTab();
    const text = "Literal  spacing.\n\nSecond paragraph.";
    const id = await enqueue(tab, text);
    if (mismatch === "old ID") renderRichUser(tab.doc.querySelector("[data-user-message-bubble]")!, text);
    let clicks = 0;
    tab.action.addEventListener("click", () => {
      if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) { busy(tab, false); return; }
      clicks++;
      if (mismatch !== "old ID") {
        postUserBubble(tab, "");
        const postedText = mismatch === "changed spacing"
          ? text.replace("Literal  spacing", "Literal spacing")
          : text.replace("\n\n", "\n");
        renderRichUser(tab.doc.querySelector("main")!.lastElementChild!.firstElementChild as HTMLElement, postedText);
      }
      draft(tab, ""); busy(tab, true);
    });
    button(tab, "steer", id).click();
    await waitFor(() => clicks === 1, "single attempted send");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    expect(tab.requests.filter(request => request.action === "ack")).toHaveLength(0);
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).not.toBeNull();
    Object.defineProperty(tab.dom, "Date", { value: class extends Date {
      static override now(): number { return Date.now() + 16_000; }
    }, configurable: true });
    await waitFor(() => !tab.queue.dispatching, "unproven rich send moves to review", 600);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("review");
    expect(clicks).toBe(1);
    expect(tab.requests.filter(request => request.action === "ack")).toHaveLength(0);
  });

  test.each(["visible", "hidden"] as const)("Send now removes a collapsed plain prompt once in a %s tab and completion sends the next item", async visibility => {
    const tab = await createTab({ visibility });
    const text = "Harmless plain transcript:\n    Keep  indentation.\n\n" + "Result line, preserving exact punctuation.\n".repeat(32) + "Literal final ellipsis …";
    const first = await enqueue(tab, text);
    const secondText = "Follow up after the collapsed prompt response completes.";
    const second = await enqueue(tab, secondText);
    const native = simulateNativeChat(tab, renderCollapsedPlainUser);
    button(tab, "steer", first).click();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "collapsed plain user acknowledgement", 500);
    expect(native.stops).toBe(1);
    expect(native.sent).toEqual([text]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[first, "waiting"], [second, "queued"]]);
    expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "ack").map(request => request.id)).toEqual([first]);
    await poll(tab);
    expect(native.sent).toEqual([text]);
    native.finish();
    await waitFor(() => native.sent.length === 2 && !tab.queue.dispatching, "auto next after collapsed prompt completion", 500);
    expect(native.sent).toEqual([text, secondText]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[second, "waiting"]]);
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([first, second]);
    expect(tab.requests.filter(request => request.action === "ack").map(request => request.id)).toEqual([first, second]);
    native.finish();
    await waitFor(() => tab.queue.state?.items.length === 0, "final collapsed prompt retires");
    expect(native.sent).toHaveLength(2);
  });

  test.each(["changed content", "old ID"] as const)("a collapsed plain user bubble with %s cannot acknowledge a Send now attempt", async mismatch => {
    const tab = await createTab();
    const text = "Literal  spacing.\n\nA submitted trailing ellipsis …";
    const id = await enqueue(tab, text);
    if (mismatch === "old ID") renderCollapsedPlainUser(tab.doc.querySelector("[data-user-message-bubble]")!, text);
    let clicks = 0;
    tab.action.addEventListener("click", () => {
      if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) { busy(tab, false); return; }
      clicks++;
      if (mismatch !== "old ID") {
        postUserBubble(tab, "");
        renderCollapsedPlainUser(tab.doc.querySelector("main")!.lastElementChild!.firstElementChild as HTMLElement, text.replace("Literal  spacing", "Literal spacing"));
      }
      draft(tab, ""); busy(tab, true);
    });
    button(tab, "steer", id).click();
    await waitFor(() => clicks === 1, "single collapsed attempted send");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    expect(tab.requests.filter(request => request.action === "ack")).toHaveLength(0);
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).not.toBeNull();
    Object.defineProperty(tab.dom, "Date", { value: class extends Date {
      static override now(): number { return Date.now() + 16_000; }
    }, configurable: true });
    await waitFor(() => !tab.queue.dispatching, "unproven collapsed send moves to review", 600);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("review");
    expect(clicks).toBe(1);
    expect(tab.requests.filter(request => request.action === "ack")).toHaveLength(0);
  });

  test("Send now cannot interrupt another tab's reserved edit", async () => {
    const editing = await createTab();
    const reserved = await enqueue(editing, "Reserved for editing");
    const next = await enqueue(editing, "Pending send now");
    const sender = await createTab();
    await editInComposer(editing, reserved);
    const native = simulateNativeChat(sender);
    button(sender, "steer", next).click();
    await waitFor(() => !sender.queue.dispatching, "rejected steer while editing");
    expect(native.stops).toBe(0);
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[reserved, "editing"], [next, "queued"]]);
    expect(editing.composer.innerText).toBe("Reserved for editing");
  });

  test("navigation while Send now awaits its reservation never stops or sends in the new chat", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Belongs to the original conversation");
    const native = simulateNativeChat(tab);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let claimed = false;
    tab.after = async request => {
      if (request.action === "steer") { claimed = true; await gate; }
    };
    button(tab, "steer", id).click();
    await waitFor(() => claimed, "steer reservation before response");
    tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    release();
    await waitFor(() => !tab.queue.dispatching, "aborted send after route change");
    expect(native.stops).toBe(0);
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerText).toBe("");
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    expect((await persisted()).items[0]?.text).toBe("Belongs to the original conversation");
  });

  test("two independent tabs enqueue concurrently and receive each other's changes", async () => {
    const left = await createTab();
    const right = await createTab();
    draft(left, "From left tab"); draft(right, "From right tab");
    enter(left); enter(right);
    await waitFor(() => !left.queue.saving && !right.queue.saving, "concurrent enqueue commits");
    await waitFor(() => left.queue.state?.items.length === 2 && right.queue.state?.items.length === 2, "cross-tab synchronization");
    expect(new Set((await persisted()).items.map(item => item.text))).toEqual(new Set(["From left tab", "From right tab"]));
    const id = left.queue.state!.items[0]!.id;
    button(left, "remove", id).click();
    await waitFor(() => right.queue.state?.items.length === 1, "cross-tab removal");
    expect(right.shadow.querySelectorAll("li")).toHaveLength(1);
  });

  test("visible and hidden tabs racing for the same queued item send it exactly once", async () => {
    const visible = await createTab();
    const hidden = await createTab({ visibility: "hidden" });
    const id = await enqueue(visible, "Only one tab may send this shared item");
    await waitFor(() => hidden.queue.state?.items.some(item => item.id === id) === true, "hidden tab receives shared item");
    const visibleNative = simulateNativeChat(visible);
    const hiddenNative = simulateNativeChat(hidden);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const contenders = new Set<Tab>();
    for (const tab of [visible, hidden]) tab.before = async request => {
      if (request.action === "claim") { contenders.add(tab); await gate; }
    };
    busy(visible, false);
    busy(hidden, false);
    await waitFor(() => contenders.size === 2, "both visible and hidden tabs attempt the same claim");
    release();
    await waitFor(() => visibleNative.sent.length + hiddenNative.sent.length === 1 &&
      !visible.queue.dispatching && !hidden.queue.dispatching, "single shared dispatch acknowledged");
    await poll(visible);
    await poll(hidden);
    expect([...visibleNative.sent, ...hiddenNative.sent]).toEqual(["Only one tab may send this shared item"]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "waiting"]]);
    expect([...visible.requests, ...hidden.requests].filter(request => request.action === "attempt").map(request => request.id)).toEqual([id]);
  });

  test("switching to another tab while an owned claim returns preserves one send", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Keep the claimed item when its tab becomes hidden");
    const native = simulateNativeChat(tab);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let claimed = false;
    tab.after = async request => {
      if (request.action === "claim") { claimed = true; await gate; }
    };
    busy(tab, false);
    await waitFor(() => claimed, "durable claim before its response");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("claimed");
    visibility(tab, "hidden");
    release();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "owned send acknowledged while hidden");
    visibility(tab, "visible");
    await poll(tab);
    expect(native.sent).toEqual(["Keep the claimed item when its tab becomes hidden"]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "waiting"]]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "release")).toHaveLength(0);
  });

  test.each(["expired", "paused"] as const)("a hidden tab does not click after its delayed attempt response becomes %s", async change => {
    const tab = await createTab({ visibility: "hidden" });
    const text = "Preserve the saved item when send authorization changes";
    const id = await enqueue(tab, text);
    const native = simulateNativeChat(tab);
    const clock = { now: Date.now() };
    Object.assign(tab.dom, { Date: class extends Date { static override now() { return clock.now; } } });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempted = false;
    tab.after = async request => {
      if (request.action === "attempt") { attempted = true; await gate; }
    };
    busy(tab, false);
    await waitFor(() => attempted, "durable attempt before its response");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    if (change === "expired") clock.now += 30_001;
    else {
      button(tab, "pause").click();
      await waitFor(() => tab.queue.state?.paused === true, "pause persisted while attempt response is pending");
    }
    release();
    await waitFor(() => !tab.queue.dispatching, "changed attempt preserved for review");
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerText).toBe("");
    const saved = await persisted();
    expect(saved.items.map(item => [item.id, item.status])).toEqual([[id, "review"]]);
    expect(saved.items[0]?.text).toBe(text);
    if (change === "paused") expect(saved.paused).toBe(true);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([id]);
  });

  test.each(["attachment", "pause", "busy"] as const)("a hidden tab still respects its %s guard and sends after it clears", async guard => {
    const tab = await createTab({ visibility: "hidden" });
    const id = await enqueue(tab, "Send only after the protected state clears");
    const native = simulateNativeChat(tab);
    if (guard === "attachment") tab.composer.closest("[data-composer-body]")!.insertAdjacentHTML("beforeend", '<div data-file-id="protected-file">File</div>');
    if (guard === "pause") {
      button(tab, "pause").click();
      await waitFor(() => tab.queue.state?.paused === true, "hidden queue paused");
    }
    if (guard !== "busy") busy(tab, false);
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "queued"]]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueState).toBe(guard === "pause" ? "paused" : guard === "busy" ? "chat-busy" : guard === "attachment" ? "attachments" : "draft");
    expect(host.dataset.queueVisibility).toBe("hidden");
    if (guard === "attachment") {
      expect(tab.shadow.querySelector("li .status")?.textContent).toBe("Send or remove your attachment to continue.");
      tab.doc.querySelector("[data-file-id]")!.remove();
    } else if (guard === "pause") button(tab, "pause").click();
    else busy(tab, false);
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "hidden dispatch after its guard clears");
    expect(native.sent).toEqual(["Send only after the protected state clears"]);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    expect(tab.doc.visibilityState).toBe("hidden");
    expect(host.dataset.queueLastDispatchVisibility).toBe("hidden");
    expect(host.dataset.queueConfirmedSends).toBe("1");
    expect(tab.shadow.querySelector("li .status")).toBeNull();
    expect(tab.shadow.textContent).not.toContain("Stored in this Chrome profile");
  });

  test("draft restores after native ChatGPT clears to its structural ProseMirror placeholder", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Queued through native empty paragraph");
    draft(tab, "Preserve my unfinished text");
    const native = simulateNativeChat(tab);
    tab.action.addEventListener("click", () => {
      tab.composer.innerHTML = '<p data-empty-paragraph="true"><br class="ProseMirror-trailingBreak"></p>';
    });
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Queued through native empty paragraph"]);
    expect(tab.composer.textContent).toBe("Preserve my unfinished text");
    expect((await persisted()).drafts ?? []).toEqual([]);
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
  });

  test.each(["visible", "hidden"] as const)("automatic dispatch preserves a draft in a %s tab", async state => {
    const tab = await createTab({ visibility: state });
    const id = await enqueue(tab, "Saved queued text");
    draft(tab, "Do not replace this draft");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Saved queued text"]);
    expect(tab.composer.innerText).toBe("Do not replace this draft");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
  });

  test("draft preservation captures typing and selection after a delayed claim response", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Only the saved queue message should send");
    draft(tab, "Earlier draft"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let claimed = false;
    tab.after = request => { if (request.action === "claim") { claimed = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => claimed, "draft-preserving claim await");
    draft(tab, "Latest typing during the claim");
    tab.dom.getSelection()!.setBaseAndExtent(tab.composer.firstChild as never, 7, tab.composer.firstChild as never, 15);
    expect(draftBuffer(tab)).toBeNull();
    release();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "queued send after claim and draft restoration");
    expect(native.sent).toEqual(["Only the saved queue message should send"]);
    expect(tab.composer.textContent).toBe("Latest typing during the claim");
    expect(tab.doc.activeElement).toBe(tab.composer);
    expect([tab.dom.getSelection()!.anchorOffset, tab.dom.getSelection()!.focusOffset]).toEqual([7, 15]);
    expect((await persisted()).drafts).toEqual([]);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
  });

  test("ProseMirror draft preservation commits the queued native model before returning focus to the draft", async () => {
    const tab = await createTab();
    await enqueue(tab, "QUEUED_PAYLOAD_B");
    draft(tab, "UNSENT_USER_DRAFT"); tab.composer.focus();
    const native = simulateObserverBackedNativeChat(tab);
    try {
      busy(tab, false); now += 4000;
      await waitFor(() => native.sent.length > 0, "model-backed native send");
      expect(native.sent).toEqual(["QUEUED_PAYLOAD_B"]);
      expect(native.deferredBlurs).not.toContain("QUEUED_PAYLOAD_B");
      await waitFor(() => !tab.queue.dispatching, "model-backed acknowledgement and restore");
      expect(tab.composer.textContent).toBe("UNSENT_USER_DRAFT");
      expect(native.model()).toBe("UNSENT_USER_DRAFT");
    } finally { native.close(); }
  });

  test("ProseMirror draft restoration commits its model before a subsequent native Enter", async () => {
    const tab = await createTab();
    await enqueue(tab, "QUEUED_PAYLOAD_A");
    draft(tab, "RESTORED_USER_DRAFT");
    const other = tab.doc.createElement("input"); tab.doc.body.append(other); other.focus();
    const native = simulateObserverBackedNativeChat(tab);
    // Isolate restoration: unrelated native work is allowed to flush the first
    // queued replacement before Send, even with the old premature-focus code.
    tab.before = request => { if (request.action === "attempt") native.flush(); };
    try {
      busy(tab, false); now += 4000;
      await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "first model-backed send and background draft restoration");
      expect(native.sent).toEqual(["QUEUED_PAYLOAD_A"]);
      expect(tab.doc.activeElement).toBe(other);
      expect(native.model()).toBe("RESTORED_USER_DRAFT");
      native.finish();
      await waitFor(() => tab.queue.state?.items.length === 0, "first queued response retired");
      tab.composer.focus();
      const explicitEnter = new tab.dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true });
      Object.defineProperty(explicitEnter, "isTrusted", { value: true });
      tab.composer.dispatchEvent(explicitEnter as unknown as Event);
      await waitFor(() => native.sent.length === 2, "subsequent explicit Enter");
      expect(native.sent).toEqual(["QUEUED_PAYLOAD_A", "RESTORED_USER_DRAFT"]);
    } finally { native.close(); }
  });

  test("ProseMirror native commit redirects new typing without submitting it as queued text", async () => {
    const tab = await createTab();
    await enqueue(tab, "QUEUED_PAYLOAD_WITH_COMMIT_TYPING");
    draft(tab, "Draft"); tab.composer.focus();
    const native = simulateObserverBackedNativeChat(tab);
    let redirected = false;
    tab.composer.addEventListener("input", () => {
      if (tab.composer.textContent !== "QUEUED_PAYLOAD_WITH_COMMIT_TYPING" || redirected) return;
      // Arrive at the first microtask after the browser's owned edit, while
      // its task barrier has not yet returned keyboard focus to the buffer.
      queueMicrotask(() => {
        if (!draftBuffer(tab)) return;
        draftBuffer(tab)!.setSelectionRange(5, 5);
        const input = new tab.dom.InputEvent("beforeinput", { inputType: "insertText", data: " typed during commit", bubbles: true, cancelable: true });
        Object.defineProperty(input, "isTrusted", { value: true });
        redirected = !tab.composer.dispatchEvent(input as unknown as Event);
      });
    });
    try {
      busy(tab, false); now += 4000;
      await waitFor(() => native.sent.length > 0, "native model send after concurrent typing");
      expect(redirected).toBe(true);
      expect(native.sent).toEqual(["QUEUED_PAYLOAD_WITH_COMMIT_TYPING"]);
      await waitFor(() => !tab.queue.dispatching, "concurrent typed draft restored");
      expect(tab.composer.textContent).toBe("Draft typed during commit");
      expect(native.model()).toBe("Draft typed during commit");
    } finally { native.close(); }
  });

  test.each(["typing", "Enter", "route"] as const)("ProseMirror restoration rechecks %s that arrives during its commit barrier", async change => {
    const tab = await createTab();
    await enqueue(tab, "QUEUED_BEFORE_RESTORE_RACE");
    draft(tab, "Draft before restoration"); tab.composer.focus();
    const native = simulateObserverBackedNativeChat(tab);
    let changed = false;
    tab.composer.addEventListener("input", () => {
      if (changed || !native.sent.length || tab.composer.textContent !== "Draft before restoration") return;
      changed = true;
      queueMicrotask(() => {
        if (change === "typing") typeInBuffer(tab, "Draft typed during restoration");
        else if (change === "Enter") enterBuffer(tab);
        else {
          tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
          tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
          draft(tab, "Independent new-route draft");
        }
      });
    });
    try {
      busy(tab, false); now += 4000;
      await waitFor(() => changed && !tab.queue.dispatching, "restore race settles after native model commit");
      expect(native.sent).toEqual(["QUEUED_BEFORE_RESTORE_RACE"]);
      const saved = await persisted();
      if (change === "typing") {
        expect(tab.composer.textContent).toBe("Draft typed during restoration");
        expect(native.model()).toBe("Draft typed during restoration");
        expect(saved.drafts).toEqual([]);
      } else if (change === "Enter") {
        expect(tab.composer.textContent).toBe("");
        expect(native.model()).toBe("");
        expect(saved.items.filter(item => item.text === "Draft before restoration")).toHaveLength(1);
        expect(saved.drafts).toEqual([]);
      } else {
        expect(tab.composer.textContent).toBe("Independent new-route draft");
        expect(saved.drafts?.map(entry => entry.text)).toEqual(["Draft before restoration"]);
      }
    } finally { native.close(); }
  });

  test("ProseMirror restoration leaves an IME composition attached across its commit barrier", async () => {
    const tab = await createTab();
    await enqueue(tab, "QUEUED_BEFORE_RESTORE_IME");
    draft(tab, "Draft before IME restoration"); tab.composer.focus();
    const native = simulateObserverBackedNativeChat(tab);
    let composing = false;
    tab.composer.addEventListener("input", () => {
      if (composing || !native.sent.length || tab.composer.textContent !== "Draft before IME restoration") return;
      queueMicrotask(() => {
        const buffer = draftBuffer(tab)!;
        buffer.dispatchEvent(new tab.dom.CompositionEvent("compositionstart", { bubbles: true, composed: true }) as unknown as Event);
        typeInBuffer(tab, "編集中"); composing = true;
      });
    });
    try {
      busy(tab, false); now += 4000;
      await waitFor(() => composing, "IME begins during restore model commit");
      expect(tab.queue.dispatching).toBe(true);
      expect(draftBuffer(tab)?.isConnected).toBe(true);
      const buffer = typeInBuffer(tab, "編集完了");
      buffer.dispatchEvent(new tab.dom.CompositionEvent("compositionend", { bubbles: true, composed: true }) as unknown as Event);
      await waitFor(() => !tab.queue.dispatching, "IME finishes before native restoration is released");
      expect(native.sent).toEqual(["QUEUED_BEFORE_RESTORE_IME"]);
      expect(tab.composer.textContent).toBe("編集完了");
      expect(native.model()).toBe("編集完了");
      expect((await persisted()).drafts).toEqual([]);
    } finally { native.close(); }
  });

  test.each(["unchanged", "typing", "Enter"] as const)("acknowledged queue send preserves %s while native consumption clears the input later", async change => {
    const tab = await createTab();
    const id = await enqueue(tab, "ACK_BEFORE_NATIVE_CLEAR");
    draft(tab, "Keep this unsent draft in its input"); tab.composer.focus();
    const native = simulateDelayedComposerConsumption(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => tab.requests.some(request => request.action === "ack"), "queue delivery acknowledged before native clear");
    expect(native.sent).toEqual(["ACK_BEFORE_NATIVE_CLEAR"]);
    expect(tab.composer.textContent).toBe("ACK_BEFORE_NATIVE_CLEAR");
    // A realistic later native commit: delivery evidence has arrived while the
    // original editor still contains the sent payload.
    await new Promise(resolve => setTimeout(resolve, 40));
    if (change !== "unchanged") typeInBuffer(tab, "Latest typing while native clear is pending");
    if (change === "Enter") {
      enterBuffer(tab);
      await waitFor(() => draftBuffer(tab)?.value === "", "buffer Enter durably enqueued during native clear wait");
    }
    native.clear();
    const expectedDraft = change === "unchanged" ? "Keep this unsent draft in its input" : change === "typing" ? "Latest typing while native clear is pending" : "";
    await waitFor(() => !tab.queue.dispatching && tab.composer.textContent === expectedDraft, "draft restored after delayed native consumption", 700);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    expect((await persisted()).drafts).toEqual([]);
    expect(tab.shadow.querySelector('[aria-label="Saved unsent draft"]')).toBeNull();
    expect((await persisted()).items.filter(item => item.text === "Latest typing while native clear is pending")).toHaveLength(change === "Enter" ? 1 : 0);
    expect(native.sent).toEqual(["ACK_BEFORE_NATIVE_CLEAR"]);
  });

  test("acknowledged queue send times out safely when the native payload never clears", async () => {
    const tab = await createTab();
    await enqueue(tab, "ACK_WITHOUT_NATIVE_CLEAR");
    draft(tab, "Recover this unfinished draft"); tab.composer.focus();
    const native = simulateDelayedComposerConsumption(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => tab.requests.some(request => request.action === "ack") && !tab.queue.dispatching, "bounded native-clear wait finishes");
    expect(native.sent).toEqual(["ACK_WITHOUT_NATIVE_CLEAR"]);
    expect(tab.composer.textContent).toBe("ACK_WITHOUT_NATIVE_CLEAR");
    expect((await persisted()).drafts?.map(entry => entry.text)).toEqual(["Recover this unfinished draft"]);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueDraftRestore).toBe("native-text-retained");
  });

  test("acknowledged queue send restores its draft after a temporary readiness drop clears", async () => {
    const tab = await createTab();
    await enqueue(tab, "ACK_BEFORE_READY_AGAIN");
    draft(tab, "Draft retained through native loading transition"); tab.composer.focus();
    const native = simulateNativeChat(tab);
    const main = tab.doc.querySelector("main")!;
    tab.action.addEventListener("click", () => { main.setAttribute("aria-busy", "true"); });
    busy(tab, false); now += 4000;
    await waitFor(() => tab.requests.some(request => request.action === "ack"), "queue acknowledgement while same route is temporarily loading");
    await new Promise(resolve => setTimeout(resolve, 40));
    main.removeAttribute("aria-busy");
    await waitFor(() => !tab.queue.dispatching && tab.composer.textContent === "Draft retained through native loading transition", "draft restored after native loading transition", 700);
    expect(native.sent).toEqual(["ACK_BEFORE_READY_AGAIN"]);
    expect((await persisted()).drafts).toEqual([]);
  });

  test.each(["data-is-streaming", "aria-busy"] as const)("acknowledged queue send restores its draft while its confirmed response has %s", async marker => {
    const tab = await createTab();
    await enqueue(tab, "ACK_STARTED_NATIVE_STREAM");
    draft(tab, "Keep typing while the sent message generates"); tab.composer.focus();
    const native = simulateNativeChat(tab);
    tab.action.addEventListener("click", () => {
      const assistant = tab.doc.querySelector("main")!.lastElementChild!;
      const marked = marker === "aria-busy" ? assistant.querySelector('[data-markdown-text-style="assistant-message"]')! : assistant;
      marked.setAttribute(marker, "true");
    });
    busy(tab, false); now += 4000;
    await waitFor(() => tab.requests.some(request => request.action === "ack"), "queue acknowledgement after native streaming marker appears");
    await waitFor(() => !tab.queue.dispatching && tab.composer.textContent === "Keep typing while the sent message generates", "draft restored during confirmed native generation", 700);
    expect(native.sent).toEqual(["ACK_STARTED_NATIVE_STREAM"]);
    expect(tab.doc.querySelector(`[${marker}="true"]`)).not.toBeNull();
    expect((await persisted()).drafts).toEqual([]);
  });

  test("acknowledged queue send keeps a recovery copy without writing into an unproven remounted editor", async () => {
    const tab = await createTab();
    await enqueue(tab, "ACK_WITH_COMPOSER_REMOUNT");
    draft(tab, "Draft retained through native composer remount"); tab.composer.focus();
    const native = simulateNativeChat(tab);
    const original = tab.composer;
    tab.action.addEventListener("click", () => {
      const replacement = tab.composer.cloneNode(false) as HTMLElement;
      tab.composer.replaceWith(replacement); tab.composer = replacement;
    });
    busy(tab, false); now += 4000;
    await waitFor(() => tab.requests.some(request => request.action === "ack"), "queue acknowledgement after empty native editor remount");
    expect(original.isConnected).toBe(false);
    await waitFor(() => !tab.queue.dispatching, "remount retains recovery without rebinding composer");
    expect(native.sent).toEqual(["ACK_WITH_COMPOSER_REMOUNT"]);
    expect(tab.composer.textContent).toBe("");
    expect((await persisted()).drafts?.map(entry => entry.text)).toEqual(["Draft retained through native composer remount"]);
    expect(tab.shadow.querySelector<HTMLTextAreaElement>('[aria-label="Saved unsent draft"]')?.value).toBe("Draft retained through native composer remount");
  });

  test.each(["identity mismatch", "route change", "loading spinner", "missing acknowledged turn", "new attachment", "new native draft"] as const)("acknowledged queue send preserves recovery through %s instead of restoring blindly", async changed => {
    const tab = await createTab();
    await enqueue(tab, "ACK_RESTORE_MUST_STAY_GUARDED");
    draft(tab, "Protected draft stays recoverable"); tab.composer.focus();
    const native = simulateNativeChat(tab);
    tab.after = request => {
      if (request.action !== "ack") return;
      const main = tab.doc.querySelector("main")!;
      if (changed === "identity mismatch") main.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      if (changed === "route change") {
        tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        main.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      }
      if (changed === "loading spinner") main.insertAdjacentHTML("afterbegin", '<div data-testid="conversation-loading-spinner">Loading another transcript</div>');
      if (changed === "missing acknowledged turn") {
        for (const entry of Array.from(main.querySelectorAll("[data-chatgpt-search-message-ids]"))) {
          if (entry.getAttribute("data-chatgpt-search-message-ids") === request.userMessageId) entry.remove();
        }
      }
      if (changed === "new attachment") tab.composer.closest("[data-composer-body]")!.insertAdjacentHTML("beforeend", '<div data-file-id="after-ack-file">Preserve file</div>');
      if (changed === "new native draft") draft(tab, "New native text after confirmed send");
    };
    busy(tab, false); now += 4000;
    await waitFor(() => tab.requests.some(request => request.action === "ack") && !tab.queue.dispatching, "guarded post-ACK restoration settles");
    expect(native.sent).toEqual(["ACK_RESTORE_MUST_STAY_GUARDED"]);
    expect(tab.composer.textContent).toBe(changed === "new native draft" ? "New native text after confirmed send" : "");
    expect((await persisted()).drafts?.map(entry => entry.text)).toEqual(["Protected draft stays recoverable"]);
    if (changed === "new attachment") expect(tab.doc.querySelector('[data-file-id="after-ack-file"]')?.textContent).toBe("Preserve file");
  });

  test.each(["existing draft", "empty focused input"] as const)("draft preservation retains typing during attempt IPC with %s", async initial => {
    const tab = await createTab();
    await enqueue(tab, "Native queued payload");
    draft(tab, initial === "existing draft" ? "Original unsent draft" : ""); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempted = false;
    tab.after = request => { if (request.action === "attempt") { attempted = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "draft buffer while attempt response is pending");
    const text = "  continued typing\n\nwith whitespace  ";
    const buffer = typeInBuffer(tab, text);
    buffer.setSelectionRange(3, 15, "backward");
    expect(tab.composer.textContent).toBe("Native queued payload");
    expect(native.sent).toEqual([]);
    await waitFor(() => tab.requests.some(request => request.action === "draft-save" && request.text === text), "new typing journal request");
    release();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "queued payload acknowledged with latest draft restored");
    expect(native.sent).toEqual(["Native queued payload"]);
    expect(tab.composer.textContent).toBe(text);
    expect([tab.dom.getSelection()!.anchorOffset, tab.dom.getSelection()!.focusOffset]).toEqual([15, 3]);
    expect(tab.doc.activeElement).toBe(tab.composer);
    expect(draftBuffer(tab)).toBeNull();
    expect((await persisted()).drafts).toEqual([]);
  });

  test("draft preservation retains edits made while the first backup commit is pending", async () => {
    const tab = await createTab();
    await enqueue(tab, "Queue waits for a durable backup");
    draft(tab, "Before the backup"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let pending = false;
    tab.before = request => { if (request.action === "draft-save" && !pending) { pending = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => pending && Boolean(draftBuffer(tab)), "initial backup pending");
    typeInBuffer(tab, "Typed while storage was saving");
    expect(tab.composer.textContent).toBe("Before the backup");
    expect(native.sent).toEqual([]);
    release();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "send following backup");
    expect(tab.composer.textContent).toBe("Typed while storage was saving");
    expect(native.sent).toEqual(["Queue waits for a durable backup"]);
    expect((await persisted()).drafts).toEqual([]);
  });

  test("draft preservation Enter durably queues its snapshot without clearing later typing", async () => {
    const tab = await createTab();
    const first = await enqueue(tab, "Already queued before typing");
    draft(tab, "Draft to enqueue"); tab.composer.focus();
    let releaseAttempt!: () => void, releaseEnqueue!: () => void;
    const attemptGate = new Promise<void>(resolve => { releaseAttempt = resolve; });
    const enqueueGate = new Promise<void>(resolve => { releaseEnqueue = resolve; });
    let attempted = false, savingDraft = false;
    tab.after = request => {
      if (request.action === "attempt") { attempted = true; return attemptGate; }
      if (request.action === "enqueue") { savingDraft = true; return enqueueGate; }
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "borrowed composer before buffer Enter");
    expect(enterBuffer(tab)).toBe(false);
    await waitFor(() => savingDraft, "buffer enqueue committed before delayed response");
    typeInBuffer(tab, "Newer draft typed while enqueue was saving");
    expect(enterBuffer(tab)).toBe(false); // An in-flight submit cannot duplicate its first snapshot.
    releaseEnqueue();
    await waitFor(() => tab.queue.state?.items.length === 2, "buffer enqueue response applied");
    expect(draftBuffer(tab)?.value).toBe("Newer draft typed while enqueue was saving");
    releaseAttempt();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "first queued send with concurrent draft submit");
    expect(native.sent).toEqual(["Already queued before typing"]);
    expect(tab.composer.textContent).toBe("Newer draft typed while enqueue was saving");
    const state = await persisted();
    expect(state.items.map(item => [item.text, item.status])).toEqual([
      ["Already queued before typing", "waiting"], ["Draft to enqueue", "queued"],
    ]);
    expect(state.items[0]?.id).toBe(first);
    expect(tab.requests.filter(request => request.action === "enqueue" && request.text === "Draft to enqueue")).toHaveLength(1);
    expect(state.drafts).toEqual([]);
  });

  test("draft preservation and delayed Pro replay send only the queued payload exactly once", async () => {
    const tab = await createTab();
    wrapComposerInForm(tab);
    await enqueue(tab, "Pro should receive this queued payload");
    draft(tab, "Keep editing my next thought"); tab.composer.focus();
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => gate.canceled.length === 1 && Boolean(draftBuffer(tab)), "Pro canceled the original queued click");
    typeInBuffer(tab, "My next thought continued while Pro waits");
    expect(native.sent).toEqual([]);
    expect(tab.composer.textContent).toBe("Pro should receive this queued payload");
    gate.replay(); gate.replay();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "Pro replay and draft restoration");
    gate.replay();
    expect(native.sent).toEqual(["Pro should receive this queued payload"]);
    expect(tab.composer.textContent).toBe("My next thought continued while Pro waits");
    expect((await persisted()).drafts).toEqual([]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test("draft preservation retries a lost buffer enqueue response with the same ID", async () => {
    const tab = await createTab();
    await enqueue(tab, "First queued send");
    draft(tab, "Queue this buffer draft once"); tab.composer.focus();
    let releaseAttempt!: () => void;
    const gate = new Promise<void>(resolve => { releaseAttempt = resolve; });
    let attempted = false, enqueueReplies = 0;
    tab.after = request => {
      if (request.action === "attempt") { attempted = true; return gate; }
      if (request.action === "enqueue" && ++enqueueReplies === 1) throw new Error("Lost buffer enqueue response after commit");
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    try {
      await waitFor(() => attempted && Boolean(draftBuffer(tab)), "buffer while first send awaits IPC");
      enterBuffer(tab);
      await waitFor(() => tab.shadow.textContent?.includes("Lost buffer enqueue response") === true, "uncertain buffer enqueue warning");
      expect(draftBuffer(tab)?.value).toBe("Queue this buffer draft once");
      enterBuffer(tab);
      await waitFor(() => enqueueReplies === 2 && draftBuffer(tab)?.value === "", "successful idempotent buffer retry");
      const saves = tab.requests.filter(request => request.action === "enqueue" && request.text === "Queue this buffer draft once");
      expect(saves).toHaveLength(2);
      expect(saves[1]?.id).toBe(saves[0]?.id);
      expect((await persisted()).items.filter(item => item.text === "Queue this buffer draft once")).toHaveLength(1);
    } finally { releaseAttempt(); }
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "first send finishes after buffer retry");
  });

  test("draft preservation does not restore an already queued buffer while its enqueue reply is delayed", async () => {
    const tab = await createTab();
    await enqueue(tab, "First queued send");
    draft(tab, "Submit the buffer before native restoration"); tab.composer.focus();
    let releaseAttempt!: () => void, releaseEnqueue!: () => void;
    const attemptGate = new Promise<void>(resolve => { releaseAttempt = resolve; });
    const enqueueGate = new Promise<void>(resolve => { releaseEnqueue = resolve; });
    let attempted = false, savingDraft = false;
    tab.after = request => {
      if (request.action === "attempt") { attempted = true; return attemptGate; }
      if (request.action === "enqueue") { savingDraft = true; return enqueueGate; }
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "pending attempt before buffer submission");
    enterBuffer(tab);
    await waitFor(() => savingDraft, "buffer enqueue committed before its response");
    releaseAttempt();
    await waitFor(() => native.sent.length === 1 && tab.requests.some(request => request.action === "ack"), "native send consumes queue payload before buffer response");
    // Finish native acknowledgement and any attempted restoration before the
    // other IPC response. The draft submit still owns its editor snapshot.
    await new Promise(resolve => setTimeout(resolve, 30));
    releaseEnqueue();
    await waitFor(() => !tab.queue.dispatching && draftBuffer(tab) === null, "both operations settled");
    expect(native.sent).toEqual(["First queued send"]);
    expect(tab.composer.textContent).toBe("");
    expect((await persisted()).items.filter(item => item.text === "Submit the buffer before native restoration")).toHaveLength(1);
    expect((await persisted()).drafts).toEqual([]);
  });

  test("draft preservation redirects trusted native typing while a delayed replay is armed", async () => {
    const tab = await createTab();
    await enqueue(tab, "Authorized queued payload");
    draft(tab, "Draft"); tab.composer.focus();
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => gate.canceled.length === 1 && Boolean(draftBuffer(tab)), "Pro replay armed");
    draftBuffer(tab)!.setSelectionRange(5, 5);
    const input = new tab.dom.InputEvent("beforeinput", { inputType: "insertText", data: "!", bubbles: true, cancelable: true });
    Object.defineProperty(input, "isTrusted", { value: true });
    expect(tab.composer.dispatchEvent(input as unknown as Event)).toBe(false);
    expect(draftBuffer(tab)?.value).toBe("Draft!");
    expect(tab.composer.textContent).toBe("Authorized queued payload");
    gate.replay();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "authorized replay after redirected native typing");
    expect(native.sent).toEqual(["Authorized queued payload"]);
    expect(tab.composer.textContent).toBe("Draft!");
  });

  test("draft preservation trusted native click queues the buffer without revoking an armed Pro replay", async () => {
    const tab = await createTab();
    wrapComposerInForm(tab);
    await enqueue(tab, "Original payload authorized for Pro replay");
    draft(tab, "Buffer draft submitted with native Send"); tab.composer.focus();
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => gate.canceled.length === 1 && Boolean(draftBuffer(tab)), "Pro replay pending before trusted native click");
    const click = new tab.dom.MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(click, "isTrusted", { value: true });
    expect(tab.action.dispatchEvent(click as unknown as Event)).toBe(false);
    await waitFor(() => draftBuffer(tab)?.value === "", "trusted Send enqueues buffered draft");
    expect(gate.canceled).toHaveLength(1);
    expect(native.sent).toEqual([]);
    expect(tab.composer.textContent).toBe("Original payload authorized for Pro replay");
    expect((await persisted()).items.filter(item => item.text === "Buffer draft submitted with native Send")).toHaveLength(1);
    gate.replay();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "original replay remains authorized after draft submission");
    expect(native.sent).toEqual(["Original payload authorized for Pro replay"]);
    expect(tab.composer.textContent).toBe("");
    expect((await persisted()).items.map(item => [item.text, item.status])).toEqual([
      ["Original payload authorized for Pro replay", "waiting"], ["Buffer draft submitted with native Send", "queued"],
    ]);
  });

  test("draft preservation native Enter works after restoration while journal cleanup is still pending", async () => {
    const tab = await createTab();
    await enqueue(tab, "Queue payload before journal cleanup");
    draft(tab, "Submit the restored draft during cleanup"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let removePending = false;
    tab.before = request => { if (request.action === "draft-remove") { removePending = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    try {
      await waitFor(() => removePending && draftBuffer(tab) === null, "native restored before journal cleanup response");
      expect(tab.queue.dispatching).toBe(true);
      expect(tab.composer.textContent).toBe("Submit the restored draft during cleanup");
      expect(enter(tab)).toBe(false);
      await waitFor(() => !tab.queue.saving && tab.composer.textContent === "", "restored native Enter enqueues while cleanup waits");
      expect((await persisted()).items.filter(item => item.text === "Submit the restored draft during cleanup")).toHaveLength(1);
    } finally { release(); }
    await waitFor(() => !tab.queue.dispatching, "journal cleanup finishes");
    expect(native.sent).toEqual(["Queue payload before journal cleanup"]);
    expect(tab.composer.textContent).toBe("");
    expect((await persisted()).drafts).toEqual([]);
  });

  test("draft preservation carries an uncertain buffer enqueue ID into the restored native input", async () => {
    const tab = await createTab();
    await enqueue(tab, "First queued send");
    draft(tab, "Buffer enqueue must remain idempotent after restoration"); tab.composer.focus();
    let releaseAttempt!: () => void;
    const gate = new Promise<void>(resolve => { releaseAttempt = resolve; });
    let attempted = false, replies = 0;
    tab.after = request => {
      if (request.action === "attempt") { attempted = true; return gate; }
      if (request.action === "enqueue" && ++replies === 1) throw new Error("Buffer enqueue response lost");
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "buffer before lost enqueue response");
    enterBuffer(tab);
    await waitFor(() => tab.shadow.textContent?.includes("Buffer enqueue response lost") === true, "lost response warning");
    releaseAttempt();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "failed buffer submit restored to native");
    expect(tab.composer.textContent).toBe("Buffer enqueue must remain idempotent after restoration");
    enter(tab);
    await waitFor(() => !tab.queue.saving, "native retry of buffer submit");
    const saves = tab.requests.filter(request => request.action === "enqueue" && request.text === "Buffer enqueue must remain idempotent after restoration");
    expect(saves).toHaveLength(2);
    expect(saves[1]?.id).toBe(saves[0]?.id);
    expect((await persisted()).items.filter(item => item.text === "Buffer enqueue must remain idempotent after restoration")).toHaveLength(1);
  });

  test("draft preservation waits for a buffer Enter that begins during final backup persistence", async () => {
    const tab = await createTab();
    await enqueue(tab, "Queue send finishes before late draft Enter");
    draft(tab, "Late Enter should enqueue and clear this snapshot"); tab.composer.focus();
    let releaseFinalSave!: () => void, releaseEnqueue!: () => void;
    const finalSaveGate = new Promise<void>(resolve => { releaseFinalSave = resolve; });
    const enqueueGate = new Promise<void>(resolve => { releaseEnqueue = resolve; });
    let acknowledged = false, finalSavePending = false, enqueuePending = false;
    tab.after = request => {
      if (request.action === "ack") acknowledged = true;
      if (request.action === "draft-save" && acknowledged && !finalSavePending) { finalSavePending = true; return finalSaveGate; }
      if (request.action === "enqueue") { enqueuePending = true; return enqueueGate; }
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => finalSavePending && Boolean(draftBuffer(tab)), "final backup reply pending");
    enterBuffer(tab);
    await waitFor(() => enqueuePending, "late buffer Enter is durable with response pending");
    releaseFinalSave();
    await new Promise(resolve => setTimeout(resolve, 30));
    releaseEnqueue();
    await waitFor(() => !tab.queue.dispatching && draftBuffer(tab) === null, "late Enter and restoration settle");
    expect(native.sent).toEqual(["Queue send finishes before late draft Enter"]);
    expect(tab.composer.textContent).toBe("");
    expect((await persisted()).items.filter(item => item.text === "Late Enter should enqueue and clear this snapshot")).toHaveLength(1);
    expect((await persisted()).drafts).toEqual([]);
  });

  test("draft preservation drains late typing backups before retiring a restored journal entry", async () => {
    const tab = await createTab();
    await enqueue(tab, "Queue send before late typing");
    draft(tab, "Snapshot before final backup"); tab.composer.focus();
    let releaseFinalSave!: () => void, releaseLatestSave!: () => void;
    const finalSaveGate = new Promise<void>(resolve => { releaseFinalSave = resolve; });
    const latestSaveGate = new Promise<void>(resolve => { releaseLatestSave = resolve; });
    let acknowledged = false, finalSavePending = false, latestSavePending = false;
    const latest = "Typing after the final backup snapshot";
    tab.before = request => {
      if (request.action === "draft-save" && request.text === latest && !latestSavePending) { latestSavePending = true; return latestSaveGate; }
    };
    tab.after = request => {
      if (request.action === "ack") acknowledged = true;
      if (request.action === "draft-save" && acknowledged && !finalSavePending) { finalSavePending = true; return finalSaveGate; }
    };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => finalSavePending && Boolean(draftBuffer(tab)), "final backup before late typing");
    typeInBuffer(tab, latest);
    releaseFinalSave();
    await waitFor(() => latestSavePending, "newer journal revision is pending");
    await new Promise(resolve => setTimeout(resolve, 30));
    releaseLatestSave();
    await waitFor(() => !tab.queue.dispatching && draftBuffer(tab) === null, "restoration and final journal commit settle");
    await poll(tab);
    expect(native.sent).toEqual(["Queue send before late typing"]);
    expect(tab.composer.textContent).toBe(latest);
    expect((await persisted()).drafts).toEqual([]);
    expect(tab.shadow.querySelector('[aria-label="Saved unsent draft"]')).toBeNull();
  });

  test("draft preservation backup failure never writes or sends native queued text", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Keep this queue message saved");
    draft(tab, "Original user draft"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let backupRequested = false;
    tab.before = async request => {
      if (request.action !== "draft-save") return;
      backupRequested = true; await gate; throw new Error("Draft backup disk failure");
    };
    const native = simulateNativeChat(tab);
    const nativeWrites: string[] = [];
    tab.composer.addEventListener("input", () => { nativeWrites.push(tab.composer.textContent ?? ""); });
    busy(tab, false); now += 4000;
    await waitFor(() => backupRequested && Boolean(draftBuffer(tab)), "failing draft backup wait");
    typeInBuffer(tab, "More typing while backup fails");
    release();
    await waitFor(() => !tab.queue.dispatching, "failed backup releases queued claim");
    expect(native.sent).toEqual([]);
    expect(nativeWrites).not.toContain("Keep this queue message saved");
    expect(tab.composer.textContent).toBe("More typing while backup fails");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("queued");
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
  });

  test.each(["route", "native edit", "composer replacement", "attachment"] as const)("draft preservation never overwrites %s during a pending attempt", async change => {
    const tab = await createTab();
    const id = await enqueue(tab, "Queue text must not leak elsewhere");
    draft(tab, "Protected original draft"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempted = false;
    tab.after = request => { if (request.action === "attempt") { attempted = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "attempt before outside mutation");
    typeInBuffer(tab, "Latest saved recovery text");
    if (change === "route") {
      tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      draft(tab, "Draft belonging to another conversation");
    } else if (change === "native edit") draft(tab, "Unexpected native input must survive");
    else if (change === "composer replacement") {
      const replacement = tab.composer.cloneNode(false) as HTMLElement;
      replacement.textContent = "Replacement editor draft";
      tab.composer.replaceWith(replacement); tab.composer = replacement;
    } else tab.composer.closest("[data-composer-body]")!.insertAdjacentHTML("beforeend", '<div data-file-id="new-file">Preserve attachment</div>');
    const protectedNative = tab.composer.textContent;
    release();
    await waitFor(() => !tab.queue.dispatching, "interrupted draft-preserving attempt");
    expect(native.sent).toEqual([]);
    expect(tab.composer.textContent).toBe(protectedNative);
    expect(draftBuffer(tab)).toBeNull();
    const saved = await persisted();
    expect(saved.items.find(item => item.id === id)?.status).toBe("review");
    expect(saved.drafts?.map(entry => entry.text)).toEqual(["Latest saved recovery text"]);
    if (change === "attachment") expect(tab.doc.querySelector('[data-file-id="new-file"]')?.textContent).toBe("Preserve attachment");
  });

  test("draft preservation leaves an unconfirmed queued payload and a separate recoverable user draft", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Unconfirmed native queued payload");
    draft(tab, "Unsent original user draft"); tab.composer.focus();
    const gate = delayedSendInterceptor(tab);
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => gate.canceled.length === 1 && Boolean(draftBuffer(tab)), "unconfirmed queued send with protected draft");
    typeInBuffer(tab, "Latest unsent user draft");
    Object.defineProperty(tab.dom, "Date", { value: class extends Date {
      static override now(): number { return Date.now() + 20_000; }
    }, configurable: true });
    gate.replay();
    await waitFor(() => !tab.queue.dispatching, "expired send retains draft recovery", 700);
    expect(native.sent).toEqual([]);
    expect(tab.composer.textContent).toBe("Unconfirmed native queued payload");
    const saved = await persisted();
    expect(saved.items.find(item => item.id === id)?.status).toBe("review");
    expect(saved.drafts?.map(entry => entry.text)).toEqual(["Latest unsent user draft"]);
    expect(tab.shadow.querySelector<HTMLTextAreaElement>('[aria-label="Saved unsent draft"]')?.value).toBe("Latest unsent user draft");
    gate.replay();
    expect(native.sent).toEqual([]);
  });

  test("draft preservation keeps unsaved latest text visible when navigation prevents further journal writes", async () => {
    const tab = await createTab();
    await enqueue(tab, "Keep the old queue on its own route");
    draft(tab, "Initial durable draft"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempted = false;
    tab.after = request => { if (request.action === "attempt") { attempted = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "draft backed up before navigation");
    tab.before = request => {
      if (request.action === "draft-save" && request.draftRevision! > 1) throw new Error("The worker rejected a draft write after navigation");
    };
    typeInBuffer(tab, "Latest text still only in the visible draft buffer");
    tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    tab.doc.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    draft(tab, "Another conversation's independent draft");
    release();
    await waitFor(() => !tab.queue.dispatching, "interrupted send leaves recovery visible");
    expect(native.sent).toEqual([]);
    expect(tab.composer.textContent).toBe("Another conversation's independent draft");
    const buffer = draftBuffer(tab);
    expect(buffer?.value).toBe("Latest text still only in the visible draft buffer");
    expect(buffer?.isConnected).toBe(true);
    expect(buffer?.getAttribute("aria-label")).toContain("unsent draft");
    expect((await persisted()).drafts?.map(entry => entry.text)).toEqual(["Initial durable draft"]);
    const recoveryHost = buffer!.getRootNode() as ShadowRoot;
    expect(recoveryHost.querySelector('[role="status"]')?.textContent).toContain("could not be saved or restored");
    const input = new tab.dom.InputEvent("beforeinput", { inputType: "insertText", data: " continued", bubbles: true, cancelable: true });
    Object.defineProperty(input, "isTrusted", { value: true });
    expect(tab.composer.dispatchEvent(input as unknown as Event)).toBe(true);
    draft(tab, "Another conversation's independent draft continued");
    expect(tab.composer.textContent).toBe("Another conversation's independent draft continued");
    expect(buffer?.value).toBe("Latest text still only in the visible draft buffer");
  });

  test("draft preservation keeps both tab drafts while only one tab wins the queued send", async () => {
    const first = await createTab();
    await enqueue(first, "Send exactly once across typing tabs");
    const second = await createTab({ visibility: "hidden" });
    draft(first, "First tab's own draft"); draft(second, "Second tab's own draft");
    const firstNative = simulateNativeChat(first), secondNative = simulateNativeChat(second);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const contenders = new Set<Tab>();
    for (const tab of [first, second]) tab.before = request => {
      if (request.action === "claim") { contenders.add(tab); return gate; }
    };
    busy(first, false); busy(second, false); now += 4000;
    await waitFor(() => contenders.size === 2, "both typing tabs attempt claim");
    release();
    await waitFor(() => firstNative.sent.length + secondNative.sent.length === 1 && !first.queue.dispatching && !second.queue.dispatching, "one cross-tab send completes");
    expect([...firstNative.sent, ...secondNative.sent]).toEqual(["Send exactly once across typing tabs"]);
    expect(first.composer.textContent).toBe("First tab's own draft");
    expect(second.composer.textContent).toBe("Second tab's own draft");
    expect((await persisted()).drafts).toEqual([]);
  });

  test("draft preservation waits for native IME composition to finish before borrowing the composer", async () => {
    const tab = await createTab();
    await enqueue(tab, "Send after IME commits");
    draft(tab, "入力中"); tab.composer.focus();
    tab.composer.dispatchEvent(new tab.dom.CompositionEvent("compositionstart", { bubbles: true, composed: true }) as unknown as Event);
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect(tab.composer.textContent).toBe("入力中");
    expect(draftBuffer(tab)).toBeNull();
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("composing");
    draft(tab, "入力完了");
    tab.composer.dispatchEvent(new tab.dom.CompositionEvent("compositionend", { bubbles: true, composed: true }) as unknown as Event);
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "native composition complete");
    expect(native.sent).toEqual(["Send after IME commits"]);
    expect(tab.composer.textContent).toBe("入力完了");
  });

  test("draft preservation keeps an active buffer IME attached until its composition commits", async () => {
    const tab = await createTab();
    await enqueue(tab, "Send while the next draft is composing");
    draft(tab, "Draft"); tab.composer.focus();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let attempted = false;
    tab.after = request => { if (request.action === "attempt") { attempted = true; return gate; } };
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await waitFor(() => attempted && Boolean(draftBuffer(tab)), "buffer before composition");
    const buffer = draftBuffer(tab)!;
    buffer.dispatchEvent(new tab.dom.CompositionEvent("compositionstart", { bubbles: true, composed: true }) as unknown as Event);
    typeInBuffer(tab, "編集中");
    release();
    await waitFor(() => native.sent.length === 1 && tab.requests.some(request => request.action === "ack"), "queued send acknowledged during IME");
    expect(buffer.isConnected).toBe(true);
    expect(tab.queue.dispatching).toBe(true);
    typeInBuffer(tab, "編集完了");
    buffer.dispatchEvent(new tab.dom.CompositionEvent("compositionend", { bubbles: true, composed: true }) as unknown as Event);
    await waitFor(() => !tab.queue.dispatching, "restore after buffer IME ends");
    expect(tab.composer.textContent).toBe("編集完了");
    expect(native.sent).toEqual(["Send while the next draft is composing"]);
  });

  test.each(["<strong>Keep bold formatting</strong>", '<span data-mention-id="person">Keep mention</span>', '<p style="color:red">Keep styled paragraph</p>'])("draft preservation leaves unsupported rich content untouched: %s", async markup => {
    const tab = await createTab();
    await enqueue(tab, "Wait for structured draft");
    tab.composer.innerHTML = markup; tab.composer.focus();
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect(tab.composer.innerHTML).toBe(markup);
    expect(draftBuffer(tab)).toBeNull();
    expect(tab.requests.filter(request => request.action === "draft-save" || request.action === "attempt")).toHaveLength(0);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueState).toBe("draft");
  });

  test("draft preservation supports plain paragraphs and preserves a background focus target", async () => {
    const tab = await createTab({ visibility: "hidden" });
    await enqueue(tab, "Background queued text");
    tab.composer.innerHTML = "<p>first line</p><p>second<br>third</p>";
    const other = tab.doc.createElement("input"); tab.doc.body.append(other); other.focus();
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Background queued text"]);
    expect(tab.composer.textContent).toBe("first line\nsecond\nthird");
    expect(tab.doc.activeElement).toBe(other);
  });

  test("a persistently failing composer fill stays queued without spinning on change broadcasts", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Keep saved if the editor rejects insertion");
    const native = simulateNativeChat(tab);
    const clock = { now: Date.now() };
    Object.assign(tab.dom, { Date: class extends Date { static override now() { return clock.now; } } });
    let fillAttempts = 0;
    Object.defineProperty(tab.doc, "execCommand", { value: () => { fillAttempts++; return true; }, configurable: true });
    busy(tab, false);
    await waitFor(() => tab.requests.some(request => request.action === "release" && request.id === id) &&
      !tab.queue.dispatching && !tab.queue.polling, "failed fill completes and releases its claim");
    // A heartbeat can still report busy while the DOM becomes idle, causing a
    // harmless rejected claim before the successful one. Only new claims after
    // the failed fill would indicate that broadcasts bypass its cooldown.
    const claimsAfterFailure = tab.requests.filter(request => request.action === "claim").length;
    expect(fillAttempts).toBe(1);
    tab.listener?.({ type: "plannotator:queue:changed", key });
    tab.composer.dispatchEvent(new tab.dom.InputEvent("input", { bubbles: true, composed: true }) as unknown as InputEvent);
    await poll(tab);
    clock.now += 999;
    await poll(tab);
    expect(tab.requests.filter(request => request.action === "claim")).toHaveLength(claimsAfterFailure);
    expect(fillAttempts).toBe(1);
    expect(tab.requests.filter(request => request.action === "release" && request.id === id)).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("queued");
    expect(tab.composer.innerText).toBe("");
    expect(native.sent).toEqual([]);
    // Recovery remains enabled after the full cooldown; the saved item is
    // retried once without creating a second item or attempting a native send.
    clock.now += 1;
    await poll(tab);
    expect(fillAttempts).toBe(2);
    expect(tab.requests.filter(request => request.action === "claim")).toHaveLength(claimsAfterFailure + 1);
    expect(tab.requests.filter(request => request.action === "release" && request.id === id)).toHaveLength(2);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "queued"]]);
    expect(native.sent).toEqual([]);
  });

  test("a stale tab cannot send the next item before seeing the prior completed reply", async () => {
    const apply = (action: QueueRequest["action"], extra: Partial<QueueRequest> = {}) => store.apply({
      type: QUEUE_MESSAGE_TYPE, key, clientId: "other-tab", action, ...extra,
    }, "other-tab", now);
    await apply("enqueue", { id: "already-sent", text: "Already completed elsewhere" });
    await apply("claim");
    await apply("attempt", { id: "already-sent" });
    await apply("ack", { id: "already-sent", userMessageId: "44444444-4444-4444-8444-444444444444" });
    await apply("enqueue", { id: "next-message", text: "Wait for current transcript" });
    await apply("complete", { id: "already-sent", userMessageId: "44444444-4444-4444-8444-444444444444" });
    const stale = await createTab();
    busy(stale, false); now += 4000;
    let sends = 0;
    stale.action.addEventListener("click", () => { sends++; });
    await poll(stale);
    expect(sends).toBe(0);
    expect((await persisted()).items[0]?.status).toBe("queued");
    expect(stale.composer.innerText).toBe("");
  });

  test("the first queued item waits for its initial busy turn even in a stale idle tab", async () => {
    const active = await createTab();
    const stale = await createTab();
    const activeUserId = "99999999-9999-4999-8999-999999999999";
    active.doc.querySelector("main")!.insertAdjacentHTML("beforeend", `
      <article data-chatgpt-search-unit-key="${activeUserId}:user" data-chatgpt-search-message-ids="${activeUserId}">
        <div data-user-message-bubble="true">New request missing from the other tab</div>
      </article>
      <article><div data-markdown-text-style="assistant-message">Response still running</div></article>`);
    await enqueue(active, "Follow the active response");
    expect((await persisted()).lastCompletedUserMessageId).toBe(activeUserId);
    await waitFor(() => !stale.queue.polling, "stale tab idle");
    busy(stale, false); now += 4000;
    let sends = 0;
    stale.action.addEventListener("click", () => { sends++; });
    await poll(stale);
    expect(sends).toBe(0);
    expect((await persisted()).items[0]?.status).toBe("queued");
    expect(stale.composer.innerText).toBe("");
  });

  test("another tab's busy lease blocks sending without a rapid claim retry loop", async () => {
    const active = await createTab();
    const idle = await createTab({ idle: true });
    const native = simulateNativeChat(idle);
    await enqueue(active, "Wait for the active tab");
    await waitFor(() => idle.requests.some(request => request.action === "claim"), "idle tab checks the shared busy lease");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(idle.requests.filter(request => request.action === "claim").length).toBeLessThanOrEqual(2);
    expect(native.sent).toEqual([]);
    expect((await persisted()).items[0]?.status).toBe("queued");
  });

  test("acknowledged delivery is not sent twice and completes only after its reply", async () => {
    const tab = await createTab();
    const first = await enqueue(tab, "Only send once");
    const second = await enqueue(tab, "Wait for the first reply");
    const native = simulateNativeChat(tab);
    busy(tab, false); now += 4000;
    await poll(tab);
    expect(native.sent).toEqual(["Only send once"]);
    expect((await persisted()).items[0]?.status).toBe("waiting");
    expect((await persisted()).items[0]?.userMessageId).toBeDefined();
    expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    expect(Array.from(tab.shadow.querySelectorAll<HTMLElement>("li[data-id]")).map(row => row.dataset.id)).toEqual([second]);
    expect(tab.shadow.querySelector(".count")?.textContent).toBe("1");
    expect(tab.shadow.querySelector("li .num")?.textContent).toBe("1");

    const reopened = await createTab({ idle: true });
    expect(reopened.queue.state?.items.find(item => item.id === first)?.status).toBe("waiting");
    expect(Array.from(reopened.shadow.querySelectorAll<HTMLElement>("li[data-id]")).map(row => row.dataset.id)).toEqual([second]);
    expect(reopened.shadow.querySelector(".count")?.textContent).toBe("1");
    expect(reopened.shadow.querySelector("li .num")?.textContent).toBe("1");
    await poll(tab);
    expect(native.sent).toEqual(["Only send once"]);
    expect((await persisted()).items.find(item => item.id === second)?.status).toBe("queued");
    native.finish(); now += 4000;
    await poll(tab);
    await poll(tab);
    expect(native.sent).toEqual(["Only send once", "Wait for the first reply"]);
    expect((await persisted()).items.some(item => item.id === first)).toBe(false);
    expect((await persisted()).items.find(item => item.id === second)?.status).toBe("waiting");
    expect(tab.doc.getElementById("plannotator-message-queue")!.style.display).toBe("none");
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
    await poll(reopened);
    expect(reopened.doc.getElementById("plannotator-message-queue")!.style.display).toBe("none");
    expect(reopened.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
    native.finish(); now += 4000;
    await poll(tab);
    expect((await persisted()).items).toHaveLength(0);
    expect(native.sent).toEqual(["Only send once", "Wait for the first reply"]);
  });

  test("a posted message is confirmed by its DOM mutation without waiting for the ack polling interval", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Prompt whose bubble appears asynchronously");
    let clicked = false;
    tab.action.addEventListener("click", () => { clicked = true; draft(tab, ""); busy(tab, true); });
    busy(tab, false);
    await waitFor(() => clicked, "native click before its user bubble");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("sending");
    expect(tab.shadow.textContent).toContain("Confirming send");
    const postedAt = Date.now();
    tab.doc.querySelector("main")!.insertAdjacentHTML("beforeend", `
      <article data-chatgpt-search-unit-key="22222222-3333-4444-8555-666666666666:user" data-chatgpt-search-message-ids="22222222-3333-4444-8555-666666666666">
        <div data-user-message-bubble="true">Prompt whose bubble appears asynchronously</div>
      </article>`);
    await waitFor(() => tab.queue.state?.items.find(item => item.id === id)?.status === "waiting" && !tab.queue.dispatching, "immediate durable acknowledgement", 200);
    expect(Date.now() - postedAt).toBeLessThan(200);
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test("a lost acknowledgement reply never downgrades confirmed delivery or offers a duplicate retry", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Already delivered despite the lost response");
    const native = simulateNativeChat(tab);
    tab.after = request => { if (request.action === "ack") throw new Error("Simulated lost acknowledgement response"); };
    busy(tab, false);
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "reconciled committed acknowledgement");
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("waiting");
    expect(tab.shadow.querySelector("[data-action='retry']")).toBeNull();
    expect(tab.shadow.querySelector(".error")).toBeNull();
    await poll(tab);
    expect(native.sent).toEqual(["Already delivered despite the lost response"]);
    native.finish();
    await waitFor(() => tab.queue.state?.items.length === 0, "confirmed response retires normally");
  });

  test("draft warnings clear when the native editor finishes clearing, without erasing unrelated errors", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Keep queued");
    draft(tab, "A protected draft");
    button(tab, "steer", id).click();
    await waitFor(() => Boolean(tab.shadow.querySelector(".error")), "draft warning");
    expect(tab.shadow.textContent).toContain("Queue or clear the current draft");
    // Model a native editor committing after the input capture listeners.
    tab.composer.dispatchEvent(new tab.dom.InputEvent("input", { bubbles: true }) as unknown as InputEvent);
    tab.composer.textContent = "";
    await waitFor(() => !tab.shadow.querySelector(".error"), "resolved draft warning");
    expect(tab.shadow.querySelector("[data-action='enqueue']")).toBeNull();
    tab.before = request => { if (request.action === "enqueue") throw new Error("Storage unavailable"); };
    draft(tab, "Keep this failed-save draft"); enter(tab);
    await waitFor(() => !tab.queue.saving, "failed save");
    draft(tab, "");
    await waitFor(() => tab.shadow.textContent?.includes("Storage unavailable") === true, "unrelated error preserved");
  });

  test("a peer completing a confirmed turn before its lost ack reply does not leave a stale send error", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Confirmed and completed before the reply arrived");
    const native = simulateNativeChat(tab);
    tab.after = async request => {
      if (request.action !== "ack") return;
      native.finish();
      await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "peer", action: "complete", id, userMessageId: request.userMessageId }, "peer", now);
      throw new Error("Simulated lost acknowledgement response");
    };
    busy(tab, false);
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "reconcile exact durable completion");
    expect((await persisted()).items).toHaveLength(0);
    expect(tab.shadow.querySelector(".error")).toBeNull();
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(1);
  });

  test.each(["visible", "hidden"] as const)("the current native toolbar drains a %s queue from state-attribute changes alone with polling disabled", async state => {
    const tab = await createTab({ visibility: state });
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    const initialAnswer = currentChatGptResponse(tab.doc, "streaming", "initial-assistant");
    tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant']")!.replaceWith(initialAnswer);
    initialAnswer.prepend(tab.doc.querySelector("article[data-chatgpt-search-message-ids]")!);
    const first = await enqueue(tab, "First follow-up to the native complete turn");
    const second = await enqueue(tab, "Second follow-up after its native response");
    const native = simulateCurrentNativeChat(tab);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    busy(tab, false);
    await waitFor(() => !tab.queue.polling, "native stop has disappeared");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(native.sent).toEqual([]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    const firstCompletedAt = Date.now();
    initialAnswer.setAttribute("data-talvt-turn-state", "complete");
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "first attribute-only native completion", 500);
    expect(Date.now() - firstCompletedAt).toBeLessThan(500);
    expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    expect(Array.from(tab.shadow.querySelectorAll<HTMLElement>("li[data-id]")).map(row => row.dataset.id)).toEqual([second]);
    expect((await persisted()).items.find(item => item.id === first)?.status).toBe("waiting");
    expect(host.dataset.queueConfirmedSends).toBe("1");
    busy(tab, false);
    await waitFor(() => !tab.queue.polling, "second stop has disappeared");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(native.sent).toHaveLength(1);
    const secondCompletedAt = Date.now();
    native.finish();
    await waitFor(() => native.sent.length === 2 && !tab.queue.dispatching, "second attribute-only native completion", 500);
    expect(Date.now() - secondCompletedAt).toBeLessThan(500);
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
    expect(host.dataset.queueConfirmedSends).toBe("2");
    busy(tab, false);
    await waitFor(() => !tab.queue.polling, "final stop has disappeared");
    await new Promise(resolve => setTimeout(resolve, 30));
    native.finish();
    await waitFor(() => tab.queue.state?.items.length === 0, "final attribute-only completion retires the durable anchor", 500);
    expect(native.sent).toEqual(["First follow-up to the native complete turn", "Second follow-up after its native response"]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([first, second]);
    expect(host.dataset.queueLastDispatchVisibility).toBe(state);
    expect(host.dataset.queueCompletionReason).toBe("not-required");
    expect(tab.shadow.querySelector(".error")).toBeNull();
  });

  test.each(["completion-unverified", "anchor-missing", "assistant-missing"] as const)("an idle %s turn preserves queued text, explains its exact guard, and allows checked Send now recovery", async reason => {
    const tab = await createTab();
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    const id = await enqueue(tab, "Saved follow-up that requires a checked recovery");
    const native = simulateNativeChat(tab);
    const initialAnswer = tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant']")!;
    if (reason === "completion-unverified") initialAnswer.querySelector(".turn-action-controls")!.remove();
    else if (reason === "anchor-missing") tab.doc.querySelector("article[data-chatgpt-search-message-ids]")!.remove();
    else initialAnswer.remove();
    busy(tab, false);
    await poll(tab);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueCompletionReason).toBe(reason);
    expect(host.dataset.queueState).toBe("completion-pending");
    expect(tab.shadow.querySelector("li .status")?.textContent).toContain("Your message is saved; check the chat, then use Send now to continue.");
    expect(Object.values(host.dataset).join(" ")).not.toContain("Saved follow-up");
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.map(item => [item.id, item.status, item.text])).toEqual([[id, "queued", "Saved follow-up that requires a checked recovery"]]);
    expect(tab.requests.filter(request => request.action === "claim" || request.action === "attempt")).toHaveLength(0);
    // Refreshing alone never guesses completion or retries delivery.
    await poll(tab);
    expect(native.sent).toEqual([]);
    button(tab, "steer", id).click();
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "explicit checked recovery acknowledged");
    expect(native.sent).toEqual(["Saved follow-up that requires a checked recovery"]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([id]);
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
  });

  test.each(["visible", "hidden"] as const)("an older batch resumes after later native turns complete while %s and drains exactly once", async visibility => {
    const tab = await createTab({ visibility });
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    const initialAnswer = currentChatGptResponse(tab.doc, "complete", "initial-assistant");
    tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant']")!.replaceWith(initialAnswer);
    initialAnswer.prepend(tab.doc.querySelector("article[data-chatgpt-search-message-ids]")!);
    const first = await enqueue(tab, "First saved item after native follow-ups");
    const second = await enqueue(tab, "Second saved item in the same batch");
    const native = simulateCurrentNativeChat(tab);
    for (const state of ["complete", "unknown"]) {
      postUserBubble(tab, `An intervening native request (${state})`);
      const turn = currentChatGptResponse(tab.doc, state);
      turn.prepend(tab.doc.querySelector("main")!.lastElementChild!);
      tab.doc.querySelector("main")!.append(turn);
    }
    busy(tab, false);
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    expect(tab.doc.getElementById("plannotator-message-queue")!.dataset.queueCompletionReason).toBe("completion-unverified");
    tab.doc.querySelector("main")!.lastElementChild!.setAttribute("data-talvt-turn-state", "complete");
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "later native completion releases the older batch", 500);
    expect((await persisted()).lastCompletedUserMessageId).toBe("11111111-1111-4111-8111-111111111111");
    expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    expect(tab.shadow.querySelector(`li[data-id='${second}']`)).not.toBeNull();
    busy(tab, false);
    await poll(tab);
    expect(native.sent).toHaveLength(1);
    native.finish();
    await waitFor(() => native.sent.length === 2 && !tab.queue.dispatching, "next saved item follows its own response", 500);
    busy(tab, false);
    native.finish();
    await waitFor(() => tab.queue.state?.items.length === 0, "older batch fully drained", 500);
    await poll(tab);
    expect(native.sent).toEqual(["First saved item after native follow-ups", "Second saved item in the same batch"]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([first, second]);
  });

  test.each(["stop", "streaming", "older-turn"] as const)("a complete native toolbar cannot release the queue through a conflicting %s guard", async guard => {
    const tab = await createTab({ visibility: "hidden" });
    tab.dom.clearInterval(tab.queue.pollTimer as unknown as ReturnType<typeof tab.dom.setInterval>);
    const initialAnswer = currentChatGptResponse(tab.doc, "complete", "initial-assistant");
    tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant']")!.replaceWith(initialAnswer);
    initialAnswer.prepend(tab.doc.querySelector("article[data-chatgpt-search-message-ids]")!);
    const id = await enqueue(tab, "Hold despite a completed toolbar");
    const native = simulateCurrentNativeChat(tab);
    let later: HTMLElement | null = null;
    if (guard === "streaming") initialAnswer.querySelector("[data-markdown-text-style='assistant-message']")!.setAttribute("data-is-streaming", "true");
    if (guard === "older-turn") {
      postUserBubble(tab, "A more recent native user turn");
      later = currentChatGptResponse(tab.doc, "unknown");
      later.prepend(tab.doc.querySelector("main")!.lastElementChild!);
      tab.doc.querySelector("main")!.append(later);
    }
    if (guard !== "stop") busy(tab, false);
    await poll(tab);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueCompletionReason).toBe(guard === "older-turn" ? "completion-unverified" : "busy");
    expect(native.sent).toEqual([]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "queued"]]);
    if (guard === "older-turn") {
      expect(tab.shadow.querySelector("li .status")?.textContent).toContain("could not be verified");
      await poll(tab);
      expect(native.sent).toEqual([]);
      later!.setAttribute("data-talvt-turn-state", "complete");
      await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "latest turn completion releases the older anchor", 500);
      expect(native.sent).toEqual(["Hold despite a completed toolbar"]);
      expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([id]);
      expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
    } else {
      if (guard === "streaming") initialAnswer.querySelector("[data-is-streaming]")!.removeAttribute("data-is-streaming");
      else busy(tab, false);
      await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "exact completion after the conflict clears", 500);
      expect(native.sent).toEqual(["Hold despite a completed toolbar"]);
      expect(tab.shadow.querySelector(`li[data-id='${id}']`)).toBeNull();
    }
  });

  test("identity and loading holds remain specific before an idle completion recovery", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Keep this attached to the verified conversation");
    tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant'] .turn-action-controls")!.remove();
    const native = simulateNativeChat(tab);
    const main = tab.doc.querySelector("main")!;
    main.setAttribute("data-chatgpt-selection-conversation-id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    busy(tab, false);
    await poll(tab);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueState).toBe("identity-unverified");
    expect(host.dataset.queueCompletionReason).toBe("identity-unverified");
    expect(tab.shadow.querySelector("li .status")?.textContent).toContain("not linked to this saved chat");
    expect(tab.shadow.querySelector("li .status")?.textContent).not.toContain("Send now");
    main.setAttribute("aria-busy", "true");
    await poll(tab);
    expect(host.dataset.queueCompletionReason).toBe("conversation-loading");
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.map(item => [item.id, item.status])).toEqual([[id, "queued"]]);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
  });

  test.each(["before-commit", "lost-reply"] as const)("a completion transport failure %s preserves delivery and a checked recovery drains only the next item", async failure => {
    const tab = await createTab();
    const first = await enqueue(tab, "First item that was already delivered");
    const second = await enqueue(tab, "Second item waits for completion storage");
    const native = simulateNativeChat(tab);
    busy(tab, false);
    await waitFor(() => native.sent.length === 1 && !tab.queue.dispatching, "first delivery confirmed");
    let failed = false;
    let unavailable = true;
    const failCompletion = (request: QueueRequest) => {
      if (request.action === "complete" && unavailable) { failed = true; throw new Error("Completion storage unavailable"); }
    };
    if (failure === "before-commit") tab.before = failCompletion;
    else tab.after = failCompletion;
    native.finish();
    await waitFor(() => failed && !tab.queue.polling && !tab.queue.dispatching, "completion transport failure preserved");
    expect(native.sent.filter(text => text === "First item that was already delivered")).toHaveLength(1);
    if (failure === "before-commit") {
      expect((await persisted()).items.find(item => item.id === first)?.status).toBe("waiting");
      expect((await persisted()).items.find(item => item.id === second)?.status).toBe("queued");
      expect(tab.shadow.textContent).toContain("Completion storage unavailable");
      unavailable = false;
      button(tab, "check").click();
    }
    await waitFor(() => native.sent.length === 2 && !tab.queue.dispatching, "only the next item recovered");
    expect(native.sent).toEqual(["First item that was already delivered", "Second item waits for completion storage"]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([first, second]);
    expect(tab.shadow.querySelector(".error")).toBeNull();
    expect(tab.shadow.querySelector("[data-action='retry']")).toBeNull();
    expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
  });

  test.each(["visible", "hidden"] as const)("completion mutations in a %s tab dispatch each next message despite a fresh busy heartbeat", async state => {
    const tab = await createTab({ visibility: state });
    const initialAnswer = tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant']")!;
    initialAnswer.querySelector(".turn-action-controls")!.remove();
    const native = simulateNativeChat(tab);
    const first = await enqueue(tab, "First prompt after completion");
    const second = await enqueue(tab, "Second prompt after completion");
    busy(tab, false);
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.every(item => item.status === "queued")).toBe(true);
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    expect(host.dataset.queueState).toBe("completion-pending");
    expect(host.dataset.queueRouteReady).toBe("true");
    expect(host.dataset.queueHasAnchor).toBe("true");
    expect(host.dataset.queueVisibility).toBe(state);
    expect(host.dataset.queueCompletionReason).toBe("completion-unverified");
    expect(tab.shadow.querySelector("li .status")?.textContent).toBe("This response's completion could not be verified. Your message is saved; check the chat, then use Send now to continue.");
    expect(tab.shadow.querySelectorAll("li .status")).toHaveLength(1);
    expect(Object.values(host.dataset).join(" ")).not.toContain("First prompt after completion");

    busy(tab, true);
    await waitFor(() => !tab.queue.polling, "idle before refreshing busy heartbeat");
    await poll(tab);
    expect((await persisted()).busyUntil).toBeGreaterThan(now);
    const firstCompletedAt = Date.now();
    initialAnswer.insertAdjacentHTML("beforeend", '<div class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div>');
    busy(tab, false);
    await waitFor(() => native.sent.length === 1, "first send after observed completion", 500);
    expect(Date.now() - firstCompletedAt).toBeLessThan(500);
    await waitFor(() => !tab.queue.dispatching && tab.queue.state?.items.find(item => item.id === first)?.status === "waiting", "first durable acknowledgement");
    await waitFor(() => !tab.queue.polling, "idle before second busy heartbeat");
    await poll(tab);
    expect((await persisted()).busyUntil).toBeGreaterThan(now);
    expect(native.sent).toEqual(["First prompt after completion"]);
    expect((await persisted()).items.find(item => item.id === second)?.status).toBe("queued");

    const secondCompletedAt = Date.now();
    native.finish();
    await waitFor(() => native.sent.length === 2, "second send after observed completion", 500);
    expect(Date.now() - secondCompletedAt).toBeLessThan(500);
    await waitFor(() => !tab.queue.dispatching && tab.queue.state?.items.find(item => item.id === second)?.status === "waiting", "second durable acknowledgement");
    native.finish();
    await waitFor(() => tab.queue.state?.items.length === 0, "final observed completion");
    expect(native.sent).toEqual(["First prompt after completion", "Second prompt after completion"]);
    expect(tab.requests.filter(request => request.action === "attempt").map(request => request.id)).toEqual([first, second]);
    expect(host.dataset.queueLastDispatchVisibility).toBe(state);
    expect(host.dataset.queueConfirmedSends).toBe("2");
    expect(tab.shadow.querySelector(".status")).toBeNull();
  });

  test("a hidden native click is recorded as an attempt until its acknowledgement is durable", async () => {
    const tab = await createTab({ visibility: "hidden" });
    await enqueue(tab, "Confirm this hidden send through storage");
    const native = simulateNativeChat(tab);
    let releaseAck!: () => void;
    const ackGate = new Promise<void>(resolve => { releaseAck = resolve; });
    tab.before = request => request.action === "ack" ? ackGate : undefined;
    const host = tab.doc.getElementById("plannotator-message-queue")!;
    busy(tab, false);
    await waitFor(() => tab.requests.some(request => request.action === "ack"), "acknowledgement pending");
    expect(native.sent).toHaveLength(1);
    expect(host.dataset.queueLastDispatchVisibility).toBe("hidden");
    expect(Number(host.dataset.queueLastDispatchTime)).toBeGreaterThan(0);
    expect(host.dataset.queueConfirmedSends).toBe("0");
    expect((await persisted()).items[0]?.status).toBe("sending");
    releaseAck();
    await waitFor(() => !tab.queue.dispatching, "durable send acknowledgement");
    expect(host.dataset.queueConfirmedSends).toBe("1");
    expect((await persisted()).items[0]?.status).toBe("waiting");
    await poll(tab);
    expect(host.dataset.queueConfirmedSends).toBe("1");
    expect(native.sent).toHaveLength(1);
  });
});

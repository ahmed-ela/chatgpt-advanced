import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { runInContext } from "node:vm";
import { QueueStore, QUEUE_MESSAGE_TYPE, getQueueKey, type QueueRequest, type QueueState } from "../src/queue-store";

const build = await Bun.build({ entrypoints: [new URL("../src/queue-ui.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!build.success) throw new Error(build.logs.join("\n"));
const source = (await build.outputs[0]!.text()).replace(/export\s*\{\s*MessageQueue\s*\};?\s*$/, "globalThis.__MessageQueue = MessageQueue;");
type Provider = "claude" | "gemini";
interface QueueView {
  start(): void; stop(): void; tick(immediate?: boolean): Promise<void>;
  state: QueueState | null; saving: boolean; polling: boolean; dispatching: boolean;
  lastPoll: number; tickPending: boolean; tickScheduled: boolean;
}
interface Tab {
  provider: Provider; key: string; dom: Window; doc: Document; queue: QueueView;
  composer: HTMLElement; action: HTMLButtonElement; shadow: ShadowRoot;
  sent: string[]; stops: number; turnIndex: number; pending: HTMLElement;
  deferGeminiResponse?: boolean;
  suppressNativeEcho?: boolean;
  pendingGeminiUser?: HTMLElement;
  pendingGeminiIndex?: number;
  failNextRequest?: { action: QueueRequest["action"]; message: string };
  listener?: (message: { type: string; key: string }) => void;
}
const chatId = "e284b3373d6e5bc6";
const toolbar = '<button aria-label="Copy">Copy</button><button aria-label="Good response">Good</button><button aria-label="Bad response">Bad</button>';
const metadata = btoa(JSON.stringify([["r_current", `c_${chatId}`, null, "rc_current"]]));
let store: QueueStore;
let tabs: Tab[];
let now: number;

beforeEach(() => { store = new QueueStore(new IDBFactory(), `multi-provider-${crypto.randomUUID()}`); tabs = []; now = Date.now(); });
afterEach(async () => {
  for (const tab of tabs) { tab.queue.stop(); await tab.dom.happyDOM.close(); }
  await store.close();
});
async function waitFor(predicate: () => boolean, label: string, timeout = 2500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// These smaller fixtures retain the identity, completion, and composer markers
// captured from the live Claude/Gemini clients; no ChatGPT-shaped shortcuts.
function renderGeminiPrompt(query: Element, text: string): void {
  const content = query.querySelector(".query-text")!;
  const label = query.ownerDocument.createElement("h5");
  label.className = "cdk-visually-hidden";
  label.textContent = `You said ${text}`;
  content.replaceChildren(label, ...text.split("\n").map(line => {
    const paragraph = query.ownerDocument.createElement("p");
    paragraph.className = "query-text-line";
    if (line === "") {
      paragraph.append(query.ownerDocument.createComment(""), query.ownerDocument.createElement("br"));
    } else paragraph.textContent = ` ${line} `;
    paragraph.append(query.ownerDocument.createComment(""));
    return paragraph;
  }));
}

function appendTurn(tab: Tab, text: string, complete: boolean): void {
  const index = tab.turnIndex++;
  const main = tab.doc.querySelector("main")!;
  if (tab.provider === "claude") {
    const user = tab.doc.createElement("div");
    user.setAttribute("data-testid", "transcript-row"); user.setAttribute("data-index", String(index * 2)); user.setAttribute("data-perf-row", "human");
    user.innerHTML = '<div data-testid="user-message"><p></p></div>';
    user.querySelector("p")!.textContent = text;
    const answer = tab.doc.createElement("div");
    answer.setAttribute("data-testid", "transcript-row"); answer.setAttribute("data-index", String(index * 2 + 1)); answer.setAttribute("data-perf-row", "assistant");
    answer.setAttribute("data-perf-row-streaming", String(!complete));
    answer.innerHTML = `<div data-testid="assistant-message" data-is-streaming="${!complete}"><div data-perf-reply-text><p>Response ${index}</p></div></div>${complete ? `<div data-testid="message-actions">${toolbar}</div>` : ""}`;
    main.append(user, answer); tab.pending = answer;
  } else {
    const turn = tab.doc.createElement("div"); turn.className = "conversation-container"; turn.id = index.toString(16).padStart(16, "0");
    turn.innerHTML = `<user-query><div class="query-content" id="user-query-content-${index}"><div class="query-text"><p></p></div></div></user-query><model-response><message-content><div class="markdown" aria-busy="${!complete}"><p>Response ${index}</p></div></message-content><span jslog="173913;BardVeMetadataKey:${metadata};mutable:true"></span>${complete ? `<div class="response-footer complete"></div><message-actions>${toolbar}</message-actions>` : ""}</model-response>`;
    renderGeminiPrompt(turn.querySelector("user-query")!, text);
    main.append(turn); tab.pending = turn.querySelector("model-response")!;
  }
}

function finish(tab: Tab): void {
  if (tab.provider === "claude") {
    tab.pending.setAttribute("data-perf-row-streaming", "false");
    tab.pending.querySelector("[data-testid='assistant-message']")!.setAttribute("data-is-streaming", "false");
    if (!tab.pending.querySelector("[data-testid='message-actions']")) tab.pending.insertAdjacentHTML("beforeend", `<div data-testid="message-actions">${toolbar}</div>`);
  } else {
    tab.pending.querySelector(".markdown")!.setAttribute("aria-busy", "false");
    if (!tab.pending.querySelector(".response-footer")) tab.pending.insertAdjacentHTML("beforeend", `<div class="response-footer complete"></div><message-actions>${toolbar}</message-actions>`);
  }
  tab.action.setAttribute("aria-label", "Send message");
}

async function createTab(provider: Provider, initialize?: (tab: Tab) => void): Promise<Tab> {
  const url = provider === "claude" ? `https://claude.ai/chat/${chatId}` : `https://gemini.google.com/app/${chatId}`;
  const dom = new Window({ url });
  const doc = dom.document as unknown as Document;
  doc.write(provider === "claude"
    ? `<a aria-current="page" href="/chat/${chatId}">Selected chat</a><main></main><div data-cds="ChatComposer"><div class="ProseMirror" data-testid="chat-input" contenteditable="true" role="textbox"></div><button id="native" aria-label="Stop response">Stop</button></div>`
    : '<main></main><input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea><button id="native" aria-label="Stop response">Stop</button></input-area-v2>');
  Object.assign(dom, { Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise, URL, atob, MessageChannel });
  Object.defineProperty(dom, "top", { value: {}, configurable: true });
  Object.defineProperty(doc, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperties(dom.HTMLElement.prototype, {
    getClientRects: { value: () => [new dom.DOMRect(100, 650, 700, 100)], configurable: true },
    getBoundingClientRect: { value: () => new dom.DOMRect(100, 650, 700, 100), configurable: true },
  });
  const tab = { provider, key: getQueueKey(url)!, dom, doc, sent: [], stops: 0, turnIndex: 0 } as unknown as Tab;
  tab.composer = doc.querySelector<HTMLElement>(provider === "claude" ? "[data-testid='chat-input']" : ".ql-editor")!;
  tab.action = doc.querySelector<HTMLButtonElement>("#native")!;
  appendTurn(tab, "Repeated prompt", false);
  initialize?.(tab);
  runInContext(source, dom);
  const Constructor = (dom as unknown as { __MessageQueue: new (runtime: unknown) => QueueView }).__MessageQueue;
  tab.queue = new Constructor({
    onMessage: { addListener(listener: Tab["listener"]) { tab.listener = listener; } },
    async sendMessage(raw: unknown) {
      const request = raw as QueueRequest;
      if (request.key !== tab.key) throw new Error("Wrong conversation key");
      if (tab.failNextRequest?.action === request.action) {
        const message = tab.failNextRequest.message;
        delete tab.failNextRequest;
        throw new Error(message);
      }
      const result = await store.apply(request, `tab${tabs.indexOf(tab)}:${request.clientId}`, now);
      if (result.changed && !(request.action === "heartbeat" && request.busy === true) && request.action !== "edit-heartbeat") queueMicrotask(() => {
        for (const other of tabs) if (other.key === request.key) other.listener?.({ type: "plannotator:queue:changed", key: request.key });
      });
      return { ok: true, state: result.state, claimed: result.claimed };
    },
  });
  tabs.push(tab);
  tab.action.addEventListener("click", () => {
    if (tab.action.getAttribute("aria-label")?.startsWith("Stop")) { tab.stops++; finish(tab); return; }
    // This fixture's editing fallback stores a single text node; happy-dom's
    // innerText collapses its newlines, unlike the editor's submitted value.
    const text = tab.composer.textContent ?? "";
    tab.sent.push(text);
    if (tab.suppressNativeEcho) {
      // A native request can start before the provider renders its user echo.
    } else if (tab.provider === "gemini" && tab.deferGeminiResponse) {
      const query = tab.doc.createElement("user-query");
      tab.pendingGeminiIndex = tab.turnIndex++;
      query.innerHTML = '<div class="query-content" id="user-query-content-undefined"><div class="query-text"><p></p></div></div>';
      renderGeminiPrompt(query, text);
      tab.doc.querySelector("main")!.append(query);
      tab.pendingGeminiUser = query;
    } else appendTurn(tab, text, false);
    draft(tab, "");
    tab.action.setAttribute("aria-label", "Stop response");
  });
  tab.queue.start();
  tab.shadow = doc.getElementById("plannotator-message-queue")!.shadowRoot!;
  await waitFor(() => Boolean(tab.queue.state) && !tab.queue.polling, "initial queue read");
  return tab;
}
function draft(tab: Tab, text: string): void {
  tab.composer.textContent = text;
  tab.composer.dispatchEvent(new tab.dom.InputEvent("input", { bubbles: true, composed: true }) as unknown as InputEvent);
}
function enter(tab: Tab): void {
  tab.composer.dispatchEvent(new tab.dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }) as unknown as KeyboardEvent);
}
function control(tab: Tab, action: string, id?: string): HTMLButtonElement {
  const button = tab.shadow.querySelector<HTMLButtonElement>(`${id ? `li[data-id='${id}'] ` : ""}button[data-action='${action}']`);
  if (!button) throw new Error(`Missing ${action} control`);
  return button;
}
function dragMessage(tab: Tab, fromId: string, toId: string): void {
  const handle = tab.shadow.querySelector(`li[data-id='${fromId}'] [draggable='true']`);
  const target = tab.shadow.querySelector(`li[data-id='${toId}']`);
  if (!handle || !target) throw new Error("Missing queue drag handle or drop target");
  const dataTransfer = new tab.dom.DataTransfer();
  for (const [element, type] of [[handle, "dragstart"], [target, "dragover"], [target, "drop"], [handle, "dragend"]] as const) {
    const event = new tab.dom.Event(type, { bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    element.dispatchEvent(event as unknown as Event);
  }
}
async function saved(tab: Tab): Promise<QueueState> {
  return (await store.apply({ type: QUEUE_MESSAGE_TYPE, key: tab.key, action: "read", clientId: "inspector" }, "inspector", now)).state;
}
async function enqueue(tab: Tab, text: string): Promise<string> {
  const before = new Set((await saved(tab)).items.map(item => item.id));
  draft(tab, text); enter(tab);
  await waitFor(() => !tab.queue.saving, "durable enqueue");
  const added = (await saved(tab)).items.find(item => !before.has(item.id));
  if (!added) throw new Error(`Did not queue ${text}: ${tab.shadow.textContent}`);
  return added.id;
}
async function poll(tab: Tab): Promise<void> {
  await idle(tab, "idle before explicit poll");
  tab.queue.lastPoll = 0;
  await tab.queue.tick(true);
  await idle(tab, "explicit poll and event-driven work finish");
}
async function idle(tab: Tab, label: string): Promise<void> {
  // A DOM mutation can schedule a tick after the current callback returns.
  // Awaiting a direct tick alone is insufficient if that other tick owns the
  // runtime: direct tick then returns early while its durable work continues.
  await new Promise(resolve => setTimeout(resolve, 0));
  await waitFor(() => !tab.queue.polling && !tab.queue.dispatching && !tab.queue.saving &&
    !tab.queue.tickPending && !tab.queue.tickScheduled, label);
}
async function dispatchReady(tab: Tab): Promise<void> { await poll(tab); }

function wrapGeminiQuery(tab: Tab, query: HTMLElement, turnId: string, index: number): void {
  const turn = tab.doc.createElement("div");
  turn.className = "conversation-container"; turn.id = turnId;
  query.querySelector(".query-content")!.id = `user-query-content-${index}`;
  query.replaceWith(turn); turn.append(query);
  turn.insertAdjacentHTML("beforeend", `<model-response><message-content><div class="markdown" aria-busy="true"><p>Response starts</p></div></message-content><span jslog="173913;BardVeMetadataKey:${metadata};mutable:true"></span></model-response>`);
  tab.pending = turn.querySelector("model-response")!;
}

function closeView(tab: Tab): void {
  tab.queue.stop();
  Object.defineProperty(tab.doc, "visibilityState", { value: "hidden", configurable: true });
}

describe("Claude and Gemini persistent queues", () => {
  for (const provider of ["claude", "gemini"] as const) {
    test(`${provider}: a hidden tab drains successive replies without a visibility change or manual poll`, async () => {
      const tab = await createTab(provider);
      const first = await enqueue(tab, "First background follow-up");
      const second = await enqueue(tab, "Second background follow-up");
      Object.defineProperty(tab.doc, "visibilityState", { value: "hidden", configurable: true });
      tab.doc.dispatchEvent(new tab.dom.Event("visibilitychange") as unknown as Event);
      await idle(tab, "hidden tab observes the running response");
      expect(tab.sent).toEqual([]);

      finish(tab);
      await waitFor(() => tab.sent.length === 1 && !tab.queue.dispatching, "first hidden completion acknowledged", 500);
      expect(tab.doc.visibilityState).toBe("hidden");
      expect(tab.sent).toEqual(["First background follow-up"]);
      expect((await saved(tab)).items.find(item => item.id === first)?.status).toBe("waiting");
      expect((await saved(tab)).items.find(item => item.id === second)?.status).toBe("queued");
      expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
      expect(tab.shadow.querySelector(`li[data-id='${second}']`)).not.toBeNull();

      finish(tab);
      await waitFor(() => tab.sent.length === 2 && !tab.queue.dispatching, "second hidden completion acknowledged", 500);
      expect(tab.doc.visibilityState).toBe("hidden");
      expect(tab.sent).toEqual(["First background follow-up", "Second background follow-up"]);
      expect((await saved(tab)).items.find(item => item.id === second)?.status).toBe("waiting");
      expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);

      finish(tab);
      await waitFor(() => tab.queue.state?.items.length === 0, "hidden queue fully drained", 500);
      expect((await saved(tab)).items).toHaveLength(0);
      expect(tab.sent).toHaveLength(2);
      expect(tab.stops).toBe(0);
    });

    test(`${provider}: native composer editing retains the slot and updates a reopened tab`, async () => {
      const tab = await createTab(provider);
      const first = await enqueue(tab, "First queued");
      const middle = await enqueue(tab, "Middle queued");
      const last = await enqueue(tab, "Last queued");
      control(tab, "pause").click();
      await waitFor(() => Boolean(tab.queue.state?.paused), "pause");
      control(tab, "edit", middle).click();
      await waitFor(() => tab.composer.innerText === "Middle queued", "editor composer");
      draft(tab, "Edited middle\nSecond line"); enter(tab);
      await waitFor(() => tab.composer.innerText === "", "saved edit");
      expect((await saved(tab)).items.map(item => item.id)).toEqual([first, middle, last]);
      expect((await saved(tab)).items[1]?.text).toBe("Edited middle\nSecond line");
      dragMessage(tab, last, middle);
      await waitFor(() => tab.queue.state?.items[1]?.id === last, "reorder");
      const reopened = await createTab(provider);
      expect(reopened.queue.state?.items.map(item => item.id)).toEqual([first, last, middle]);
      expect(reopened.queue.state?.paused).toBe(true);
      expect(reopened.shadow.textContent).toContain("Edited middle");
      control(tab, "remove", first).click();
      await waitFor(() => tab.queue.state?.items.length === 2, "remove persisted item");
      await poll(reopened);
      expect(reopened.queue.state?.items.map(item => item.id)).toEqual([last, middle]);
      expect(tab.sent).toEqual([]);
    });

    test(`${provider}: repeated prompts acknowledge distinct new user turns and dispatch sequentially`, async () => {
      const tab = await createTab(provider);
      const first = await enqueue(tab, "Repeated prompt");
      const second = await enqueue(tab, "Repeated prompt");
      const initialUserId = (await saved(tab)).lastCompletedUserMessageId;
      await poll(tab);
      expect((await saved(tab)).busyUntil).toBeGreaterThan(now);
      expect(tab.sent).toEqual([]);
      const firstCompletedAt = Date.now();
      finish(tab);
      await waitFor(() => tab.sent.length === 1 && !tab.queue.dispatching, "first observed completion sends promptly", 500);
      expect(Date.now() - firstCompletedAt).toBeLessThan(500);
      expect(tab.sent).toEqual(["Repeated prompt"]);
      const firstAck = (await saved(tab)).items.find(item => item.id === first)?.userMessageId;
      expect(firstAck).toBeDefined(); expect(firstAck).not.toBe(initialUserId);
      expect((await saved(tab)).items.find(item => item.id === second)?.status).toBe("queued");
      expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
      expect(Array.from(tab.shadow.querySelectorAll<HTMLElement>("li[data-id]")).map(row => row.dataset.id)).toEqual([second]);
      expect(tab.shadow.querySelector(".count")?.textContent).toBe("1");
      expect(tab.shadow.querySelector("li .num")?.textContent).toBe("1");
      await poll(tab);
      await dispatchReady(tab);
      expect(tab.sent).toEqual(["Repeated prompt"]);
      expect((await saved(tab)).items.find(item => item.id === second)?.status).toBe("queued");
      expect((await saved(tab)).busyUntil).toBeGreaterThan(now);
      const secondCompletedAt = Date.now();
      finish(tab);
      await waitFor(() => tab.sent.length === 2 && !tab.queue.dispatching, "second observed completion sends promptly", 500);
      expect(Date.now() - secondCompletedAt).toBeLessThan(500);
      expect(tab.sent).toEqual(["Repeated prompt", "Repeated prompt"]);
      const secondAck = (await saved(tab)).items.find(item => item.id === second)?.userMessageId;
      expect(secondAck).toBeDefined(); expect(secondAck).not.toBe(firstAck);
      expect((await saved(tab)).items.find(item => item.id === second)?.status).toBe("waiting");
      expect(tab.doc.getElementById("plannotator-message-queue")!.style.display).toBe("none");
      expect(tab.shadow.querySelectorAll("li[data-id]")).toHaveLength(0);
      finish(tab);
      await waitFor(() => tab.queue.state?.items.length === 0, "final observed completion");
      expect((await saved(tab)).items).toHaveLength(0);
      expect(tab.stops).toBe(0);
    });

    test(`${provider}: Send now stops once and preserves the paused remaining stack`, async () => {
      const tab = await createTab(provider);
      await enqueue(tab, "First running response");
      const remaining = await enqueue(tab, "Keep queued");
      const selected = await enqueue(tab, "Selected steer");
      finish(tab); now += 4000;
      await dispatchReady(tab);
      control(tab, "pause").click();
      await waitFor(() => Boolean(tab.queue.state?.paused), "shared pause");
      control(tab, "steer", selected).click();
      await waitFor(() => !tab.queue.dispatching, "send now acknowledged");
      expect(tab.stops).toBe(1);
      expect(tab.sent).toEqual(["First running response", "Selected steer"]);
      expect((await saved(tab)).items.map(item => item.id)).toEqual([selected, remaining]);
      expect((await saved(tab)).paused).toBe(true);
      finish(tab); now += 4000;
      await poll(tab);
      expect((await saved(tab)).items.map(item => item.id)).toEqual([remaining]);
      control(tab, "pause").click();
      await waitFor(() => tab.queue.state?.paused === false, "resume");
      await dispatchReady(tab);
      expect(tab.sent).toEqual(["First running response", "Selected steer", "Keep queued"]);
    });

    test(`${provider}: Send now never overwrites a current native draft`, async () => {
      const tab = await createTab(provider);
      const id = await enqueue(tab, "Still saved");
      draft(tab, "My unrelated draft");
      control(tab, "steer", id).click();
      await waitFor(() => !tab.queue.dispatching, "draft protection");
      expect(tab.composer.innerText).toBe("My unrelated draft");
      expect((await saved(tab)).items[0]?.status).toBe("queued");
      expect(tab.sent).toEqual([]); expect(tab.stops).toBe(0);
    });

    test(`${provider}: an empty paused queue keeps Resume visible and captures native Enter until resumed`, async () => {
      const tab = await createTab(provider);
      const removed = await enqueue(tab, "Remove this while paused");
      control(tab, "pause").click();
      await waitFor(() => Boolean(tab.queue.state?.paused), "pause before emptying");
      control(tab, "remove", removed).click();
      await waitFor(() => tab.queue.state?.items.length === 0, "empty paused queue");
      finish(tab); now += 4000;
      await poll(tab);
      expect(control(tab, "pause").textContent).toBe("Resume");
      expect(tab.doc.getElementById("plannotator-message-queue")!.style.display).not.toBe("none");
      await enqueue(tab, "Queued while empty and paused");
      expect((await saved(tab)).paused).toBe(true);
      await dispatchReady(tab);
      expect(tab.sent).toEqual([]);
      control(tab, "pause").click();
      await waitFor(() => tab.queue.state?.paused === false, "explicit resume");
      await dispatchReady(tab);
      expect(tab.sent).toEqual(["Queued while empty and paused"]);
    });
  }

  test("identical conversation IDs on Claude and Gemini never share messages or pause state", async () => {
    const claude = await createTab("claude");
    const gemini = await createTab("gemini");
    await enqueue(claude, "Claude only");
    await enqueue(gemini, "Gemini only");
    control(claude, "pause").click();
    await waitFor(() => Boolean(claude.queue.state?.paused), "Claude pause");
    await poll(gemini);
    expect((await saved(claude)).items.map(item => item.text)).toEqual(["Claude only"]);
    expect((await saved(gemini)).items.map(item => item.text)).toEqual(["Gemini only"]);
    expect((await saved(gemini)).paused).toBe(false);
    expect(gemini.shadow.textContent).not.toContain("Claude only");
  });

  test("Gemini acknowledges padded multiline echoes promptly and continues after completion", async () => {
    const tab = await createTab("gemini");
    const text = "Inspect this code:\n    first();  \n\n\tsecond();\nThen reply FOUR.";
    const first = await enqueue(tab, text);
    const next = await enqueue(tab, "After the multiline reply");
    finish(tab);
    await waitFor(() => tab.sent.length === 1 && !tab.queue.dispatching, "multiline acknowledged without timeout", 750);
    const acknowledged = (await saved(tab)).items.find(item => item.id === first)!;
    expect(acknowledged.status).toBe("waiting");
    expect(acknowledged.userMessageId).toBeDefined();
    expect(tab.sent).toEqual([text]);
    expect(tab.shadow.querySelector(`li[data-id='${first}']`)).toBeNull();
    expect(tab.shadow.textContent).not.toContain("Needs review");

    // The visible transcript can remount between the echo and its completion.
    // The durable acknowledgement must still resolve without another send.
    const main = tab.doc.querySelector("main")!;
    main.innerHTML = main.innerHTML;
    tab.pending = main.querySelectorAll<HTMLElement>("model-response")[1]!;
    finish(tab);
    await waitFor(() => tab.sent.length === 2 && !tab.queue.dispatching, "next queued prompt after multiline completion", 750);
    expect(tab.sent).toEqual([text, "After the multiline reply"]);
    expect((await saved(tab)).items.find(item => item.id === next)?.status).toBe("waiting");
    finish(tab);
    await waitFor(() => tab.queue.state?.items.length === 0, "completed multiline queue drains");
    expect((await saved(tab)).lastCompletedUserMessageId).toBeDefined();
    expect(tab.sent).toHaveLength(2);
  });

  test("Gemini acknowledgement does not confuse altered indentation with the queued prompt", async () => {
    const tab = await createTab("gemini");
    const text = "Keep this code:\n    execute();\n\nDone.";
    const id = await enqueue(tab, text);
    tab.action.addEventListener("click", () => {
      const query = tab.doc.querySelectorAll("user-query")[1]!;
      renderGeminiPrompt(query, "Keep this code:\nexecute();\n\nDone.");
    }, { once: true });
    finish(tab);
    await waitFor(() => tab.sent.length === 1, "native send with a differing echo");
    expect(tab.queue.dispatching).toBe(true);
    expect((await saved(tab)).items.find(item => item.id === id)?.status).toBe("sending");
    expect(tab.shadow.querySelector(`li[data-id='${id}']`)).not.toBeNull();
    // Only the exact prompt echo, not whitespace-collapsed text, confirms it.
    renderGeminiPrompt(tab.doc.querySelectorAll("user-query")[1]!, text);
    await waitFor(() => !tab.queue.dispatching, "exact multiline echo acknowledged", 750);
    expect((await saved(tab)).items.find(item => item.id === id)?.status).toBe("waiting");
    expect(tab.sent).toEqual([text]);
  });

  test("Gemini acknowledges a sent prompt before its response wrapper appears and completes it after wrapping", async () => {
    const tab = await createTab("gemini");
    // Earlier prompts have been virtualized away; the visible prior prompt
    // index must win over the optimistic prompt's position in this small DOM.
    tab.doc.querySelector(".query-content")!.id = "user-query-content-5";
    tab.turnIndex = 6;
    const text = "A prompt with a delayed Pro response\n\n    Preserve this indentation.";
    const queued = await enqueue(tab, text);
    tab.deferGeminiResponse = true;
    finish(tab); now += 4000;
    await dispatchReady(tab);
    const query = tab.pendingGeminiUser!;
    expect(query).toBeDefined();
    expect(query.closest(".conversation-container")).toBeNull();
    expect(query.querySelector(".query-content")!.id).toBe("user-query-content-undefined");
    const acknowledged = (await saved(tab)).items.find(item => item.id === queued)!;
    expect(acknowledged.status).toBe("waiting");
    expect(acknowledged.userMessageId).toContain("gemini:user:user-query-content-6:");
    expect(tab.sent).toEqual([text]);
    const turn = tab.doc.createElement("div");
    turn.className = "conversation-container"; turn.id = "later-server-response-id";
    query.querySelector(".query-content")!.id = `user-query-content-${tab.pendingGeminiIndex}`;
    query.replaceWith(turn); turn.append(query);
    turn.insertAdjacentHTML("beforeend", `<model-response><message-content><div class="markdown" aria-busy="true"><p>The response starts later</p></div></message-content><span jslog="173913;BardVeMetadataKey:${metadata};mutable:true"></span></model-response>`);
    tab.pending = turn.querySelector("model-response")!;
    await poll(tab);
    expect((await saved(tab)).items[0]?.userMessageId).toBe(acknowledged.userMessageId);
    finish(tab); now += 4000;
    await poll(tab);
    expect((await saved(tab)).items).toHaveLength(0);
    expect(tab.sent).toHaveLength(1);
  });

  test("Gemini resumes a paused queue after reopened prompt indices change from 11 to 9", async () => {
    const turnId = "23845300d6e6d28e";
    const tab = await createTab("gemini", tab => {
      tab.doc.querySelector(".conversation-container")!.id = turnId;
      tab.doc.querySelector(".query-content")!.id = "user-query-content-11";
      renderGeminiPrompt(tab.doc.querySelector("user-query")!, "Write 30 short numbered tips for starting a small herb garden.");
      tab.turnIndex = 12;
    });
    const queued = await enqueue(tab, "Reply with one short tip about rosemary.");
    control(tab, "pause").click();
    await waitFor(() => Boolean(tab.queue.state?.paused), "pause before closing");
    finish(tab);
    await poll(tab);
    expect((await saved(tab)).lastCompletedUserMessageId).toBe(`gemini:user:${turnId}`);
    const transcript = tab.doc.querySelector("main")!.innerHTML;
    closeView(tab); now += 4000;
    const reopened = await createTab("gemini", view => {
      view.doc.querySelector("main")!.innerHTML = transcript;
      view.doc.querySelector(".query-content")!.id = "user-query-content-9";
      view.pending = view.doc.querySelector("model-response")!;
      view.turnIndex = 10;
      view.action.setAttribute("aria-label", "Send message");
    });
    expect((await saved(reopened)).items.map(item => item.id)).toEqual([queued]);
    expect(reopened.queue.state?.paused).toBe(true);
    expect(reopened.sent).toEqual([]);
    control(reopened, "pause").click();
    await waitFor(() => reopened.sent.length === 1 && !reopened.queue.dispatching, "automatic send after reopened Resume");
    expect(reopened.sent).toEqual(["Reply with one short tip about rosemary."]);
    expect((await saved(reopened)).items.find(item => item.id === queued)?.status).toBe("waiting");
    finish(reopened);
    await waitFor(() => reopened.queue.state?.items.length === 0, "reopened queue drains once");
    expect(reopened.sent).toHaveLength(1);
    expect(tab.sent).toEqual([]);
  });

  test("Gemini persists a stable completion anchor after an optimistic acknowledgement before reopening", async () => {
    const tab = await createTab("gemini", tab => {
      tab.doc.querySelector(".query-content")!.id = "user-query-content-10";
      tab.turnIndex = 11;
    });
    const first = await enqueue(tab, "Repeated prompt");
    const second = await enqueue(tab, "Send this after reopening");
    tab.deferGeminiResponse = true;
    finish(tab); now += 4000;
    await dispatchReady(tab);
    const optimistic = (await saved(tab)).items.find(item => item.id === first)!;
    expect(optimistic.status).toBe("waiting");
    expect(optimistic.userMessageId).toContain("gemini:user:user-query-content-11:");
    control(tab, "pause").click();
    await waitFor(() => Boolean(tab.queue.state?.paused), "pause after optimistic acknowledgement");
    wrapGeminiQuery(tab, tab.pendingGeminiUser!, "1234567890abcdef", 11);
    await poll(tab);
    expect((await saved(tab)).items.find(item => item.id === first)?.userMessageId).toBe("gemini:user:1234567890abcdef");
    expect((await saved(tab)).items.find(item => item.id === first)?.status).toBe("waiting");
    finish(tab);
    await poll(tab);
    expect((await saved(tab)).items.map(item => item.id)).toEqual([second]);
    expect((await saved(tab)).lastCompletedUserMessageId).toBe("gemini:user:1234567890abcdef");
    const transcript = tab.doc.querySelector("main")!.innerHTML;
    closeView(tab); now += 4000;
    const reopened = await createTab("gemini", view => {
      view.doc.querySelector("main")!.innerHTML = transcript;
      Array.from(view.doc.querySelectorAll(".query-content")).forEach((query, index) => { query.id = `user-query-content-${index + 8}`; });
      view.pending = Array.from(view.doc.querySelectorAll<HTMLElement>("model-response")).at(-1)!;
      view.turnIndex = 10;
      view.action.setAttribute("aria-label", "Send message");
    });
    control(reopened, "pause").click();
    await waitFor(() => reopened.sent.length === 1 && !reopened.queue.dispatching, "next item sends after stable anchor survives reopen");
    expect(reopened.sent).toEqual(["Send this after reopening"]);
    expect(tab.sent).toEqual(["Repeated prompt"]);
    expect((await saved(reopened)).items.find(item => item.id === second)?.status).toBe("waiting");
  });

  test("Gemini does not acknowledge an older equal-text optimistic prompt when its stable wrapper appears", async () => {
    const key = getQueueKey(`https://gemini.google.com/app/${chatId}`)!;
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "enqueue", clientId: "seed", id: "pending-repeat", text: "Repeated prompt" }, "seed", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "pause", clientId: "seed", paused: true }, "seed", now);
    let olderQuery!: HTMLElement;
    const tab = await createTab("gemini", view => {
      finish(view);
      olderQuery = view.doc.createElement("user-query");
      olderQuery.innerHTML = '<div class="query-content" id="user-query-content-undefined"><div class="query-text"></div></div>';
      renderGeminiPrompt(olderQuery, "Repeated prompt");
      view.doc.querySelector("main")!.append(olderQuery);
      view.suppressNativeEcho = true;
    });
    control(tab, "pause").click();
    await waitFor(() => tab.sent.length === 1, "native send starts before new echo");
    wrapGeminiQuery(tab, olderQuery, "1111222233334444", 1);
    // Force processing of the changed older DOM while the new echo is absent.
    await new Promise(resolve => setTimeout(resolve, 40));
    expect((await saved(tab)).items.find(item => item.id === "pending-repeat")?.status).toBe("sending");
    expect(tab.queue.dispatching).toBe(true);
    expect(tab.shadow.querySelector("li[data-id='pending-repeat']")).not.toBeNull();
    tab.turnIndex = 2;
    appendTurn(tab, "Repeated prompt", false);
    await waitFor(() => !tab.queue.dispatching, "new equal-text echo acknowledged");
    expect((await saved(tab)).items.find(item => item.id === "pending-repeat")?.userMessageId).toBe("gemini:user:0000000000000002");
    expect(tab.sent).toEqual(["Repeated prompt"]);
  });

  test("Gemini never rebinds a legacy shifted index by text and keeps explicit recovery available", async () => {
    const key = getQueueKey(`https://gemini.google.com/app/${chatId}`)!;
    const legacy = "gemini:user:user-query-content-11:18g9iba";
    const recoveryNotice = "This older queue needs confirmation after reopening. Use Send now on the first message to continue.";
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "enqueue", clientId: "seed", id: "legacy-followup", text: "Saved before the update", afterUserMessageId: legacy }, "seed", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "pause", clientId: "seed", paused: true }, "seed", now);
    const tab = await createTab("gemini", view => {
      view.doc.querySelector(".conversation-container")!.id = "23845300d6e6d28e";
      view.doc.querySelector(".query-content")!.id = "user-query-content-9";
      renderGeminiPrompt(view.doc.querySelector("user-query")!, "Write 30 short numbered tips for starting a small herb garden.");
      view.turnIndex = 10;
      finish(view);
    });
    expect(tab.sent).toEqual([]);
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    control(tab, "pause").click();
    await waitFor(() => tab.queue.state?.paused === false, "resume legacy queue");
    await poll(tab);
    expect(tab.sent).toEqual([]);
    expect((await saved(tab)).lastCompletedUserMessageId).toBe(legacy);
    expect((await saved(tab)).items.find(item => item.id === "legacy-followup")?.status).toBe("queued");
    expect(tab.shadow.textContent).toContain(recoveryNotice);

    tab.action.setAttribute("aria-label", "Stop response");
    await poll(tab);
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    finish(tab);
    await poll(tab);
    expect(tab.shadow.textContent).toContain(recoveryNotice);

    const identity = tab.doc.querySelector("[jslog]")!;
    const observedMetadata = identity.getAttribute("jslog")!;
    identity.removeAttribute("jslog");
    await poll(tab);
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    identity.setAttribute("jslog", observedMetadata);
    await poll(tab);
    expect(tab.shadow.textContent).toContain(recoveryNotice);

    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "enqueue", clientId: "peer", id: "peer-edit", text: "Another tab is editing this" }, "peer", now);
    const editToken = crypto.randomUUID();
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "begin-edit", clientId: "peer", id: "peer-edit", editToken }, "peer", now);
    await poll(tab);
    expect(control(tab, "steer", "legacy-followup").disabled).toBe(true);
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "cancel-edit", clientId: "peer", id: "peer-edit", editToken }, "peer", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "remove", clientId: "peer", id: "peer-edit" }, "peer", now);
    await poll(tab);
    expect(tab.shadow.textContent).toContain(recoveryNotice);

    draft(tab, "Keep this unrelated draft");
    control(tab, "steer", "legacy-followup").click();
    await waitFor(() => Boolean(tab.shadow.textContent?.includes("Queue or clear the current draft")), "draft protection warning");
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    expect(tab.composer.textContent).toBe("Keep this unrelated draft");
    draft(tab, "");
    await waitFor(() => Boolean(tab.shadow.textContent?.includes(recoveryNotice)), "recovery notice after draft warning clears");

    tab.failNextRequest = { action: "heartbeat", message: "Queue connection unavailable" };
    await poll(tab);
    expect(tab.shadow.textContent).toContain("Queue connection unavailable");
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    control(tab, "check").click();
    await waitFor(() => Boolean(tab.shadow.textContent?.includes(recoveryNotice)), "recovery notice after successful connection retry");
    control(tab, "steer", "legacy-followup").click();
    await waitFor(() => tab.sent.length === 1 && !tab.queue.dispatching, "explicit legacy recovery");
    expect(tab.sent).toEqual(["Saved before the update"]);
    expect(tab.shadow.textContent).not.toContain(recoveryNotice);
    finish(tab);
    await waitFor(() => tab.queue.state?.items.length === 0, "explicit recovery completes once");
    expect(tab.sent).toHaveLength(1);
  });

  test("Gemini cannot bind a reopened legacy anchor to a different equal-text turn reusing its index", async () => {
    const key = getQueueKey(`https://gemini.google.com/app/${chatId}`)!;
    const legacy = "gemini:user:user-query-content-11:18g9iba";
    const repeated = "Write 30 short numbered tips for starting a small herb garden.";
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "enqueue", clientId: "seed", id: "legacy-duplicate", text: "Wait for my original turn", afterUserMessageId: legacy }, "seed", now);
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, action: "pause", clientId: "seed", paused: true }, "seed", now);
    const tab = await createTab("gemini", view => {
      view.doc.querySelector(".conversation-container")!.id = "23845300d6e6d28e";
      view.doc.querySelector(".query-content")!.id = "user-query-content-9";
      renderGeminiPrompt(view.doc.querySelector("user-query")!, repeated);
      // The original turn was interrupted. A later equal-text turn is complete
      // and now reuses the original ephemeral index after history remounting.
      view.pending.querySelector(".markdown")!.setAttribute("aria-busy", "false");
      view.turnIndex = 11;
      appendTurn(view, repeated, true);
      view.action.setAttribute("aria-label", "Send message");
    });
    expect((await saved(tab)).lastCompletedUserMessageId).toBe(legacy);
    control(tab, "pause").click();
    await waitFor(() => tab.queue.state?.paused === false, "resume ambiguous legacy queue");
    await poll(tab);
    expect(tab.sent).toEqual([]);
    expect((await saved(tab)).items.find(item => item.id === "legacy-duplicate")?.status).toBe("queued");
    expect((await saved(tab)).lastCompletedUserMessageId).toBe(legacy);
  });
});

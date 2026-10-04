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

async function createTab(options: { newChat?: boolean; idle?: boolean; before?: Tab["before"]; returnBeforeRead?: boolean } = {}): Promise<Tab> {
  const dom = new Window({ url: options.newChat ? "https://chatgpt.com/" : "https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const doc = dom.document as unknown as Document;
  doc.write(fixture);
  if (options.newChat) {
    doc.querySelector("main")!.replaceChildren();
    doc.querySelector("main")!.removeAttribute("data-chatgpt-selection-conversation-id");
    doc.querySelector("#native-action")!.setAttribute("aria-label", "Send message");
  }
  if (options.idle) doc.querySelector("#native-action")!.setAttribute("aria-label", "Send message");
  Object.assign(dom, { Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise, URL, atob });
  Object.defineProperty(dom, "top", { value: {}, configurable: true });
  Object.defineProperty(doc, "visibilityState", { value: "visible", configurable: true });
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
function enter(tab: Tab, options: { shiftKey?: boolean; isComposing?: boolean } = {}): boolean {
  return tab.composer.dispatchEvent(new tab.dom.KeyboardEvent("keydown", {
    key: "Enter", bubbles: true, composed: true, cancelable: true, ...options,
  }) as unknown as KeyboardEvent);
}
function busy(tab: Tab, value: boolean): void {
  tab.action.setAttribute("aria-label", value ? "Stop streaming" : "Send message");
  tab.action.textContent = value ? "Stop" : "Send";
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

function simulateNativeChat(tab: Tab): { sent: string[]; stops: number; finish: () => void } {
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
    result.sent.push(tab.composer.innerText);
    const id = crypto.randomUUID();
    const user = tab.doc.createElement("article");
    user.setAttribute("data-chatgpt-search-unit-key", `${id}:user`);
    user.setAttribute("data-chatgpt-search-message-ids", id);
    user.innerHTML = '<div data-user-message-bubble="true"></div>';
    user.firstElementChild!.textContent = tab.composer.innerText;
    pendingAnswer = tab.doc.createElement("article");
    pendingAnswer.innerHTML = '<div data-markdown-text-style="assistant-message">Response running</div>';
    tab.doc.querySelector("main")!.append(user, pendingAnswer);
    draft(tab, ""); busy(tab, true);
  });
  return result;
}

describe("Persistent message queue UI", () => {
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

  test.each(["Enter", "click"] as const)("observed first native %s permits queued dispatch after a new chat's temporary-ID response completes", async activation => {
    const tab = await createTab({ newChat: true });
    const firstUserId = "55555555-5555-4555-8555-555555555555";
    const queuedUserId = "66666666-6666-4666-8666-666666666666";
    const localId = "local-chatgpt:77777777-7777-4777-8777-777777777777";
    let firstSends = 0;
    const nativeFirstSend = () => {
      firstSends++;
      const text = tab.composer.innerText;
      tab.dom.history.pushState({}, "", "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const main = tab.doc.querySelector("main")!;
      main.setAttribute("data-chatgpt-selection-conversation-id", localId);
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
    } else {
      tab.composer.addEventListener("keydown", nativeFirstSend, { once: true });
      enter(tab);
    }
    expect(firstSends).toBe(1);
    expect((await persisted()).items).toHaveLength(0);
    await poll(tab);
    await enqueue(tab, "Follow up after that first reply");
    expect((await persisted()).lastCompletedUserMessageId).toBe(firstUserId);
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

  test("automatic dispatch waits when the composer contains an unsent draft", async () => {
    const tab = await createTab();
    await enqueue(tab, "Saved queued text");
    draft(tab, "Do not replace this draft");
    busy(tab, false); now += 4000;
    let sends = 0;
    tab.action.addEventListener("click", () => { sends++; });
    await poll(tab);
    expect(sends).toBe(0);
    expect(tab.composer.innerText).toBe("Do not replace this draft");
    expect((await persisted()).items[0]?.status).toBe("queued");
  });

  test("a persistently failing composer fill stays queued without spinning on change broadcasts", async () => {
    const tab = await createTab();
    const id = await enqueue(tab, "Keep saved if the editor rejects insertion");
    const native = simulateNativeChat(tab);
    Object.defineProperty(tab.doc, "execCommand", { value: () => true, configurable: true });
    busy(tab, false);
    await waitFor(() => tab.requests.some(request => request.action === "release" && request.id === id), "failed fill releases its claim");
    tab.listener?.({ type: "plannotator:queue:changed", key });
    tab.composer.dispatchEvent(new tab.dom.InputEvent("input", { bubbles: true, composed: true }) as unknown as InputEvent);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(tab.requests.filter(request => request.action === "claim")).toHaveLength(1);
    expect(tab.requests.filter(request => request.action === "attempt")).toHaveLength(0);
    expect((await persisted()).items.find(item => item.id === id)?.status).toBe("queued");
    expect(tab.composer.innerText).toBe("");
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

  test("completion mutations dispatch each next message promptly despite a fresh busy heartbeat", async () => {
    const tab = await createTab();
    const initialAnswer = tab.doc.querySelector("article[data-chatgpt-selection-message-id='initial-assistant']")!;
    initialAnswer.querySelector(".turn-action-controls")!.remove();
    const native = simulateNativeChat(tab);
    const first = await enqueue(tab, "First prompt after completion");
    const second = await enqueue(tab, "Second prompt after completion");
    busy(tab, false);
    await poll(tab);
    expect(native.sent).toEqual([]);
    expect((await persisted()).items.every(item => item.status === "queued")).toBe(true);

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
  });
});

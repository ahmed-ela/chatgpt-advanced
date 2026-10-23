import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { runInContext } from "node:vm";
import { AnnotationStore, ANNOTATION_MESSAGE_TYPE, ANNOTATION_CHANGED_TYPE, getAnnotationKey, type AnnotationRequest, type PersistedNoteItem } from "../src/annotation-store";

const fixture = await Bun.file(new URL("./current-layout.html", import.meta.url)).text();
const entry = new URL("../src/content.ts", import.meta.url).pathname;
const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", plugins: [{ name: "annotation-ui-test", setup(build) {
  build.onLoad({ filter: /content\.ts$/ }, async args => args.path === entry ? {
    loader: "ts", contents: `${await Bun.file(args.path).text()}
      globalThis.__annotationTest = { bootstrap, syncAnnotationRoute, getSelectionDraft, state,
        commitDraftNote, updateNote, deleteNote, clearAllNotes, insertPrompt,
        getSession: currentAnnotationSession, getNotes: allConversationNotes,
        getUi: () => annotationUi, retry: retryAnnotationSave,
        refresh: () => refreshAnnotationSession(currentAnnotationSession()),
        flush: flushPersistedConversationState };`,
  } : undefined);
} }] });
if (!build.success) throw new Error(build.logs.join("\n"));
const source = await build.outputs[0]!.text();
const url = "https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prefix = "plannotator-chatgpt-notes:v1:";
type Helpers = {
  bootstrap(): void; syncAnnotationRoute(ui: unknown): void;
  getSelectionDraft(): unknown;
  state: { selectionDraft: unknown; draftText: string; notes: Array<PersistedNoteItem>; actionFeedback: string };
  commitDraftNote(): void; updateNote(id: string, changes: { comment: string }): void;
  deleteNote(id: string): void; clearAllNotes(): void; insertPrompt(ui: unknown): Promise<void>;
  getSession(): { loaded: boolean; pending: Map<string, unknown>; error: string; migrationError: string; flushing: unknown; loading: unknown };
  getNotes(): PersistedNoteItem[]; getUi(): unknown; retry(): Promise<void>; refresh(): Promise<void>; flush(): Promise<void>;
};
interface Tab {
  dom: Window; doc: Document; helpers: Helpers; shadow: ShadowRoot;
  requests: AnnotationRequest[];
  before?: (request: AnnotationRequest) => Promise<void> | void;
  after?: (request: AnnotationRequest) => Promise<void> | void;
  listeners: Array<(message: unknown) => void>;
}
let store: AnnotationStore;
let tabs: Tab[];
beforeEach(() => { store = new AnnotationStore(new IDBFactory(), `annotation-ui-${crypto.randomUUID()}`); tabs = []; });
afterEach(async () => { for (const tab of tabs) await tab.dom.happyDOM.close(); await store.close(); });
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(5); }
}
function legacyNote(id = "legacy-note", comment = "Remember this"): PersistedNoteItem {
  return { id, messageId: "22222222-2222-4222-8222-222222222222", messageExcerpt: "Set latency budgets for each request stage.", quote: "latency budgets", comment, contextBefore: "Set ", contextAfter: " for each request stage.", startOffset: 4, endOffset: 19, createdAt: 1 };
}
async function createTab(options: { url?: string; legacy?: PersistedNoteItem[]; corruptLegacy?: boolean; before?: Tab["before"]; after?: Tab["after"]; wait?: boolean } = {}): Promise<Tab> {
  const tabUrl = options.url ?? url;
  const dom = new Window({ url: tabUrl });
  const doc = dom.document as unknown as Document;
  doc.write(fixture);
  Object.assign(dom, { Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise, URL, atob, parseFloat });
  Object.defineProperty(dom, "top", { value: {}, configurable: true });
  Object.defineProperty(dom.HTMLElement.prototype, "getClientRects", { value: () => [new dom.DOMRect(20, 30, 160, 20)], configurable: true });
  Object.defineProperties(dom.Range.prototype, {
    getBoundingClientRect: { value: () => new dom.DOMRect(20, 30, 160, 20), configurable: true },
    getClientRects: { value: () => [new dom.DOMRect(20, 30, 160, 20)], configurable: true },
  });
  const tab = { dom, doc, requests: [], listeners: [], before: options.before, after: options.after } as unknown as Tab;
  Object.assign(dom, { chrome: { runtime: {
    onMessage: { addListener(listener: (message: unknown) => void) { tab.listeners.push(listener); } },
    async sendMessage(request: AnnotationRequest) {
      tab.requests.push(request);
      if (request.key !== getAnnotationKey(dom.location.href)) throw new Error("Conversation changed before this save reached the worker");
      await tab.before?.(request);
      const result = await store.apply(request);
      if (result.changed) queueMicrotask(() => {
        for (const other of tabs) if (getAnnotationKey(other.dom.location.href) === request.key) {
          other.listeners.forEach(listener => listener({ type: ANNOTATION_CHANGED_TYPE, key: request.key, revision: result.revision }));
        }
      });
      await tab.after?.(request);
      return { ok: true, ...result };
    },
  } } });
  if (options.legacy) dom.localStorage.setItem(`${prefix}${tabUrl}`, JSON.stringify(options.legacy));
  if (options.corruptLegacy) dom.localStorage.setItem(`${prefix}${tabUrl}`, "not valid JSON");
  tab.helpers = runInContext(`const __PLANNOTATOR_DEV__=false, __PLANNOTATOR_BUILD_ID__="test", __PLANNOTATOR_DEV_ORIGIN__=""; ${source}\nglobalThis.__annotationTest;`, dom) as Helpers;
  tabs.push(tab);
  tab.helpers.bootstrap();
  tab.shadow = doc.getElementById("plannotator-chatgpt-root")!.shadowRoot!;
  if (options.wait !== false) await waitFor(() => !getAnnotationKey(tabUrl) || tab.helpers.getSession().loaded || Boolean(tab.helpers.getSession().error), "initial load");
  return tab;
}
function commit(tab: Tab, comment: string): string {
  const p = tab.doc.querySelector("[data-chatgpt-selection-message-id='22222222-2222-4222-8222-222222222222'] p")!;
  const range = tab.doc.createRange(); range.setStart(p.firstChild!, 4); range.setEnd(p.firstChild!, 19);
  const selection = tab.doc.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  tab.helpers.state.selectionDraft = tab.helpers.getSelectionDraft();
  tab.helpers.state.draftText = comment;
  tab.helpers.commitDraftNote();
  return tab.helpers.getNotes().find(note => note.comment === comment)!.id;
}
async function saved(target = url): Promise<PersistedNoteItem[]> {
  return (await store.apply({ type: ANNOTATION_MESSAGE_TYPE, key: getAnnotationKey(target)!, action: "read" })).notes;
}
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("durable annotation UI", () => {
  test("a migrated note without saved offsets clears after successful transfer", async () => {
    const legacy = legacyNote("legacy-no-offsets", "Migrated reply should clear");
    delete legacy.startOffset; delete legacy.endOffset;
    const tab = await createTab({ legacy: [legacy] });
    await tab.helpers.insertPrompt(tab.helpers.getUi()); await tab.helpers.flush();
    expect(tab.doc.querySelector("[data-composer-markdown]")!.textContent).toContain("Migrated reply should clear");
    expect(await saved()).toHaveLength(0);
    expect(tab.helpers.getNotes()).toHaveLength(0);
  });

  test("a note restored from an older provider message identity clears after transfer", async () => {
    const legacy = { ...legacyNote("legacy-old-id", "Restored reply should clear"), messageId: "old-provider-message-id" };
    const tab = await createTab({ legacy: [legacy] });
    await tab.helpers.insertPrompt(tab.helpers.getUi()); await tab.helpers.flush();
    expect(tab.doc.querySelector("[data-composer-markdown]")!.textContent).toContain("Restored reply should clear");
    expect(await saved()).toHaveLength(0);
    expect(tab.helpers.getNotes()).toHaveLength(0);
  });

  test("immediate insertion consumes an edited reply before its debounced save", async () => {
    const tab = await createTab();
    const id = commit(tab, "Stored original reply"); await tab.helpers.flush();
    tab.helpers.updateNote(id, { comment: "Edited reply transferred immediately" });
    await tab.helpers.insertPrompt(tab.helpers.getUi()); await tab.helpers.flush();
    expect(tab.doc.querySelector("[data-composer-markdown]")!.textContent).toContain("Edited reply transferred immediately");
    expect(await saved()).toHaveLength(0);
    expect(tab.helpers.getNotes()).toHaveLength(0);
  });

  test.each([
    "https://chatgpt.com/",
    "https://claude.ai/new",
    "https://gemini.google.com/app",
    "https://chatgpt.com/?temporary-chat=true",
    "https://chatgpt.com/c/local-chatgpt:6341be97-9b4b-4f15-9b59-d712842d154b",
  ])("empty keyless page %s has no save failure, toolbar or invalid storage request", async home => {
    const tab = await createTab({ url: home });
    expect(getAnnotationKey(home)).toBeNull();
    await tab.helpers.refresh();
    await tab.helpers.flush();
    expect(tab.requests).toHaveLength(0);
    expect(tab.helpers.getSession().loaded).toBe(false);
    expect(tab.helpers.getSession().error).toBe("");
    expect(tab.shadow.querySelector("[role='alert']")).toBeNull();
    expect(tab.shadow.querySelector(".notes-toolbar")).toBeNull();
    expect(tab.shadow.querySelector("[data-action='insert-notes']")).toBeNull();
    const leaving = new tab.dom.Event("beforeunload", { cancelable: true });
    tab.dom.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });

  test("home-to-saved transition reads that conversation and retains actual storage failures", async () => {
    await store.apply({ type: ANNOTATION_MESSAGE_TYPE, key: getAnnotationKey(url)!, action: "upsert", notes: [legacyNote()] });
    const tab = await createTab({ url: "https://chatgpt.com/" });
    expect(tab.requests).toHaveLength(0);
    tab.dom.history.pushState({}, "", url);
    tab.helpers.syncAnnotationRoute(tab.helpers.getUi());
    await waitFor(() => tab.helpers.getSession().loaded, "saved conversation read");
    expect(tab.requests[0]?.action).toBe("read");
    expect(tab.requests[0]?.key).toBe(getAnnotationKey(url)!);
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Remember this");
    tab.before = request => { if (request.action === "upsert") throw new Error("Real storage failure"); };
    commit(tab, "Actually unsaved");
    await waitFor(() => tab.helpers.getSession().error.includes("Real storage failure"), "actual failure retained");
    expect(tab.shadow.querySelector("[role='alert']")?.textContent).toContain("Notes not saved");
    expect(tab.helpers.getSession().pending.size).toBe(1);
  });

  test("real notes on a keyless page remain pending with accurate guidance and leave protection", async () => {
    const tab = await createTab({ url: "https://chatgpt.com/?temporary-chat=true" });
    const id = commit(tab, "Keep this temporary conversation note");
    await tab.helpers.flush();
    expect(tab.requests).toHaveLength(0);
    expect(tab.helpers.getSession().loaded).toBe(false);
    expect(tab.helpers.getSession().pending.size).toBe(1);
    expect(tab.helpers.getNotes().find(note => note.id === id)?.comment).toBe("Keep this temporary conversation note");
    expect(tab.shadow.querySelector("[role='alert']")?.textContent).toContain("not saved in extension storage");
    const leaving = new tab.dom.Event("beforeunload", { cancelable: true });
    tab.dom.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  test.each(["https://chatgpt.com/", "https://claude.ai/new", "https://gemini.google.com/app"])("keyless legacy notes on %s remain visible with their original copy intact", async home => {
    const legacy = [legacyNote()];
    const tab = await createTab({ url: home, legacy });
    await tab.helpers.refresh();
    expect(tab.requests).toHaveLength(0);
    expect(tab.helpers.getSession().loaded).toBe(false);
    expect(tab.helpers.getNotes()).toEqual(legacy);
    expect(tab.dom.localStorage.getItem(`${prefix}${home}`)).toBe(JSON.stringify(legacy));
    expect(tab.shadow.querySelector("[role='alert']")?.textContent).toContain("not saved in extension storage");
    tab.shadow.querySelector<HTMLButtonElement>("[data-action='toggle-notes-menu']")!.click();
    expect(tab.shadow.querySelector(".notes-menu")?.textContent).toContain("Remember this");
    const leaving = new tab.dom.Event("beforeunload", { cancelable: true });
    tab.dom.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  test("failed writes retain note text, warn before leaving, and retry without site storage writes", async () => {
    let fail = true;
    const tab = await createTab({ before(request) { if (request.action === "upsert" && fail) throw new Error("Storage full"); } });
    tab.dom.localStorage.setItem = () => { throw new Error("New site-local writes are forbidden"); };
    commit(tab, "Keep my unsaved note");
    await waitFor(() => tab.helpers.getSession().error.includes("Storage full"), "visible failure");
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Keep my unsaved note");
    expect(await saved()).toHaveLength(0);
    expect(tab.shadow.querySelector("[role='alert']")?.textContent).toContain("Notes not saved");
    const leaving = new tab.dom.Event("beforeunload", { cancelable: true });
    tab.dom.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    fail = false;
    tab.shadow.querySelector<HTMLButtonElement>("[data-action='retry-notes']")!.click();
    await waitFor(() => tab.helpers.getSession().pending.size === 0, "retry acknowledgement");
    expect((await saved())[0]?.comment).toBe("Keep my unsaved note");
    expect(tab.shadow.textContent).not.toContain("Notes not saved");
  });

  test("lost write acknowledgement is visibly unsaved and retries the same note ID", async () => {
    let lose = true;
    const tab = await createTab({ after(request) { if (request.action === "upsert" && lose) { lose = false; throw new Error("Extension context invalidated"); } } });
    const id = commit(tab, "A committed save with a lost reply");
    await waitFor(() => Boolean(tab.helpers.getSession().error), "lost reply error");
    expect(await saved()).toHaveLength(1);
    expect(tab.helpers.getSession().pending.size).toBe(1);
    await tab.helpers.retry();
    expect((await saved()).map(note => note.id)).toEqual([id]);
    expect(tab.helpers.getSession().pending.size).toBe(0);
  });

  test("legacy copies remain until import is confirmed and unresolved notes are retained", async () => {
    let fail = true;
    const unresolved = { ...legacyNote("unloaded-note"), messageId: "unloaded-assistant", messageExcerpt: "A missing response", quote: "Not currently loaded", contextBefore: "", contextAfter: "", startOffset: 0, endOffset: 20 };
    const legacy = [legacyNote(), unresolved];
    const tab = await createTab({ legacy, before(request) { if (request.action === "import" && fail) throw new Error("Import failed"); } });
    expect(tab.dom.localStorage.getItem(`${prefix}${url}`)).toBe(JSON.stringify(legacy));
    expect(tab.helpers.getNotes()).toHaveLength(2);
    fail = false; await tab.helpers.retry();
    expect(tab.dom.localStorage.getItem(`${prefix}${url}`)).toBeNull();
    expect(await saved()).toHaveLength(2);
    commit(tab, "A third note"); await tab.helpers.flush();
    expect((await saved()).map(note => note.id)).toContain("unloaded-note");
  });

  test("cross-tab additions merge and deleting one note preserves others including unloaded ones", async () => {
    const first = await createTab(); const second = await createTab();
    const a = commit(first, "From first tab"); const b = commit(second, "From second tab");
    await Promise.all([first.helpers.flush(), second.helpers.flush()]);
    await Promise.all([first.helpers.refresh(), second.helpers.refresh()]);
    expect(first.helpers.getNotes().map(note => note.id).sort()).toEqual([a, b].sort());
    expect(second.helpers.getNotes().map(note => note.id).sort()).toEqual([a, b].sort());
    first.helpers.deleteNote(a); await first.helpers.flush(); await second.helpers.refresh();
    expect((await saved()).map(note => note.id)).toEqual([b]);
    expect(second.helpers.getNotes().map(note => note.id)).toEqual([b]);
  });

  test("late save responses stay with their original route and cannot replace the new chat", async () => {
    const gate = deferred(); let entered = false;
    const tab = await createTab({ before(request) { if (request.action === "upsert") { entered = true; return gate.promise; } } });
    const id = commit(tab, "Original chat pending save");
    await waitFor(() => entered, "write sent before route change");
    const other = "https://chatgpt.com/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    tab.dom.history.pushState({}, "", other); tab.helpers.syncAnnotationRoute(tab.helpers.getUi());
    await waitFor(() => tab.helpers.getSession().loaded, "new route loaded");
    expect(tab.helpers.getNotes()).toHaveLength(0);
    gate.resolve(); await Bun.sleep(20);
    expect((await saved()).map(note => note.id)).toEqual([id]);
    expect(await saved(other)).toHaveLength(0);
    expect(tab.helpers.getNotes()).toHaveLength(0);
    tab.dom.history.pushState({}, "", url); tab.helpers.syncAnnotationRoute(tab.helpers.getUi());
    await waitFor(() => tab.helpers.getNotes().length === 1, "saved note restored on return");
    expect(tab.helpers.getNotes()[0]?.id).toBe(id);
  });

  test("a newer local edit survives an older save callback and cross-tab refresh", async () => {
    const gate = deferred(); let deferredOnce = false;
    const tab = await createTab({ after(request) { if (request.action === "upsert" && !deferredOnce) { deferredOnce = true; return gate.promise; } } });
    const id = commit(tab, "Original comment");
    await waitFor(() => deferredOnce, "first commit delayed reply");
    tab.helpers.updateNote(id, { comment: "Newer local edit" });
    await tab.helpers.refresh();
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Newer local edit");
    gate.resolve(); await tab.helpers.flush();
    expect((await saved())[0]?.comment).toBe("Newer local edit");
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Newer local edit");
  });

  test("an older acknowledgement removes its overlay without hiding a newer persisted edit", async () => {
    const gate = deferred(); let held = false;
    const tab = await createTab({ after(request) { if (request.action === "upsert" && !held) { held = true; return gate.promise; } } });
    const id = commit(tab, "First version");
    await waitFor(() => held, "first reply held");
    const original = (await saved())[0]!;
    await store.apply({ type: ANNOTATION_MESSAGE_TYPE, key: getAnnotationKey(url)!, action: "upsert", notes: [{ ...original, comment: "Newer from another tab" }] });
    await tab.helpers.refresh();
    expect(tab.helpers.getNotes()[0]?.comment).toBe("First version");
    gate.resolve(); await tab.helpers.flush();
    expect(tab.helpers.getSession().pending.size).toBe(0);
    expect(tab.helpers.getNotes().find(note => note.id === id)?.comment).toBe("Newer from another tab");
  });

  test("corrupt legacy data does not hide durable notes or permanently block retry", async () => {
    await store.apply({ type: ANNOTATION_MESSAGE_TYPE, key: getAnnotationKey(url)!, action: "upsert", notes: [legacyNote("durable-note", "Already durable")] });
    const tab = await createTab({ corruptLegacy: true });
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Already durable");
    expect(tab.helpers.getSession().migrationError).toContain("could not be imported");
    expect(tab.helpers.getSession().loading).toBeNull();
    expect(tab.dom.localStorage.getItem(`${prefix}${url}`)).toBe("not valid JSON");
    tab.dom.localStorage.setItem(`${prefix}${url}`, JSON.stringify([legacyNote()]));
    await tab.helpers.retry();
    expect(await saved()).toHaveLength(2);
    expect(tab.helpers.getSession().migrationError).toBe("");
    expect(tab.dom.localStorage.getItem(`${prefix}${url}`)).toBeNull();
  });

  test("a route change immediately rejects stale insertion and preserves an unfinished note draft", async () => {
    const tab = await createTab(); commit(tab, "Previous conversation note"); await tab.helpers.flush();
    const p = tab.doc.querySelector("[data-chatgpt-selection-message-id='22222222-2222-4222-8222-222222222222'] p")!;
    const range = tab.doc.createRange(); range.setStart(p.firstChild!, 4); range.setEnd(p.firstChild!, 19);
    tab.doc.getSelection()!.addRange(range);
    tab.helpers.state.selectionDraft = tab.helpers.getSelectionDraft();
    tab.helpers.state.draftText = "Uncommitted text stays with the original chat";
    tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(tab.doc.querySelector("[data-composer-markdown]")?.textContent?.trim()).toBe("");
    expect(tab.helpers.getNotes()).toHaveLength(0);
    expect(tab.shadow.textContent).toContain("Notes in another chat are not saved");
    tab.dom.history.pushState({}, "", url); tab.helpers.syncAnnotationRoute(tab.helpers.getUi());
    expect(tab.helpers.state.draftText).toBe("Uncommitted text stays with the original chat");
    expect(tab.helpers.state.selectionDraft).not.toBeNull();
  });

  test("successful blue-arrow transfer consumes the reply batch so the next batch contains only new replies", async () => {
    const tab = await createTab();
    commit(tab, "Reply batch ONE"); await tab.helpers.flush();
    const composer = tab.doc.querySelector<HTMLElement>("[data-composer-markdown]")!;
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(composer.textContent).toContain("Reply batch ONE");
    await tab.helpers.flush();
    expect(tab.helpers.getNotes()).toHaveLength(0);
    expect(await saved()).toHaveLength(0);
    composer.textContent = "";
    commit(tab, "Reply batch TWO"); await tab.helpers.flush();
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(composer.textContent).toContain("Reply batch TWO");
    expect(composer.textContent).not.toContain("Reply batch ONE");
  });

  test("blocked insertion protects notes and native sends do not clear a newer untransferred batch", async () => {
    const tab = await createTab(); const id = commit(tab, "Persistent instruction"); await tab.helpers.flush();
    const composer = tab.doc.querySelector<HTMLElement>("[data-composer-markdown]")!;
    composer.textContent = "Unrelated native draft";
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(composer.textContent).toBe("Unrelated native draft");
    expect(tab.shadow.textContent).toContain("Send or clear the current draft");
    expect(tab.helpers.getNotes().map(note => note.id)).toEqual([id]);
    composer.textContent = ""; await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(composer.textContent).toContain("Persistent instruction");
    await tab.helpers.flush();
    expect(tab.helpers.getNotes()).toHaveLength(0);
    const newerId = commit(tab, "Keep this new untransferred reply"); await tab.helpers.flush();
    tab.doc.querySelector<HTMLButtonElement>("#composer-submit-button")?.click();
    composer.dispatchEvent(new tab.dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }) as unknown as Event);
    tab.doc.dispatchEvent(new tab.dom.Event("submit", { bubbles: true }) as unknown as Event);
    await Bun.sleep(120);
    expect(tab.helpers.getNotes().map(note => note.id)).toEqual([newerId]);
    expect((await saved()).map(note => note.id)).toEqual([newerId]);
    tab.shadow.querySelector<HTMLButtonElement>("[data-action='toggle-notes-menu']")!.click();
    expect(tab.shadow.textContent).toContain("Notes clear after they are inserted into your message");
    tab.shadow.querySelector<HTMLButtonElement>("[aria-label='Delete note 1']")!.click();
    await tab.helpers.flush(); expect(await saved()).toHaveLength(0);
  });

  test("a rejected composer transfer keeps the exact saved reply batch", async () => {
    const tab = await createTab();
    const id = commit(tab, "Do not lose a failed insertion"); await tab.helpers.flush();
    const composer = tab.doc.querySelector<HTMLElement>("[data-composer-markdown]")!;
    composer.addEventListener("beforeinput", event => event.preventDefault());
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(composer.textContent).toBe("");
    expect(tab.shadow.textContent).toContain("Could not insert notes");
    expect((await saved()).map(note => note.id)).toEqual([id]);
    expect(tab.helpers.getNotes().map(note => note.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "consume")).toHaveLength(0);
  });

  test("only transferred notes clear while an unresolved saved note remains", async () => {
    const unresolved = { ...legacyNote("unresolved", "Keep this unloaded note"), messageId: "missing-message", quote: "A quote absent from the transcript", messageExcerpt: "Missing response", contextBefore: "", contextAfter: "" };
    const tab = await createTab({ legacy: [legacyNote("visible", "Transfer this reply"), unresolved] });
    await tab.helpers.insertPrompt(tab.helpers.getUi()); await tab.helpers.flush();
    expect(tab.doc.querySelector("[data-composer-markdown]")!.textContent).toContain("Transfer this reply");
    expect(tab.doc.querySelector("[data-composer-markdown]")!.textContent).not.toContain("Keep this unloaded note");
    expect(tab.helpers.getNotes()).toEqual([unresolved]);
    expect(await saved()).toEqual([unresolved]);
  });

  test("a newer local edit and added reply survive an in-flight transfer snapshot", async () => {
    const tab = await createTab();
    const id = commit(tab, "Original snapshot reply"); await tab.helpers.flush();
    const inserting = tab.helpers.insertPrompt(tab.helpers.getUi());
    tab.helpers.updateNote(id, { comment: "Newer local edit" });
    const added = commit(tab, "Added after insertion began");
    await inserting; await tab.helpers.flush();
    const prompt = tab.doc.querySelector("[data-composer-markdown]")!.textContent;
    expect(prompt).toContain("Original snapshot reply");
    expect(prompt).not.toContain("Newer local edit");
    expect(prompt).not.toContain("Added after insertion began");
    expect((await saved()).map(note => [note.id, note.comment])).toEqual([[id, "Newer local edit"], [added, "Added after insertion began"]]);
    expect(tab.helpers.getNotes()).toHaveLength(2);
  });

  test.each([false, true])("conditional consumption preserves a newer durable edit from another tab after pending edit %s", async editBeforeTransfer => {
    const gate = deferred(); let entered = false;
    const tab = await createTab({ before(request) { if (request.action === "consume") { entered = true; return gate.promise; } } });
    const id = commit(tab, "Transferred old revision"); await tab.helpers.flush();
    if (editBeforeTransfer) tab.helpers.updateNote(id, { comment: "Transferred edited revision" });
    const original = (await saved())[0]!;
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    await waitFor(() => entered, "conditional consume request");
    await store.apply({ type: ANNOTATION_MESSAGE_TYPE, key: getAnnotationKey(url)!, action: "upsert", notes: [{ ...original, comment: "Newer remote revision" }] });
    await tab.helpers.refresh();
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Newer remote revision");
    gate.resolve(); await tab.helpers.flush();
    expect((await saved()).map(note => [note.id, note.comment])).toEqual([[id, "Newer remote revision"]]);
    expect(tab.helpers.getNotes()[0]?.comment).toBe("Newer remote revision");
    expect(tab.requests.filter(request => request.action === "upsert")).toHaveLength(editBeforeTransfer ? 2 : 1);
  });

  test.each(["before commit", "lost reply"] as const)("consumption retains a failed preceding edit %s and retries it before cleanup", async failure => {
    let fail = false;
    const reject = (request: AnnotationRequest) => { if (request.action === "upsert" && fail) throw new Error("Edit save temporarily unavailable"); };
    const tab = await createTab(failure === "before commit" ? { before: reject } : { after: reject });
    const id = commit(tab, "Older saved reply"); await tab.helpers.flush();
    fail = true;
    tab.helpers.updateNote(id, { comment: "Edited reply transferred once" }); await tab.helpers.flush();
    await tab.helpers.insertPrompt(tab.helpers.getUi()); await tab.helpers.flush();
    const composer = tab.doc.querySelector("[data-composer-markdown]")!;
    const prompt = composer.textContent;
    expect(prompt).toContain("Edited reply transferred once");
    expect(tab.helpers.getNotes()).toHaveLength(0);
    expect(tab.helpers.getSession().pending.size).toBe(1);
    expect(tab.helpers.getSession().error).toContain("Edit save temporarily unavailable");
    expect(tab.requests.filter(request => request.action === "consume")).toHaveLength(0);
    fail = false; await tab.helpers.retry();
    expect(await saved()).toHaveLength(0);
    expect(tab.helpers.getNotes()).toHaveLength(0);
    expect(tab.helpers.getSession().pending.size).toBe(0);
    expect(composer.textContent).toBe(prompt);
    expect(tab.requests.filter(request => request.action === "consume")).toHaveLength(1);
  });

  test.each(["before commit", "lost reply"] as const)("a cleanup failure %s keeps the transferred composer text and retries only consumption", async failure => {
    let fail = true;
    const reject = (request: AnnotationRequest) => { if (request.action === "consume" && fail) throw new Error("Cleanup temporarily unavailable"); };
    const tab = await createTab(failure === "before commit" ? { before: reject } : { after: reject });
    commit(tab, "Already transferred once"); await tab.helpers.flush();
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    await waitFor(() => tab.helpers.getSession().error.includes("Cleanup temporarily unavailable"), "cleanup failure visible");
    const composer = tab.doc.querySelector("[data-composer-markdown]")!;
    const prompt = composer.textContent;
    expect(prompt).toContain("Already transferred once");
    expect(tab.helpers.getNotes()).toHaveLength(0);
    expect(tab.helpers.getSession().pending.size).toBe(1);
    expect(tab.shadow.querySelector("[role='alert']")?.textContent).toContain("Cleanup temporarily unavailable");
    fail = false; await tab.helpers.retry();
    expect(await saved()).toHaveLength(0);
    expect(tab.helpers.getSession().pending.size).toBe(0);
    expect(composer.textContent).toBe(prompt);
    expect(tab.requests.filter(request => request.action === "upsert")).toHaveLength(1);
  });

  test("consumption follows an in-flight save without restoring the transferred note", async () => {
    const gate = deferred(); let entered = false;
    const tab = await createTab({ before(request) { if (request.action === "upsert") { entered = true; return gate.promise; } } });
    commit(tab, "Transfer while its initial save is pending");
    await waitFor(() => entered, "initial save in flight");
    await tab.helpers.insertPrompt(tab.helpers.getUi());
    expect(tab.helpers.getNotes()).toHaveLength(0);
    gate.resolve(); await tab.helpers.flush();
    expect(tab.helpers.getNotes()).toHaveLength(0);
    expect(await saved()).toHaveLength(0);
    expect(tab.helpers.getSession().pending.size).toBe(0);
  });

  test("a route change during insertion does not consume the original batch", async () => {
    const tab = await createTab(); const id = commit(tab, "Original route batch"); await tab.helpers.flush();
    const inserting = tab.helpers.insertPrompt(tab.helpers.getUi());
    tab.dom.history.pushState({}, "", "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    tab.helpers.syncAnnotationRoute(tab.helpers.getUi());
    await inserting;
    expect(tab.doc.querySelector("[data-composer-markdown]")!.textContent).toBe("");
    expect((await saved()).map(note => note.id)).toEqual([id]);
    expect(tab.requests.filter(request => request.action === "consume")).toHaveLength(0);
  });
});

import { EncryptedRecordStore } from "../src/encrypted-storage";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  ANNOTATION_CHANGED_TYPE, ANNOTATION_MAX_TEXT, ANNOTATION_MAX_TOMBSTONES,
  ANNOTATION_MESSAGE_TYPE, AnnotationStore, getAnnotationKey,
  type AnnotationRequest, type AnnotationResponse, type PersistedNoteItem,
} from "../src/annotation-store";
import { registerAnnotationWorker, type QueueChrome } from "../src/queue-worker";

const key = "chatgpt:conversation-a";
let factory: IDBFactory;
let stores: AnnotationStore[];
let store: AnnotationStore;
beforeEach(() => { factory = new IDBFactory(); stores = []; store = newStore(); });
afterEach(async () => { await Promise.all(stores.map(entry => entry.close())); });
function newStore(): AnnotationStore {
  const result = new AnnotationStore(factory, "test-annotations");
  stores.push(result);
  return result;
}
function note(id = "note-a", changes: Partial<PersistedNoteItem> = {}): PersistedNoteItem {
  return { id, messageId: "assistant-message", messageExcerpt: "An answer", quote: "selected words",
    comment: "my comment", contextBefore: "before", contextAfter: "after", startOffset: 1, endOffset: 15,
    createdAt: 100, ...changes };
}
function request(action: AnnotationRequest["action"], extras: Partial<AnnotationRequest> = {}): AnnotationRequest {
  return { type: ANNOTATION_MESSAGE_TYPE, key, action, ...extras };
}
function save(notes: PersistedNoteItem[], target = store) { return target.apply(request("upsert", { notes })); }
function read(target = store) { return target.apply(request("read")); }

describe("durable annotation storage", () => {
  test.each([
    ["https://chatgpt.com/c/shared?model=x", "chatgpt:shared"],
    ["https://chatgpt.com/g/project/c/shared", "chatgpt:shared"],
    ["https://claude.ai/chat/shared/", "claude:shared"],
    ["https://gemini.google.com/app/shared#response", "gemini:shared"],
    ["http://localhost:19900/queue-harness.html?tab=2", "fixture:http://localhost:19900/queue-harness.html"],
  ])("uses stable isolated conversation key for %s", (url, expected) => expect(getAnnotationKey(url!)).toBe(expected));

  test.each([
    "https://chatgpt.com/", "https://claude.ai/new", "https://gemini.google.com/app",
    "http://chatgpt.com/c/a", "https://chatgpt.com:444/c/a", "https://claude.ai:444/chat/a",
    "https://gemini.google.com.evil.example/app/a", "https://user:secret@chatgpt.com/c/a", "invalid",
  ])("rejects unsupported origins and unsaved conversations: %s", url => expect(getAnnotationKey(url)).toBeNull());

  test("retains full notes and edits after all connections close", async () => {
    await save([note("a"), note("b")]);
    await save([note("a", { comment: "edited" })]);
    await store.close();
    const persisted = await read(newStore());
    expect(persisted.notes).toEqual([note("a", { comment: "edited" }), note("b")]);
    expect(persisted.revision).toBe(2);
    expect(persisted.changed).toBe(false);
  });

  test("same conversation and note IDs remain isolated across providers", async () => {
    for (const provider of ["chatgpt", "claude", "gemini"]) {
      await store.apply(request("upsert", { key: `${provider}:same-id`, notes: [note("same-note", { comment: provider })] }));
    }
    await store.close();
    const reopened = newStore();
    for (const provider of ["chatgpt", "claude", "gemini"]) {
      const result = await reopened.apply(request("read", { key: `${provider}:same-id` }));
      expect(result.notes[0]?.comment).toBe(provider);
    }
  });

  test("concurrent connections preserve independent creates and edits", async () => {
    const other = newStore();
    await Promise.all(Array.from({ length: 30 }, (_, i) => save([note(`note-${i}`)], i % 2 ? store : other)));
    await Promise.all([
      save([note("note-0", { comment: "edit from one tab" })]),
      save([note("note-1", { comment: "edit from another tab" })], other),
    ]);
    const result = await read();
    expect(result.notes).toHaveLength(30);
    expect(result.notes.find(entry => entry.id === "note-0")?.comment).toBe("edit from one tab");
    expect(result.notes.find(entry => entry.id === "note-1")?.comment).toBe("edit from another tab");
    expect(result.revision).toBe(32);
  });

  test("idempotent save and delete retries do not create extra changes", async () => {
    expect((await save([note()])).revision).toBe(1);
    expect(await save([note()])).toMatchObject({ revision: 1, changed: false });
    const remove = request("remove", { ids: ["note-a", "note-a"] });
    expect(await store.apply(remove)).toMatchObject({ notes: [], revision: 2, changed: true });
    expect(await store.apply(remove)).toMatchObject({ notes: [], revision: 2, changed: false });
    await store.close();
    expect((await read(newStore())).notes).toEqual([]);
  });

  test("legacy import merges missing notes while keeping saved edits and deletions", async () => {
    await save([note("existing", { comment: "new extension edit" }), note("deleted")]);
    await store.apply(request("remove", { ids: ["deleted"] }));
    const legacy = request("import", { notes: [note("existing", { comment: "old site copy" }), note("deleted"), note("legacy-only")] });
    const imported = await store.apply(legacy);
    expect(imported.notes).toEqual([note("existing", { comment: "new extension edit" }), note("legacy-only")]);
    expect(imported.revision).toBe(3);
    expect(await newStore().apply(legacy)).toMatchObject({ notes: imported.notes, revision: 3, changed: false });
  });

  test("a stale save cannot resurrect a note deleted in another tab", async () => {
    await save([note()]);
    await newStore().apply(request("remove", { ids: ["note-a"] }));
    await expect(save([note("note-a", { comment: "stale local edit" })])).rejects.toThrow("removed in another tab");
    expect((await read()).notes).toEqual([]);
  });

  test("removing a not-yet-saved ID wins a racing stale creation", async () => {
    await newStore().apply(request("remove", { ids: ["pending-note"] }));
    await expect(save([note("pending-note")])).rejects.toThrow("removed in another tab");
    expect((await store.apply(request("import", { notes: [note("pending-note")] }))).notes).toEqual([]);
  });

  test("bounded tombstones do not let very old imports resurrect compacted deletions", async () => {
    await save([note("old-deleted", { createdAt: 10 }), note("kept")]);
    await store.apply(request("remove", { ids: ["old-deleted"] }), 1_000);
    for (let offset = 0; offset < ANNOTATION_MAX_TOMBSTONES; offset += 500) {
      await store.apply(request("remove", { ids: Array.from({ length: 500 }, (_, index) => `deleted-${offset + index}`) }), 1_000);
    }
    const raw = await rawDocument();
    expect(raw.tombstones).toHaveLength(ANNOTATION_MAX_TOMBSTONES);
    expect(raw.retiredBefore).toBe(10);
    expect(raw.tombstones[0]).toEqual({ id: "deleted-0", createdAt: 1_000 });
    await expect(store.apply(request("import", { notes: [note("old-deleted", { createdAt: 10 })] }))).rejects.toThrow("older annotations");
    await save([note("new", { createdAt: 2_000 }), note("kept", { comment: "existing note can still be edited" })]);
    expect((await read()).notes.map(entry => entry.id)).toEqual(["kept", "new"]);
  });

  test("requests strict durability and responds only after transaction completion", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    let durability: IDBTransactionDurability | undefined;
    let completed = false;
    try {
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
        durability = this.transaction.durability;
        this.transaction.addEventListener("complete", () => { completed = true; });
        return originalPut.apply(this, args);
      };
      const result = await save([note()]);
      expect(result.changed).toBe(true);
      expect(durability).toBe("strict");
      expect(completed).toBe(true);
    } finally { IDBObjectStore.prototype.put = originalPut; }
  });

  test("failed write rejects without losing previously committed notes", async () => {
    await save([note("existing")]);
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function () { throw new DOMException("Disk quota exhausted", "QuotaExceededError"); };
      await expect(save([note("new")])).rejects.toThrow("Disk quota exhausted");
    } finally { IDBObjectStore.prototype.put = originalPut; }
    expect(await read()).toMatchObject({ notes: [note("existing")], revision: 1 });
    expect((await save([note("new")])).notes).toHaveLength(2);
  });

  test("a transient database open error does not poison all future retries", async () => {
    const originalOpen = factory.open;
    try {
      factory.open = () => { throw new DOMException("Storage temporarily unavailable", "SecurityError"); };
      await expect(save([note()])).rejects.toThrow("temporarily unavailable");
    } finally { factory.open = originalOpen; }
    expect(await save([note()])).toMatchObject({ notes: [note()], revision: 1 });
  });

  test("transaction abort after a successful put cannot acknowledge the save", async () => {
    await save([note("existing")]);
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
        const result = originalPut.apply(this, args);
        this.transaction.abort();
        return result;
      };
      await expect(save([note("new")])).rejects.toThrow();
    } finally { IDBObjectStore.prototype.put = originalPut; }
    expect(await read()).toMatchObject({ notes: [note("existing")], revision: 1 });
  });

  test("invalid and oversized records reject atomically", async () => {
    await save([note("existing")]);
    for (const invalid of [
      note("bad id"), note("bad", { comment: "x".repeat(ANNOTATION_MAX_TEXT + 1) }),
      note("bad", { startOffset: -1 }), note("bad", { startOffset: 20, endOffset: 10 }),
      note("bad", { createdAt: NaN }),
    ]) await expect(save([note("valid"), invalid])).rejects.toThrow();
    expect((await read()).notes).toEqual([note("existing")]);
  });
});

async function rawDocument(): Promise<{ tombstones: Array<{ id: string; createdAt: number }>; retiredBefore?: number }> {
  const inspector = new EncryptedRecordStore<{ key: string; tombstones: Array<{ id: string; createdAt: number }>; retiredBefore?: number }>(factory, "test-annotations", "annotations");
  try {
    return await inspector.apply(key, () => { throw new Error("Missing annotation fixture"); }, value => ({ value, result: value, changed: false }));
  } finally { await inspector.close(); }
}

type Listener = Parameters<NonNullable<QueueChrome["runtime"]>["onMessage"]["addListener"]>[0];
type Sender = Parameters<Listener>[1];
function sender(url = "https://chatgpt.com/c/conversation-a", tab = 1): Sender { return { tab: { id: tab, url }, url, frameId: 0 }; }
function worker() {
  let listener: Listener | undefined;
  const notifications: Array<{ tab: number; message: unknown; options: unknown }> = [];
  registerAnnotationWorker({ runtime: { onMessage: { addListener: value => { listener = value; } } },
    tabs: { sendMessage: async (tab, message, options) => { notifications.push({ tab, message, options }); } },
  }, store);
  const send = (source: Sender, message: unknown) => new Promise<AnnotationResponse | undefined>(resolve => {
    const pending = listener!(message, source, response => resolve(response as AnnotationResponse));
    if (!pending) resolve(undefined);
  });
  return { send, notifications };
}

describe("annotation worker protocol", () => {
  test("returns durable snapshots and only notifies tabs subscribed to the same conversation", async () => {
    const { send, notifications } = worker();
    await send(sender(undefined, 1), request("read"));
    await send(sender(undefined, 2), request("read"));
    await send(sender("https://claude.ai/chat/other", 3), request("read", { key: "claude:other" }));
    expect(await send(sender(), request("upsert", { notes: [note()] }))).toEqual({ ok: true, notes: [note()], revision: 1 });
    expect(notifications).toEqual([1, 2].map(tab => ({ tab, message: { type: ANNOTATION_CHANGED_TYPE, key, revision: 1 }, options: { frameId: 0 } })));
    await send(sender(), request("upsert", { notes: [note()] }));
    expect(notifications).toHaveLength(2);
    await store.close();
    expect((await read(newStore())).notes).toEqual([note()]);
  });

  test.each([
    {}, { ...sender(), frameId: 2 }, { ...sender(), frameId: undefined }, { ...sender(), tab: { id: -1 } },
    sender("https://example.com/c/conversation-a"), sender("https://chatgpt.com:444/c/conversation-a"),
    { ...sender(), tab: { id: 1, url: "https://chatgpt.com/c/other" } },
    { ...sender(), url: "https://claude.ai/chat/conversation-a" }, { ...sender(), url: undefined },
  ] satisfies Sender[])("rejects a nonmatching or non-top-level sender %#", async source => {
    const { send, notifications } = worker();
    expect(await send(source, request("upsert", { notes: [note()] }))).toEqual({ ok: false, error: "Annotation conversation does not match the current top-level tab" });
    expect(notifications).toEqual([]);
    expect((await read()).notes).toEqual([]);
  });

  test("supports same-origin SPA navigation and sender URL fallback without tabs permission", async () => {
    const { send } = worker();
    expect(await send({ ...sender(), url: "https://chatgpt.com/" }, request("read"))).toEqual({ ok: true, notes: [], revision: 0 });
    expect(await send({ ...sender(), tab: { id: 1 } }, request("read"))).toEqual({ ok: true, notes: [], revision: 0 });
  });

  test("failed storage responds explicitly and never broadcasts a successful save", async () => {
    const { send, notifications } = worker();
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function () { throw new Error("Storage unavailable"); };
      expect(await send(sender(), request("upsert", { notes: [note()] }))).toEqual({ ok: false, error: "Storage unavailable" });
    } finally { IDBObjectStore.prototype.put = originalPut; }
    expect(notifications).toEqual([]);
  });

  test("ignores unrelated messages", async () => {
    const { send } = worker();
    expect(await send(sender(), { type: "plannotator:queue" })).toBeUndefined();
    expect(await send(sender(), null)).toBeUndefined();
  });
});

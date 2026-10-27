import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { getQueueKey, QUEUE_BUSY_MS, QUEUE_CLAIM_MS, QUEUE_EDIT_MS, QUEUE_MAX_DRAFTS, QUEUE_MAX_TEXT, QUEUE_MESSAGE_TYPE, QUEUE_SEND_TIMEOUT_MS, QueueStore, type QueueAction, type QueueRequest } from "../src/queue-store";
import type { ConversationAlias } from "../src/chatgpt-dom";
import { EncryptedRecordStore } from "../src/encrypted-storage";

let factory: IDBFactory;
let stores: QueueStore[];
let store: QueueStore;
const key = "chatgpt:conversation-a";
const ownerA = "1:client-a";
const ownerB = "2:client-b";
const start = 1_000_000;

beforeEach(() => {
  factory = new IDBFactory();
  stores = [];
  store = newStore();
});
afterEach(async () => { await Promise.all(stores.map((entry) => entry.close())); });
function newStore(): QueueStore {
  const result = new QueueStore(factory, "test-queue");
  stores.push(result);
  return result;
}
function request(action: QueueAction, extras: Partial<QueueRequest> = {}): QueueRequest {
  return { type: QUEUE_MESSAGE_TYPE, key, clientId: "client-a", action, ...extras };
}
function enqueue(id: string, text = id, target = store, now = start) {
  return target.apply(request("enqueue", { id, text }), ownerA, now);
}
function read(target = store, now = start) { return target.apply(request("read"), ownerA, now); }
const identityKey = "chatgpt:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function witness(index = 1): ConversationAlias {
  return { routeKey: identityKey, localId: `local-chatgpt:cccccccc-cccc-4ccc-8ccc-${index.toString(16).padStart(12, "0")}`,
    firstUserId: "11111111-1111-4111-8111-111111111111" };
}

describe("durable composer draft journal", () => {
  const draft = { id: "draft-a", text: " \n  Working\r\nthrough\u00a0this\t ", revision: 1, updatedAt: start };
  const save = (revision = 1, text = draft.text, target = store, now = start) => target.apply(
    request("draft-save", { id: draft.id, text, draftRevision: revision }), ownerA, now,
  );

  test("exact draft whitespace survives encrypted restart and another tab can recover it", async () => {
    await enqueue("queued");
    await store.apply(request("pause", { paused: true }), ownerA, start);
    const saved = await save();
    expect(saved.state.drafts).toEqual([draft]);
    expect(saved.state.items.map(item => item.id)).toEqual(["queued"]);
    expect(saved.state.paused).toBe(true);
    await store.close();
    const reopened = newStore();
    expect((await read(reopened)).state).toEqual(saved.state);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("test-queue", 2);
      open.onsuccess = () => resolve(open.result as unknown as IDBDatabase);
      open.onerror = () => reject(open.error);
    });
    try {
      const raw = await new Promise<unknown[]>((resolve, reject) => {
        const transaction = database.transaction("encrypted-records", "readonly");
        const read = transaction.objectStore("encrypted-records").getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      expect(raw).toHaveLength(1);
      expect(JSON.stringify(raw)).not.toContain("Working");
      expect(raw[0]).toHaveProperty("ciphertext");
      expect(raw[0]).not.toHaveProperty("drafts");
    } finally { database.close(); }
    const recovered = await reopened.apply(request("draft-remove", { id: draft.id, draftRevision: 1 }), ownerB, start + 1);
    expect(recovered.state.drafts).toEqual([]);
    expect(recovered.state.items).toEqual(saved.state.items);
    expect(recovered.state.paused).toBe(true);
    expect("removedDraftRevisions" in recovered.state).toBe(false);
  });

  test("whitespace-only drafts and the exact text limit are preserved", async () => {
    for (const text of [" \r\n\t ", "x".repeat(QUEUE_MAX_TEXT)]) {
      const revision = (await read()).state.drafts?.[0]?.revision ?? 0;
      expect((await save(revision + 1, text)).state.drafts?.[0]?.text).toBe(text);
    }
  });

  test("empty draft revisions retire atomically across restart without stale text resurrection", async () => {
    await save(1, "Before buffered Enter");
    const retired = await save(2, "");
    expect(retired.state.drafts).toEqual([]);
    await store.close();
    const reopened = newStore();
    expect((await read(reopened)).state).toEqual(retired.state);
    for (const revision of [1, 2]) {
      const stale = await save(revision, "Before buffered Enter", reopened);
      expect(stale.changed).toBe(false);
      expect(stale.state).toEqual(retired.state);
    }
    expect((await save(3, "Typing after buffered Enter", reopened)).state.drafts?.[0]?.text).toBe("Typing after buffered Enter");
  });

  test("initial empty draft revisions do not consume recovery capacity", async () => {
    const empty = await save(1, "");
    expect(empty.state.drafts ?? []).toEqual([]);
    expect((await save(1, "stale same-revision text")).state).toEqual(empty.state);
    for (let index = 0; index < QUEUE_MAX_DRAFTS; index++) {
      await store.apply(request("draft-save", { id: `full-${index}`, text: `keep-${index}`, draftRevision: 1 }), ownerA, start);
    }
    const full = (await read()).state;
    const atCapacity = await store.apply(request("draft-save", { id: "empty-at-capacity", text: "", draftRevision: 1 }), ownerA, start);
    expect(atCapacity.state.drafts).toEqual(full.drafts);
    await expect(store.apply(request("draft-save", { id: "nonempty-at-capacity", text: "keep", draftRevision: 1 }), ownerA, start)).rejects.toThrow("drafts are full");
    const cleared = await store.apply(request("draft-save", { id: "full-0", text: "", draftRevision: 2 }), ownerA, start + 1);
    expect(cleared.state.drafts).toHaveLength(QUEUE_MAX_DRAFTS - 1);
    expect((await store.apply(request("draft-save", { id: "full-0", text: "keep-0", draftRevision: 1 }), ownerB, start + 2)).state).toEqual(cleared.state);
    expect((await store.apply(request("draft-save", { id: "new-draft", text: "keep", draftRevision: 1 }), ownerB, start + 3)).state.drafts).toHaveLength(QUEUE_MAX_DRAFTS);
  });

  test.each(["read", "heartbeat"] as const)("legacy empty drafts retire during %s without changing nonempty drafts or queue state", async action => {
    const retained = { ...draft, id: "retained" };
    const whitespace = { ...draft, id: "whitespace", text: " \n\t " };
    const legacy = { key, revision: 7, paused: true, items: [{ id: "queued", text: "keep queued", createdAt: start, status: "queued" as const }],
      lastCompletedUserMessageId: "completed-user", busyLeases: [],
      drafts: [{ ...draft, text: "", revision: 3 }, retained, whitespace] };
    const raw = new EncryptedRecordStore<typeof legacy>(factory, "test-queue", "queues");
    try {
      await raw.apply(key, () => legacy, value => ({ value, result: undefined, changed: true }));
      const recovered = await store.apply(request(action, { busy: false }), ownerA, start);
      expect(recovered.changed).toBe(true);
      expect(recovered.state.drafts).toEqual([retained, whitespace]);
      expect(recovered.state.items).toEqual(legacy.items);
      expect(recovered.state.paused).toBe(true);
      expect(recovered.state.lastCompletedUserMessageId).toBe(legacy.lastCompletedUserMessageId);
      await store.close();
      const reopened = newStore();
      expect((await save(2, "stale pre-clear draft", reopened)).state).toEqual(recovered.state);
      expect((await save(3, "stale cleared revision", reopened)).state).toEqual(recovered.state);
      expect((await read(reopened)).changed).toBe(false);
      expect((await save(4, "new typing survives recovery", reopened)).state.drafts?.find(entry => entry.id === draft.id)?.text).toBe("new typing survives recovery");
    } finally { await raw.close(); }
  });

  test("empty draft retirement and concurrent newer typing preserve the latest nonempty revision", async () => {
    const other = newStore();
    for (let index = 0; index < 8; index++) {
      const id = `empty-race-${index}`;
      await store.apply(request("draft-save", { id, text: "before", draftRevision: 1 }), ownerA, start);
      await Promise.all([
        store.apply(request("draft-save", { id, text: "", draftRevision: 2 }), ownerA, start + 1),
        other.apply(request("draft-save", { id, text: "new typing", draftRevision: 3 }), ownerB, start + 2),
      ]);
      expect((await read()).state.drafts?.find(entry => entry.id === id)).toEqual({ id, text: "new typing", revision: 3, updatedAt: start + 2 });
      const stale = await store.apply(request("draft-save", { id, text: "", draftRevision: 2 }), ownerA, start + 3);
      expect(stale.changed).toBe(false);
      expect(stale.state.drafts?.find(entry => entry.id === id)?.text).toBe("new typing");
    }
  });

  test("legacy empty draft migration and concurrent newer typing share the same CAS boundary", async () => {
    const legacy = { key, revision: 7, paused: false, items: [], busyLeases: [], drafts: [{ ...draft, text: "", revision: 2 }] };
    const raw = new EncryptedRecordStore<typeof legacy>(factory, "test-queue", "queues");
    try {
      await raw.apply(key, () => legacy, value => ({ value, result: undefined, changed: true }));
      const other = newStore();
      await Promise.all([read(store), save(3, "Typing races migration", other, start + 1)]);
      const result = (await read()).state;
      expect(result.drafts).toEqual([{ ...draft, revision: 3, text: "Typing races migration", updatedAt: start + 1 }]);
      expect((await save(2, "", store, start + 2)).state).toEqual(result);
      expect((await save(1, "Stale text before clearing", other, start + 3)).state).toEqual(result);
    } finally { await raw.close(); }
  });

  test("empty draft retirement failure keeps prior committed text intact", async () => {
    await save(1, "Keep this text if clearing cannot commit");
    const before = (await read()).state;
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function () { throw new DOMException("Draft disk quota exhausted", "QuotaExceededError"); };
      await expect(save(2, "")).rejects.toThrow("Draft disk quota exhausted");
    } finally { IDBObjectStore.prototype.put = originalPut; }
    expect((await read()).state).toEqual(before);
    expect((await save(2, "")).state.drafts).toEqual([]);
  });

  test("legacy empty draft migration failure preserves authenticated data for a later retry", async () => {
    const legacy = { key, revision: 7, paused: false, items: [], busyLeases: [], drafts: [{ ...draft, text: "" }, { ...draft, id: "retained" }] };
    const raw = new EncryptedRecordStore<typeof legacy>(factory, "test-queue", "queues");
    const originalPut = IDBObjectStore.prototype.put;
    try {
      await raw.apply(key, () => legacy, value => ({ value, result: undefined, changed: true }));
      IDBObjectStore.prototype.put = function () { throw new DOMException("Migration disk failure", "QuotaExceededError"); };
      await expect(read()).rejects.toThrow("Migration disk failure");
      IDBObjectStore.prototype.put = originalPut;
      expect(await raw.apply(key, () => legacy, value => ({ value, result: value, changed: false }))).toEqual(legacy);
      expect((await read()).state.drafts).toEqual([{ ...draft, id: "retained" }]);
    } finally { IDBObjectStore.prototype.put = originalPut; await raw.close(); }
  });

  test("stale updates and removals cannot overwrite newer typing or alter its revision", async () => {
    await save();
    const latest = await save(3, "latest text", store, start + 3);
    expect(latest.state.drafts).toEqual([{ ...draft, revision: 3, text: "latest text", updatedAt: start + 3 }]);
    for (const result of [
      await save(2, "stale text", store, start + 4),
      await save(3, "latest text", store, start + 5),
      await store.apply(request("draft-remove", { id: draft.id, draftRevision: 2 }), ownerB, start + 6),
      await store.apply(request("draft-remove", { id: draft.id, draftRevision: 4 }), ownerB, start + 7),
    ]) {
      expect(result.changed).toBe(false);
      expect(result.state).toEqual(latest.state);
    }
    await expect(save(3, "conflicting text")).rejects.toThrow("revision conflicts");
    expect((await read()).state).toEqual(latest.state);
  });

  test("removal receipts prevent stale save resurrection after restart but preserve later typing", async () => {
    await save(2, "restored draft");
    const removed = await store.apply(request("draft-remove", { id: draft.id, draftRevision: 2 }), ownerB, start);
    await store.close();
    const reopened = newStore();
    for (const revision of [1, 2]) {
      const retried = await save(revision, "old retry", reopened);
      expect(retried.changed).toBe(false);
      expect(retried.state).toEqual(removed.state);
    }
    expect((await save(3, "typed after recovery", reopened)).state.drafts).toEqual([
      { ...draft, revision: 3, text: "typed after recovery" },
    ]);
    expect((await reopened.apply(request("draft-remove", { id: draft.id, draftRevision: 2 }), ownerB, start)).changed).toBe(false);
  });

  test("independent CAS writers preserve every draft and the highest revision", async () => {
    const other = newStore();
    await Promise.all(Array.from({ length: QUEUE_MAX_DRAFTS }, (_, index) => (index % 2 ? other : store).apply(
      request("draft-save", { id: `draft-${index}`, text: `text-${index}`, draftRevision: 1 }), ownerA, start,
    )));
    await Promise.all(Array.from({ length: 16 }, (_, index) => (index % 2 ? other : store).apply(
      request("draft-save", { id: "draft-0", text: `revision-${index + 2}`, draftRevision: index + 2 }), ownerB, start + index,
    )));
    const state = (await read()).state;
    expect(state.drafts).toHaveLength(QUEUE_MAX_DRAFTS);
    expect(new Set(state.drafts?.map(entry => entry.id)).size).toBe(QUEUE_MAX_DRAFTS);
    expect(state.drafts?.find(entry => entry.id === "draft-0")).toEqual({ id: "draft-0", text: "revision-17", revision: 17, updatedAt: start + 15 });
    expect(state.drafts?.filter(entry => entry.id !== "draft-0").every(entry => entry.text === `text-${entry.id.slice(6)}`)).toBe(true);
  });

  test("a concurrent save and older removal never lose newer text", async () => {
    const other = newStore();
    for (let index = 0; index < 8; index++) {
      const id = `racing-${index}`;
      await store.apply(request("draft-save", { id, text: "before", draftRevision: 1 }), ownerA, start);
      await Promise.all([
        store.apply(request("draft-remove", { id, draftRevision: 1 }), ownerB, start + 1),
        other.apply(request("draft-save", { id, text: "new typing", draftRevision: 2 }), ownerA, start + 2),
      ]);
      expect((await read()).state.drafts?.find(entry => entry.id === id)).toEqual({ id, text: "new typing", revision: 2, updatedAt: start + 2 });
    }
  });

  test("same-revision CAS conflicts accept one writer without silently replacing text", async () => {
    const other = newStore();
    const results = await Promise.allSettled([save(1, "first", store), save(1, "second", other)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const winner = results.find(result => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("No draft save committed");
    expect((await read()).state).toEqual(winner.value.state);
  });

  test("the draft bound fails closed under CAS without pruning existing recovery text", async () => {
    const other = newStore();
    const results = await Promise.allSettled(Array.from({ length: QUEUE_MAX_DRAFTS + 1 }, (_, index) => (index % 2 ? other : store).apply(
      request("draft-save", { id: `draft-${index}`, text: `recover-${index}`, draftRevision: 1 }), ownerA, start,
    )));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(QUEUE_MAX_DRAFTS);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const before = (await read()).state;
    await expect(save()).rejects.toThrow("drafts are full");
    expect((await read()).state).toEqual(before);
    const existing = before.drafts![0]!;
    const changed = await store.apply(request("draft-save", { id: existing.id, text: "continued typing", draftRevision: 2 }), ownerB, start + 1);
    expect(changed.state.drafts).toHaveLength(QUEUE_MAX_DRAFTS);
    await store.apply(request("draft-remove", { id: existing.id, draftRevision: 2 }), ownerB, start + 2);
    expect((await save()).state.drafts).toHaveLength(QUEUE_MAX_DRAFTS);
  });

  test("invalid requests fail before altering either draft backups or queued messages", async () => {
    await enqueue("queued"); await save();
    const before = (await read()).state;
    for (const fields of [
      { id: undefined }, { id: "" }, { id: "bad id" }, { id: "x".repeat(129) },
      ...[undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"].map(draftRevision => ({ draftRevision })),
    ]) {
      for (const action of ["draft-save", "draft-remove"] as const) {
        await expect(store.apply(request(action, { id: draft.id, draftRevision: 2, text: "new text", ...fields } as Partial<QueueRequest>), ownerA, start)).rejects.toThrow();
      }
    }
    for (const text of [undefined, null, 2, "x".repeat(QUEUE_MAX_TEXT + 1)]) {
      await expect(store.apply(request("draft-save", { id: draft.id, draftRevision: 2, text: text as string }), ownerA, start)).rejects.toThrow();
    }
    for (const now of [-1, NaN, Infinity, 1.5]) await expect(save(2, "new text", store, now)).rejects.toThrow("timestamp");
    expect((await read()).state).toEqual(before);
  });

  test("journal write failure preserves its prior committed text and queued send", async () => {
    await enqueue("queued"); await save();
    const before = (await read()).state;
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function () { throw new DOMException("Draft disk quota exhausted", "QuotaExceededError"); };
      await expect(save(2, "not committed")).rejects.toThrow("Draft disk quota exhausted");
      await expect(store.apply(request("draft-remove", { id: draft.id, draftRevision: 1 }), ownerB, start)).rejects.toThrow("Draft disk quota exhausted");
    } finally { IDBObjectStore.prototype.put = originalPut; }
    expect((await read()).state).toEqual(before);
  });

  test.each([
    ["non-array", { drafts: null }], ["malformed draft", { drafts: [null] }],
    ["missing fields", { drafts: [{}] }], ["bad id", { drafts: [{ ...draft, id: "bad id" }] }],
    ["bad text", { drafts: [{ ...draft, text: 1 }] }],
    ["too long", { drafts: [{ ...draft, text: "x".repeat(QUEUE_MAX_TEXT + 1) }] }],
    ["fractional revision", { drafts: [{ ...draft, revision: 1.5 }] }],
    ["unsafe revision", { drafts: [{ ...draft, revision: Number.MAX_SAFE_INTEGER + 1 }] }],
    ["zero revision", { drafts: [{ ...draft, revision: 0 }] }],
    ["bad timestamp", { drafts: [{ ...draft, updatedAt: -1 }] }],
    ["duplicate id", { drafts: [draft, draft] }],
    ["too many", { drafts: Array.from({ length: QUEUE_MAX_DRAFTS + 1 }, (_, index) => ({ ...draft, id: `draft-${index}` })) }],
    ["bad receipts", { removedDraftRevisions: null }],
    ["bad receipt id", { removedDraftRevisions: [{ id: "bad id", revision: 1 }] }],
    ["bad receipt revision", { removedDraftRevisions: [{ id: draft.id, revision: 0 }] }],
    ["duplicate receipts", { removedDraftRevisions: [{ id: draft.id, revision: 1 }, { id: draft.id, revision: 2 }] }],
    ["already removed", { drafts: [draft], removedDraftRevisions: [{ id: draft.id, revision: 1 }] }],
  ])("malformed stored drafts (%s) fail closed and preserve the authenticated data", async (_description, fields) => {
    const stored = { key, revision: 4, paused: false, items: [{ id: "queued", text: "keep", createdAt: start, status: "queued" }], ...fields };
    const raw = new EncryptedRecordStore<typeof stored>(factory, "test-queue", "queues");
    try {
      await raw.apply(key, () => stored, value => ({ value, result: undefined, changed: true }));
      for (const action of ["read", "claim", "draft-save", "draft-remove"] as const) {
        await expect(store.apply(request(action, { id: draft.id, text: "new draft", draftRevision: 2 }), ownerA, start)).rejects.toThrow("Stored composer drafts are invalid");
      }
      expect(await raw.apply(key, () => stored, value => ({ value, result: value, changed: false }))).toEqual(stored);
    } finally { await raw.close(); }
  });
});


describe("persistent AI conversation queue", () => {
  test("exact witnessed aliases survive encrypted reopen without changing queue or pause state", async () => {
    await store.apply(request("enqueue", { key: identityKey, id: "saved", text: "Keep this message", afterUserMessageId: "existing-anchor" }), ownerA, start);
    await store.apply(request("pause", { key: identityKey, paused: true }), ownerA, start);
    const bound = await store.apply(request("bind-conversation", { key: identityKey, conversationAlias: witness() }), ownerA, start);
    expect(bound.state.conversationAliases).toEqual([witness()]);
    expect(bound.state.items.map(item => item.text)).toEqual(["Keep this message"]);
    expect(bound.state.paused).toBe(true);
    expect(bound.state.lastCompletedUserMessageId).toBe("existing-anchor");
    const repeated = await store.apply(request("bind-conversation", { key: identityKey, conversationAlias: witness() }), ownerB, start);
    expect(repeated.changed).toBe(false);
    expect(repeated.state).toEqual(bound.state);
    await store.close();
    const reopened = newStore();
    expect((await reopened.apply(request("read", { key: identityKey }), ownerB, start)).state).toEqual(bound.state);
  });

  test("concurrent binding writers preserve distinct exact tuples and retain at most sixteen", async () => {
    const other = newStore();
    await Promise.all(Array.from({ length: 18 }, (_, index) => (index % 2 ? other : store).apply(
      request("bind-conversation", { key: identityKey, conversationAlias: witness(index + 1) }), ownerA, start,
    )));
    const aliases = (await store.apply(request("read", { key: identityKey }), ownerB, start)).state.conversationAliases!;
    expect(aliases).toHaveLength(16);
    expect(new Set(aliases.map(alias => alias.localId)).size).toBe(16);
    expect(aliases.every(alias => alias.routeKey === identityKey && alias.firstUserId === witness().firstUserId)).toBe(true);
    await store.close(); await other.close();
    expect((await newStore().apply(request("read", { key: identityKey }), ownerB, start)).state.conversationAliases).toEqual(aliases);
  });

  test("conflicting and malformed identity bindings cannot alter saved messages or a prior witness", async () => {
    await store.apply(request("enqueue", { key: identityKey, id: "saved", text: "Keep this message" }), ownerA, start);
    await store.apply(request("bind-conversation", { key: identityKey, conversationAlias: witness() }), ownerA, start);
    const before = (await store.apply(request("read", { key: identityKey }), ownerA, start)).state;
    const invalid = [
      undefined, null, [], {}, { ...witness(), localId: "local-chatgpt:invalid" },
      { ...witness(), firstUserId: "invalid" }, { ...witness(), firstUserId: 1 },
      { ...witness(), routeKey: "chatgpt:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...witness(), firstUserId: "22222222-2222-4222-8222-222222222222" },
    ];
    for (const alias of invalid) {
      await expect(store.apply(request("bind-conversation", { key: identityKey, conversationAlias: alias as ConversationAlias }), ownerB, start)).rejects.toThrow();
      expect((await store.apply(request("read", { key: identityKey }), ownerA, start)).state).toEqual(before);
    }
    for (const badKey of [key, "claude:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "gemini:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]) {
      await expect(store.apply(request("bind-conversation", { key: badKey, conversationAlias: { ...witness(), routeKey: badKey } }), ownerB, start)).rejects.toThrow();
    }
    expect((await store.apply(request("read", { key: identityKey }), ownerA, start)).state).toEqual(before);
  });

  test.each([
    ["non-array", null], ["malformed tuple", [{}]],
    ["foreign route", [{ ...witness(), routeKey: "chatgpt:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]],
    ["conflicting tuple", [witness(), { ...witness(), firstUserId: "22222222-2222-4222-8222-222222222222" }]],
    ["oversized list", Array.from({ length: 17 }, (_, index) => witness(index + 1))],
  ])("corrupt stored identity (%s) fails closed without deleting the legacy queue", async (_description, aliases) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("test-queue", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("queues", { keyPath: "key" });
      open.onsuccess = () => resolve(open.result as unknown as IDBDatabase);
      open.onerror = () => reject(open.error);
    });
    const stored = { key: identityKey, revision: 3, paused: true,
      items: [{ id: "saved", text: "Keep this message", createdAt: start, status: "queued" }], conversationAliases: aliases };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("queues", "readwrite");
      transaction.objectStore("queues").put(stored);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    await expect(store.apply(request("read", { key: identityKey }), ownerA, start)).rejects.toThrow("Stored conversation identity is invalid");
    // The existing migration encrypts the legacy row before queue validation.
    // Read its authenticated value without a mutation to prove it survived.
    const retainedStorage = new EncryptedRecordStore<typeof stored>(factory, "test-queue", "queues");
    try {
      const retained = await retainedStorage.apply(identityKey, () => stored,
        value => ({ value, result: value, changed: false }));
      expect(retained).toEqual(stored);
    } finally { await retainedStorage.close(); }
  });

  test("conversation keys follow chats through project URLs and reject unsaved chats", () => {
    expect(getQueueKey("https://chatgpt.com/c/abc-123?model=x")).toBe("chatgpt:abc-123");
    expect(getQueueKey("https://chatgpt.com/g/g-demo/project/c/abc-123")).toBe("chatgpt:abc-123");
    expect(getQueueKey("https://chatgpt.com/")).toBeNull();
    expect(getQueueKey("https://evil.example/c/abc-123")).toBeNull();
    expect(getQueueKey("http://127.0.0.1:19900/queue-harness.html?tab=2")).toBe("fixture:http://127.0.0.1:19900/queue-harness.html");
  });

  test.each([
    ["https://claude.ai/chat/abc-123", "claude:abc-123"],
    ["https://claude.ai/chat/abc-123/?source=history", "claude:abc-123"],
    ["https://gemini.google.com/app/abc123?hl=en", "gemini:abc123"],
    ["https://gemini.google.com/app/abc123/#response", "gemini:abc123"],
  ])("supports stable provider routes: %s", (url, expected) => {
    expect(getQueueKey(url!)).toBe(expected);
  });

  test.each([
    "https://claude.ai/", "https://claude.ai/new", "https://claude.ai/chat", "https://claude.ai/project/abc", "https://claude.ai/chat/abc/other",
    "https://gemini.google.com/", "https://gemini.google.com/app", "https://gemini.google.com/app/", "https://gemini.google.com/share/abc", "https://gemini.google.com/app/abc/other",
    "http://claude.ai/chat/abc", "http://gemini.google.com/app/abc", "https://claude.ai.evil.example/chat/abc", "https://gemini.google.com.evil.example/app/abc",
    "https://claude.ai:444/chat/abc", "https://gemini.google.com:444/app/abc", "https://user:password@claude.ai/chat/abc", "https://user:password@gemini.google.com/app/abc",
    "https://claude.ai/chat/a%2Fb", "https://gemini.google.com/app/a%2Fb",
  ])("rejects unsaved or unsupported provider URL: %s", url => {
    expect(getQueueKey(url)).toBeNull();
  });

  test("provider namespaces persist separately even when conversation IDs coincide", async () => {
    const providerKeys = ["chatgpt:shared-id", "claude:shared-id", "gemini:shared-id"];
    for (const providerKey of providerKeys) {
      await store.apply(request("enqueue", { key: providerKey, id: "same-message-id", text: providerKey }), ownerA, start);
    }
    await store.close();
    const reopened = newStore();
    for (const providerKey of providerKeys) {
      const persisted = await reopened.apply(request("read", { key: providerKey }), ownerB, start + 1);
      expect(persisted.state.items).toHaveLength(1);
      expect(persisted.state.items[0]?.text).toBe(providerKey);
      expect((await reopened.apply(request("claim", { key: providerKey }), ownerB, start + 2)).claimed?.text).toBe(providerKey);
    }
  });

  test("concurrent writers from independent connections lose no queued messages", async () => {
    const other = newStore();
    await Promise.all(Array.from({ length: 40 }, (_, index) => enqueue(`item-${index}`, `Message ${index}`, index % 2 ? other : store)));
    const { state } = await read();
    expect(state.items).toHaveLength(40);
    expect(new Set(state.items.map((item) => item.id)).size).toBe(40);
    expect(state.revision).toBe(40);
  });

  test("persists messages, reordering, edits and pause after closing every connection", async () => {
    await enqueue("a"); await enqueue("b"); await enqueue("c");
    await store.apply(request("move", { id: "c", delta: -2 }), ownerA, start);
    await store.apply(request("edit", { id: "b", text: "changed" }), ownerA, start);
    await store.apply(request("pause", { paused: true }), ownerA, start);
    await store.close();
    const reopened = newStore();
    const { state } = await read(reopened);
    expect(state.items.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(state.items[2]?.text).toBe("changed");
    expect(state.paused).toBe(true);
    expect((await reopened.apply(request("claim"), ownerB, start)).claimed).toBeUndefined();
  });

  test("only one tab can claim and attempt a message", async () => {
    await enqueue("a"); await enqueue("b");
    const other = newStore();
    const contenders = await Promise.all([
      store.apply(request("claim"), ownerA, start),
      other.apply(request("claim"), ownerB, start),
    ]);
    expect(contenders.filter((result) => result.claimed)).toHaveLength(1);
    const winner = contenders.find((result) => result.claimed)!.claimed!;
    const winnerOwner = winner.owner!;
    const loserOwner = winnerOwner === ownerA ? ownerB : ownerA;
    await expect(store.apply(request("attempt", { id: "a" }), loserOwner, start + 1)).rejects.toThrow("another tab");
    await store.apply(request("attempt", { id: "a" }), winnerOwner, start + 1);
    expect((await other.apply(request("claim"), loserOwner, start + 2)).claimed).toBeUndefined();
    await expect(store.apply(request("attempt", { id: "a" }), winnerOwner, start + 2)).rejects.toThrow();
    expect((await read()).state.items.map((item) => item.status)).toEqual(["sending", "queued"]);
  });

  test("a busy tab suppresses idle-tab claims and idle heartbeats cannot clear it", async () => {
    await enqueue("a");
    await store.apply(request("heartbeat", { busy: true }), ownerB, start);
    await store.apply(request("heartbeat", { busy: false }), ownerA, start + 1);
    expect((await store.apply(request("claim"), ownerA, start + QUEUE_BUSY_MS - 1)).claimed).toBeUndefined();
    expect((await store.apply(request("claim"), ownerA, start + QUEUE_BUSY_MS)).claimed?.id).toBe("a");
    await store.apply(request("heartbeat", { busy: true }), ownerB, start + QUEUE_BUSY_MS + 1);
    await expect(store.apply(request("attempt", { id: "a" }), ownerA, start + QUEUE_BUSY_MS + 2)).rejects.toThrow("became busy");
  });

  test("the busy owner can clear its lease and claim immediately after completion", async () => {
    await enqueue("a");
    await store.apply(request("heartbeat", { busy: true }), ownerA, start);
    const cleared = await store.apply(request("heartbeat", { busy: false }), ownerA, start + 1);
    expect(cleared.state.busyUntil).toBeUndefined();
    expect("busyLeases" in cleared.state).toBe(false);
    const claimed = await store.apply(request("claim"), ownerA, start + 1);
    expect(claimed.claimed?.id).toBe("a");
    await store.apply(request("attempt", { id: "a" }), ownerA, start + 1);
    expect((await read(store, start + 1)).state.items[0]?.status).toBe("sending");
  });

  test("clearing one owner's lease preserves another busy tab and its deadline", async () => {
    await enqueue("a");
    await store.apply(request("heartbeat", { busy: true }), ownerA, start);
    await store.apply(request("heartbeat", { busy: true }), ownerB, start + 100);
    const aIdle = await store.apply(request("heartbeat", { busy: false }), ownerA, start + 101);
    expect(aIdle.state.busyUntil).toBe(start + 100 + QUEUE_BUSY_MS);
    expect((await store.apply(request("claim"), ownerA, start + 102)).claimed).toBeUndefined();
    await store.close();
    const reopened = newStore();
    expect((await reopened.apply(request("heartbeat", { busy: false }), ownerA, start + 103)).state.busyUntil).toBe(start + 100 + QUEUE_BUSY_MS);
    expect((await reopened.apply(request("claim"), ownerA, start + QUEUE_BUSY_MS)).claimed).toBeUndefined();
    await reopened.apply(request("heartbeat", { busy: false }), ownerB, start + QUEUE_BUSY_MS + 1);
    expect((await reopened.apply(request("claim"), ownerA, start + QUEUE_BUSY_MS + 1)).claimed?.id).toBe("a");
  });

  test("idle-owner clears and competing claims remain transactional", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("heartbeat", { busy: true }), ownerA, start);
    await store.apply(request("heartbeat", { busy: false }), ownerA, start + 1);
    const other = newStore();
    const contenders = await Promise.all([
      store.apply(request("claim"), ownerA, start + 1),
      other.apply(request("claim"), ownerB, start + 1),
    ]);
    expect(contenders.filter((result) => result.claimed)).toHaveLength(1);
    expect((await read(store, start + 1)).state.items.map((item) => item.status)).toEqual(["claimed", "queued"]);
  });

  test("a legacy aggregate busy deadline survives migration and idle heartbeats until it expires", async () => {
    const legacyUntil = start + QUEUE_BUSY_MS;
    await new Promise<void>((resolve, reject) => {
      const open = factory.open("test-queue", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("queues", { keyPath: "key" });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction("queues", "readwrite");
        tx.objectStore("queues").put({ key, revision: 5, paused: false,
          items: [{ id: "a", text: "saved before upgrade", createdAt: start, status: "queued" }], busyUntil: legacyUntil });
        tx.oncomplete = () => { database.close(); resolve(); };
        tx.onabort = () => { database.close(); reject(tx.error); };
      };
    });
    const migrated = await store.apply(request("heartbeat", { busy: false }), ownerA, start + 1);
    expect(migrated.state.busyUntil).toBe(legacyUntil);
    expect("legacyBusyUntil" in migrated.state).toBe(false);
    expect("busyLeases" in migrated.state).toBe(false);
    await store.apply(request("heartbeat", { busy: true }), ownerA, start + 100);
    await store.apply(request("heartbeat", { busy: false }), ownerA, start + 101);
    await store.close();
    const reopened = newStore();
    expect((await reopened.apply(request("claim"), ownerB, legacyUntil - 1)).claimed).toBeUndefined();
    const afterExpiry = await reopened.apply(request("claim"), ownerB, legacyUntil);
    expect(afterExpiry.claimed?.id).toBe("a");
    expect(afterExpiry.state.busyUntil).toBeUndefined();
  });

  test("lost pre-send claims recover safely after restart; attempted sends never auto-retry", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("claim"), ownerA, start);
    await store.close();
    const reopened = newStore();
    expect((await reopened.apply(request("claim"), ownerB, start + QUEUE_CLAIM_MS)).claimed?.id).toBe("a");
    await reopened.apply(request("attempt", { id: "a" }), ownerB, start + QUEUE_CLAIM_MS);
    await reopened.close();
    const restarted = newStore();
    const recovered = await restarted.apply(request("claim"), ownerA, start + QUEUE_CLAIM_MS + QUEUE_SEND_TIMEOUT_MS);
    expect(recovered.claimed).toBeUndefined();
    expect(recovered.state.items.map((item) => item.status)).toEqual(["review", "queued"]);
    expect(recovered.state.items[0]?.text).toBe("a");
    expect(recovered.state.items[0]?.reason).toContain("duplicate");
    await restarted.apply(request("retry", { id: "a" }), ownerA, start + 99_000);
    expect((await restarted.apply(request("claim"), ownerA, start + 99_001)).claimed?.id).toBe("a");
  });

  test("acknowledged messages survive restart and only completion unblocks the next item", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "a" }), ownerA, start);
    await store.apply(request("ack", { id: "a", userMessageId: "user-uuid" }), ownerA, start + 10);
    await store.close();
    const other = newStore();
    const resumed = await other.apply(request("claim"), ownerB, start + 100_000);
    expect(resumed.claimed).toBeUndefined();
    expect(resumed.state.items[0]?.userMessageId).toBe("user-uuid");
    await expect(other.apply(request("complete", { id: "a", userMessageId: "wrong" }), ownerB, start + 100_001)).rejects.toThrow("does not match");
    await other.apply(request("complete", { id: "a", userMessageId: "user-uuid" }), ownerB, start + 100_002);
    expect((await other.apply(request("claim", { afterUserMessageId: "user-uuid" }), ownerB, start + 100_003)).claimed?.id).toBe("b");
  });

  test("lost acknowledgement replies cannot downgrade confirmed delivery to Send unconfirmed", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "a" }), ownerA, start + 1);
    const acknowledged = await store.apply(request("ack", { id: "a", userMessageId: "confirmed-user-id" }), ownerA, start + 2);
    // Simulate the sender's catch handler after the committed ack reply is lost.
    const reviewed = await store.apply(request("review", { id: "a", reason: "Message port closed after commit" }), ownerA, start + 3);
    expect(reviewed.changed).toBe(false);
    expect(reviewed.state).toEqual(acknowledged.state);
    expect(reviewed.state.items[0]?.status).toBe("waiting");
    expect(reviewed.state.items[0]?.userMessageId).toBe("confirmed-user-id");
    expect((await store.apply(request("claim"), ownerB, start + 4)).claimed).toBeUndefined();
    await expect(store.apply(request("retry", { id: "a" }), ownerA, start + 5)).rejects.toThrow("Only messages needing review");
    await store.apply(request("complete", { id: "a", userMessageId: "confirmed-user-id" }), ownerB, start + 6);
    expect((await store.apply(request("claim", { afterUserMessageId: "confirmed-user-id" }), ownerB, start + 7)).claimed?.id).toBe("b");
  });

  test("a stale sender cannot put another tab's retried attempt into review", async () => {
    await enqueue("a");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "a" }), ownerA, start + 1);
    await store.apply(request("review", { id: "a", reason: "Original send was uncertain" }), ownerA, start + 2);
    await store.apply(request("retry", { id: "a" }), ownerB, start + 3);
    await store.apply(request("claim"), ownerB, start + 4);
    const secondAttempt = await store.apply(request("attempt", { id: "a" }), ownerB, start + 5);
    await expect(store.apply(request("review", { id: "a", reason: "Late cleanup from original sender" }), ownerA, start + 6)).rejects.toThrow("another tab");
    expect((await read(store, start + 6)).state).toEqual(secondAttempt.state);
    const acknowledged = await store.apply(request("ack", { id: "a", userMessageId: "second-attempt-user" }), ownerB, start + 7);
    await expect(store.apply(request("review", { id: "a", reason: "Another stale cleanup" }), ownerA, start + 8)).rejects.toThrow("another tab");
    expect((await read(store, start + 8)).state).toEqual(acknowledged.state);
  });

  test("stale tabs cannot claim the next message until they load the completed transcript anchor", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "a" }), ownerA, start);
    await store.apply(request("ack", { id: "a", userMessageId: "latest-user-id" }), ownerA, start + 1);
    await store.apply(request("complete", { id: "a", userMessageId: "latest-user-id" }), ownerA, start + 2);
    await store.close();
    const staleTab = newStore();
    const stale = await staleTab.apply(request("claim"), ownerB, start + 3);
    expect(stale.claimed).toBeUndefined();
    expect(stale.state.lastCompletedUserMessageId).toBe("latest-user-id");
    expect((await staleTab.apply(request("claim", { afterUserMessageId: "older-user-id" }), ownerB, start + 4)).claimed).toBeUndefined();
    expect((await staleTab.apply(request("claim", { afterUserMessageId: "latest-user-id" }), ownerB, start + 5)).claimed?.id).toBe("b");
  });

  test("a new batch anchors to its existing generating turn before the first queued send", async () => {
    const enqueued = await store.apply(request("enqueue", {
      id: "first-pending", text: "Follow up after this response", afterUserMessageId: "generating-user-id",
    }), ownerA, start);
    expect(enqueued.state.lastCompletedUserMessageId).toBe("generating-user-id");
    await store.close();
    const staleTab = newStore();
    expect((await staleTab.apply(request("claim"), ownerB, start + 10_000)).claimed).toBeUndefined();
    expect((await staleTab.apply(request("claim", { afterUserMessageId: "older-user-id" }), ownerB, start + 10_001)).claimed).toBeUndefined();
    await staleTab.apply(request("enqueue", {
      id: "first-pending", text: "Follow up after this response", afterUserMessageId: "older-user-id",
    }), ownerB, start + 10_002);
    await staleTab.apply(request("enqueue", {
      id: "second-pending", text: "Another follow up", afterUserMessageId: "older-user-id",
    }), ownerB, start + 10_003);
    expect((await read(staleTab)).state.lastCompletedUserMessageId).toBe("generating-user-id");
    expect((await staleTab.apply(request("claim", { afterUserMessageId: "generating-user-id" }), ownerA, start + 10_004)).claimed?.id).toBe("first-pending");
  });

  test("Gemini anchor promotion persists across reopen and still requires the exact completed turn to claim", async () => {
    const geminiKey = "gemini:anchor-chat";
    const indexed = "gemini:user:user-query-content-11:abc123";
    const stable = "gemini:user:23845300d6e6d28e";
    await store.apply(request("enqueue", { key: geminiKey, id: "a", text: "Follow up", afterUserMessageId: indexed }), ownerA, start);
    await store.apply(request("pause", { key: geminiKey, paused: true }), ownerA, start);
    const before = (await store.apply(request("read", { key: geminiKey }), ownerA, start)).state;
    const promoted = await store.apply(request("anchor", { key: geminiKey, userMessageId: indexed, afterUserMessageId: stable }), ownerB, start);
    expect(promoted.changed).toBe(true);
    expect(promoted.state).toEqual({ ...before, revision: before.revision + 1, lastCompletedUserMessageId: stable });
    await store.close();
    const reopened = newStore();
    expect((await reopened.apply(request("claim", { key: geminiKey, afterUserMessageId: stable }), ownerB, start + 1)).claimed).toBeUndefined();
    await reopened.apply(request("pause", { key: geminiKey, paused: false }), ownerB, start + 2);
    for (const afterUserMessageId of [undefined, indexed, "gemini:user:aaaaaaaaaaaaaaaa"]) {
      expect((await reopened.apply(request("claim", { key: geminiKey, afterUserMessageId }), ownerB, start + 3)).claimed).toBeUndefined();
    }
    expect((await reopened.apply(request("claim", { key: geminiKey, afterUserMessageId: stable }), ownerB, start + 4)).claimed?.id).toBe("a");
  });

  test("concurrent Gemini anchor promotions compare the old value and make a stale replacement a no-op", async () => {
    const geminiKey = "gemini:anchor-chat";
    const indexed = "gemini:user:user-query-content-11:abc123";
    const replacements = ["gemini:user:23845300d6e6d28e", "gemini:user:aaaaaaaaaaaaaaaa"];
    const enqueued = await store.apply(request("enqueue", { key: geminiKey, id: "a", text: "Follow up", afterUserMessageId: indexed }), ownerA, start);
    const other = newStore();
    const results = await Promise.all(replacements.map((stable, index) => (index ? other : store).apply(
      request("anchor", { key: geminiKey, userMessageId: indexed, afterUserMessageId: stable }), index ? ownerB : ownerA, start,
    )));
    expect(results.filter(result => result.changed)).toHaveLength(1);
    const winner = results.find(result => result.changed)!.state;
    expect(replacements).toContain(winner.lastCompletedUserMessageId!);
    expect(winner.revision).toBe(enqueued.state.revision + 1);
    const stale = results.find(result => !result.changed)!;
    expect(stale.state).toEqual(winner);
    expect(stale.claimed).toBeUndefined();
    expect((await other.apply(request("read", { key: geminiKey }), ownerB, start)).state).toEqual(winner);
  });

  test("waiting-item anchor promotion stays in its slot and cannot complete or bypass the next-message barrier", async () => {
    const geminiKey = "gemini:anchor-chat";
    const prior = "gemini:user:user-query-content-10:priorhash";
    const indexed = "gemini:user:user-query-content-11:abc123";
    const stable = "gemini:user:23845300d6e6d28e";
    await store.apply(request("enqueue", { key: geminiKey, id: "a", text: "First", afterUserMessageId: prior }), ownerA, start);
    await store.apply(request("enqueue", { key: geminiKey, id: "b", text: "Second" }), ownerA, start);
    await store.apply(request("claim", { key: geminiKey, afterUserMessageId: prior }), ownerA, start);
    await store.apply(request("attempt", { key: geminiKey, id: "a" }), ownerA, start);
    await store.apply(request("ack", { key: geminiKey, id: "a", userMessageId: indexed }), ownerA, start);
    await store.apply(request("pause", { key: geminiKey, paused: true }), ownerA, start);
    const before = (await store.apply(request("read", { key: geminiKey }), ownerA, start)).state;
    for (const id of [undefined, "b", "missing"]) {
      const ignored = await store.apply(request("anchor", { key: geminiKey, id, userMessageId: indexed, afterUserMessageId: stable }), ownerB, start);
      expect(ignored.changed).toBe(false);
      expect(ignored.state).toEqual(before);
    }
    const promoted = await store.apply(request("anchor", { key: geminiKey, id: "a", userMessageId: indexed, afterUserMessageId: stable }), ownerB, start);
    expect(promoted.state).toEqual({ ...before, revision: before.revision + 1,
      items: [{ ...before.items[0]!, userMessageId: stable }, before.items[1]!] });
    expect((await store.apply(request("anchor", { key: geminiKey, id: "a", userMessageId: indexed, afterUserMessageId: stable }), ownerA, start)).changed).toBe(false);
    await store.apply(request("pause", { key: geminiKey, paused: false }), ownerA, start);
    expect((await store.apply(request("claim", { key: geminiKey, afterUserMessageId: prior }), ownerB, start)).claimed).toBeUndefined();
    await expect(store.apply(request("complete", { key: geminiKey, id: "a", userMessageId: indexed }), ownerB, start)).rejects.toThrow("does not match");
    const completed = await store.apply(request("complete", { key: geminiKey, id: "a", userMessageId: stable }), ownerB, start);
    expect(completed.state.lastCompletedUserMessageId).toBe(stable);
    expect(completed.state.items.map(item => item.id)).toEqual(["b"]);
    expect((await store.apply(request("claim", { key: geminiKey, afterUserMessageId: prior }), ownerB, start)).claimed).toBeUndefined();
    expect((await store.apply(request("claim", { key: geminiKey, afterUserMessageId: stable }), ownerB, start)).claimed?.id).toBe("b");
  });

  test("anchor promotion rejects other providers and text-only, provisional, or non-turn identifiers without mutation", async () => {
    const indexed = "gemini:user:user-query-content-11:abc123";
    const stable = "gemini:user:23845300d6e6d28e";
    for (const providerKey of ["chatgpt:anchor-chat", "claude:anchor-chat", "fixture:anchor-chat", "gemini:anchor-chat"]) {
      await store.apply(request("enqueue", { key: providerKey, id: "a", text: "Identical prompt", afterUserMessageId: indexed }), ownerA, start);
      const before = (await store.apply(request("read", { key: providerKey }), ownerA, start)).state;
      const invalid = providerKey.startsWith("gemini:") ? [
        { userMessageId: "Identical prompt", afterUserMessageId: stable },
        { userMessageId: "gemini:user:user-query-content-undefined:abc123", afterUserMessageId: stable },
        { userMessageId: "gemini:user:abc123", afterUserMessageId: stable },
        { userMessageId: "chatgpt:user:11:abc123", afterUserMessageId: stable },
        { userMessageId: indexed, afterUserMessageId: "gemini:user:user-query-content-9:abc123" },
        { userMessageId: indexed, afterUserMessageId: "gemini:user:23845300d6e6d28" },
        { userMessageId: indexed, afterUserMessageId: "gemini:user:zzzzzzzzzzzzzzzz" },
        { userMessageId: indexed, afterUserMessageId: "claude:user:23845300d6e6d28e" },
      ] : [{ userMessageId: indexed, afterUserMessageId: stable }];
      for (const fields of invalid) {
        await expect(store.apply(request("anchor", { key: providerKey, ...fields }), ownerA, start)).rejects.toThrow();
        expect((await store.apply(request("read", { key: providerKey }), ownerA, start)).state).toEqual(before);
      }
    }
  });

  test("only a genuinely new batch resets the completed transcript anchor", async () => {
    await enqueue("a");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "a" }), ownerA, start);
    await store.apply(request("ack", { id: "a", userMessageId: "last-batch-user" }), ownerA, start + 1);
    await store.apply(request("complete", { id: "a", userMessageId: "last-batch-user" }), ownerA, start + 2);
    await enqueue("a"); // Lost old response cannot reopen a drained batch or drop its anchor.
    expect((await read()).state.items).toHaveLength(0);
    expect((await read()).state.lastCompletedUserMessageId).toBe("last-batch-user");
    await enqueue("new-batch");
    expect((await read()).state.lastCompletedUserMessageId).toBeUndefined();
    expect((await store.apply(request("claim"), ownerB, start + 3)).claimed?.id).toBe("new-batch");
    await enqueue("second-in-batch");
    await store.apply(request("attempt", { id: "new-batch" }), ownerB, start + 4);
    await store.apply(request("ack", { id: "new-batch", userMessageId: "new-batch-user" }), ownerB, start + 5);
    await store.apply(request("complete", { id: "new-batch", userMessageId: "new-batch-user" }), ownerB, start + 6);
    await enqueue("third-in-batch");
    expect((await read()).state.lastCompletedUserMessageId).toBe("new-batch-user");
    expect((await store.apply(request("claim"), ownerA, start + 7)).claimed).toBeUndefined();
  });

  test("retrying a lost enqueue response cannot duplicate or resurrect a deleted message", async () => {
    await Promise.all([enqueue("a"), enqueue("a")]);
    expect((await read()).state.items).toHaveLength(1);
    await store.apply(request("remove", { id: "a" }), ownerA, start);
    await store.close();
    const reopened = newStore();
    await enqueue("a", "a", reopened);
    expect((await read(reopened)).state.items).toHaveLength(0);
  });

  test("pause wins over a pre-send claim, while uncertain attempts remain visible", async () => {
    await enqueue("a");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("pause", { paused: true }), ownerB, start);
    await expect(store.apply(request("attempt", { id: "a" }), ownerA, start)).rejects.toThrow();
    expect((await read()).state.items[0]?.status).toBe("queued");
    await store.apply(request("pause", { paused: false }), ownerB, start);
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "a" }), ownerA, start);
    await store.apply(request("pause", { paused: true }), ownerB, start);
    expect((await read()).state.items[0]?.status).toBe("sending");
  });

  test("an edit reservation blocks other tabs and commits the same queue slot without changing pause", async () => {
    await enqueue("first"); await enqueue("edit-me", "original"); await enqueue("last");
    const before = (await read()).state.items[1]!;
    const reserved = await store.apply(request("begin-edit", { id: "edit-me", editToken: "session-a" }), ownerA, start + 1);
    expect(reserved.state.items[1]?.status).toBe("editing");
    expect(reserved.state.paused).toBe(false);
    const other = newStore();
    expect((await other.apply(request("claim"), ownerB, start + 2)).claimed).toBeUndefined();
    await expect(other.apply(request("begin-edit", { id: "edit-me", editToken: "session-b" }), ownerB, start + 2)).rejects.toThrow();
    await expect(other.apply(request("edit", { id: "edit-me", editToken: "session-a", text: "wrong tab" }), ownerB, start + 2)).rejects.toThrow("another tab");
    await expect(other.apply(request("remove", { id: "edit-me" }), ownerB, start + 2)).rejects.toThrow("Another tab");
    await expect(other.apply(request("move", { id: "last", delta: -2 }), ownerB, start + 2)).rejects.toThrow();
    const saved = await store.apply(request("edit", { id: "edit-me", editToken: "session-a", text: "updated" }), ownerA, start + 3);
    expect(saved.state.items.map((entry) => entry.id)).toEqual(["first", "edit-me", "last"]);
    expect(saved.state.items[1]).toEqual({ ...before, text: "updated", lastEditToken: "session-a" });
    expect(saved.state.paused).toBe(false);
  });

  test("concurrent edit reservations produce one owner", async () => {
    await enqueue("a");
    const other = newStore();
    const attempts = await Promise.allSettled([
      store.apply(request("begin-edit", { id: "a", editToken: "a-token" }), ownerA, start),
      other.apply(request("begin-edit", { id: "a", editToken: "b-token" }), ownerB, start),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await read()).state.items[0]?.status).toBe("editing");
  });

  test("edit retry is idempotent and an old token cannot change a newer reservation", async () => {
    await enqueue("a", "original");
    await store.apply(request("pause", { paused: true }), ownerA, start);
    await store.apply(request("begin-edit", { id: "a", editToken: "first-edit" }), ownerA, start);
    await store.apply(request("begin-edit", { id: "a", editToken: "first-edit" }), ownerA, start + 1);
    const edit = request("edit", { id: "a", text: "new text", editToken: "first-edit" });
    const saved = await store.apply(edit, ownerA, start + 2);
    await store.close();
    const reopened = newStore();
    const retried = await reopened.apply(edit, ownerA, start + 3);
    expect(retried.changed).toBe(false);
    expect(retried.state).toEqual(saved.state);
    expect(retried.state.paused).toBe(true);
    await expect(reopened.apply({ ...edit, text: "unexpected change" }, ownerA, start + 4)).rejects.toThrow("expired or changed");
    await reopened.apply(request("begin-edit", { id: "a", editToken: "second-edit" }), ownerA, start + 5);
    await expect(reopened.apply(edit, ownerA, start + 6)).rejects.toThrow("edit session has changed");
    await expect(reopened.apply(request("cancel-edit", { id: "a", editToken: "first-edit" }), ownerA, start + 6)).rejects.toThrow("edit session has changed");
    const cancelled = await reopened.apply(request("cancel-edit", { id: "a", editToken: "second-edit" }), ownerA, start + 7);
    expect(cancelled.state.items[0]?.text).toBe("new text");
    expect(cancelled.state.items[0]?.status).toBe("queued");
    expect(cancelled.state.paused).toBe(true);
  });

  test("a lost edit-save response stays idempotent after another tab sends and completes it", async () => {
    await enqueue("a", "old text");
    await store.apply(request("begin-edit", { id: "a", editToken: "saved-edit" }), ownerA, start);
    const edit = request("edit", { id: "a", editToken: "saved-edit", text: "saved new text" });
    await store.apply(edit, ownerA, start + 1);
    await store.apply(request("claim"), ownerB, start + 2);
    expect((await store.apply(edit, ownerA, start + 3)).changed).toBe(false);
    await store.apply(request("attempt", { id: "a" }), ownerB, start + 4);
    expect((await store.apply(edit, ownerA, start + 5)).changed).toBe(false);
    await store.apply(request("ack", { id: "a", userMessageId: "edited-user-id" }), ownerB, start + 6);
    expect((await store.apply(edit, ownerA, start + 7)).changed).toBe(false);
    await store.apply(request("complete", { id: "a", userMessageId: "edited-user-id" }), ownerB, start + 8);
    await store.close();
    const reopened = newStore();
    const retried = await reopened.apply(edit, ownerA, start + 9);
    expect(retried.changed).toBe(false);
    expect(retried.state.items).toHaveLength(0);
    expect("editReceipts" in retried.state).toBe(false);
    await expect(reopened.apply({ ...edit, text: "different text" }, ownerA, start + 10)).rejects.toThrow("no longer available");
    await expect(reopened.apply({ ...edit, editToken: "different-token" }, ownerA, start + 10)).rejects.toThrow("no longer available");
  });

  test("edit-save receipts cover review and deletion without resurrecting a removed row", async () => {
    await enqueue("a", "original");
    await store.apply(request("begin-edit", { id: "a", editToken: "saved-edit" }), ownerA, start);
    const edit = request("edit", { id: "a", editToken: "saved-edit", text: "committed" });
    await store.apply(edit, ownerA, start + 1);
    await store.apply(request("claim"), ownerB, start + 2);
    await store.apply(request("attempt", { id: "a" }), ownerB, start + 3);
    await store.apply(request("review", { id: "a", reason: "uncertain" }), ownerB, start + 4);
    expect((await store.apply(edit, ownerA, start + 5)).state.items[0]?.status).toBe("review");
    await store.apply(request("remove", { id: "a" }), ownerB, start + 6);
    expect((await store.apply(edit, ownerA, start + 7)).state.items).toHaveLength(0);
  });

  test("edit heartbeat extends only its owned lease; an abandoned editor returns original text paused", async () => {
    await enqueue("a", "original text");
    await store.apply(request("begin-edit", { id: "a", editToken: "edit-a" }), ownerA, start);
    await expect(store.apply(request("edit-heartbeat", { id: "a", editToken: "edit-a" }), ownerB, start + 1)).rejects.toThrow("another tab");
    await store.apply(request("edit-heartbeat", { id: "a", editToken: "edit-a" }), ownerA, start + QUEUE_EDIT_MS - 1);
    expect((await read(store, start + QUEUE_EDIT_MS)).state.items[0]?.status).toBe("editing");
    await store.close();
    const reopened = newStore();
    const expired = await reopened.apply(request("claim"), ownerB, start + QUEUE_EDIT_MS * 2);
    expect(expired.claimed).toBeUndefined();
    expect(expired.state.paused).toBe(true);
    expect(expired.state.items[0]).toEqual({ id: "a", text: "original text", createdAt: start, status: "queued" });
    await expect(reopened.apply(request("edit", { id: "a", editToken: "edit-a", text: "unsaved" }), ownerA, start + QUEUE_EDIT_MS * 2 + 1)).rejects.toThrow("expired or changed");
  });

  test("only the editing owner can trash its reserved message", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("begin-edit", { id: "a", editToken: "edit-a" }), ownerA, start);
    await expect(store.apply(request("remove", { id: "a" }), ownerB, start)).rejects.toThrow();
    const removed = await store.apply(request("remove", { id: "a" }), ownerA, start + 1);
    expect(removed.state.items.map((entry) => entry.id)).toEqual(["b"]);
    expect(removed.state.paused).toBe(false);
  });

  test("Send now selects one item while busy and paused without allowing a competing send", async () => {
    await store.apply(request("enqueue", { id: "a", text: "a", afterUserMessageId: "old-anchor" }), ownerA, start);
    await enqueue("b"); await enqueue("c");
    await store.apply(request("pause", { paused: true }), ownerA, start);
    await store.apply(request("heartbeat", { busy: true }), ownerA, start);
    const other = newStore();
    const contenders = await Promise.allSettled([
      store.apply(request("steer", { id: "c" }), ownerA, start + 1),
      other.apply(request("steer", { id: "b" }), ownerB, start + 1),
    ]);
    expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = contenders.find((result) => result.status === "fulfilled");
    if (!winner || winner.status !== "fulfilled") throw new Error("No Send now claim");
    const claimed = winner.value.claimed!;
    expect(claimed.sendNow).toBe(true);
    expect(winner.value.state.items[0]?.id).toBe(claimed.id);
    expect(winner.value.state.paused).toBe(true);
    expect(winner.value.state.lastCompletedUserMessageId).toBe("old-anchor");
    expect((await other.apply(request("claim"), ownerB, start + 2)).claimed).toBeUndefined();
    const attempted = await store.apply(request("attempt", { id: claimed.id }), claimed.owner!, start + 2);
    expect(attempted.state.items[0]?.status).toBe("sending");
    expect(attempted.state.paused).toBe(true);
    expect(attempted.state.lastCompletedUserMessageId).toBeUndefined();
    await expect(other.apply(request("steer", { id: attempted.state.items[1]!.id }), ownerB, start + 3)).rejects.toThrow("active send or edit");
  });

  test("Send now retires a preceding waiting row only when the new attempt commits", async () => {
    await enqueue("prior"); await enqueue("later"); await enqueue("send-now");
    await store.apply(request("claim"), ownerA, start);
    await store.apply(request("attempt", { id: "prior" }), ownerA, start);
    await store.apply(request("ack", { id: "prior", userMessageId: "prior-user" }), ownerA, start + 1);
    await store.apply(request("heartbeat", { busy: true }), ownerA, start + 2);
    const selected = await store.apply(request("steer", { id: "send-now" }), ownerB, start + 3);
    expect(selected.state.items.map((entry) => entry.id)).toEqual(["prior", "send-now", "later"]);
    expect(selected.state.items[0]?.status).toBe("waiting");
    await store.apply(request("release", { id: "send-now" }), ownerB, start + 4);
    expect((await read()).state.items[0]?.id).toBe("prior");
    await store.apply(request("steer", { id: "send-now" }), ownerB, start + 5);
    const attempted = await store.apply(request("attempt", { id: "send-now" }), ownerB, start + 6);
    expect(attempted.state.items.map((entry) => entry.id)).toEqual(["send-now", "later"]);
    expect(attempted.state.items[0]?.status).toBe("sending");
    await enqueue("prior");
    expect((await read()).state.items.map((entry) => entry.id)).toEqual(["send-now", "later"]);
  });

  test("Send now respects edit/review barriers and an explicit new Pause cancels its pre-send claim", async () => {
    await enqueue("a"); await enqueue("b");
    await store.apply(request("begin-edit", { id: "a", editToken: "edit-a" }), ownerA, start);
    await expect(store.apply(request("steer", { id: "b" }), ownerB, start)).rejects.toThrow();
    await store.apply(request("cancel-edit", { id: "a", editToken: "edit-a" }), ownerA, start);
    await store.apply(request("steer", { id: "b" }), ownerB, start + 1);
    const paused = await store.apply(request("pause", { paused: true }), ownerA, start + 2);
    expect(paused.state.items[0]?.status).toBe("queued");
    expect(paused.state.items[0]?.sendNow).toBeUndefined();
    await expect(store.apply(request("attempt", { id: "b" }), ownerB, start + 3)).rejects.toThrow();
    await store.apply(request("steer", { id: "b" }), ownerB, start + 4);
    await store.apply(request("attempt", { id: "b" }), ownerB, start + 5);
    await store.apply(request("review", { id: "b", reason: "delivery uncertain" }), ownerB, start + 6);
    await expect(store.apply(request("steer", { id: "a" }), ownerA, start + 7)).rejects.toThrow();
  });

  test("invalid mutations preserve every queued message and its revision", async () => {
    await enqueue("a");
    const before = await read();
    await expect(store.apply(request("edit", { id: "a", text: "" }), ownerA, start)).rejects.toThrow();
    await expect(store.apply(request("move", { id: "a", delta: 0.5 }), ownerA, start)).rejects.toThrow();
    await expect(store.apply(request("complete", { id: "a" }), ownerA, start)).rejects.toThrow();
    expect((await read()).state).toEqual(before.state);
  });

  test("storage write failure rejects the action and leaves the committed queue intact", async () => {
    await enqueue("a");
    const before = (await read()).state;
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function () { throw new DOMException("Disk quota exhausted", "QuotaExceededError"); };
      await expect(enqueue("b")).rejects.toThrow("Disk quota exhausted");
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect((await read()).state).toEqual(before);
    await enqueue("b");
    expect((await read()).state.items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("each conversation has its own queue", async () => {
    await enqueue("a");
    const otherChat = request("enqueue", { key: "chatgpt:conversation-b", id: "b", text: "private to b" });
    await store.apply(otherChat, ownerB, start);
    expect((await read()).state.items.map((item) => item.id)).toEqual(["a"]);
    expect((await store.apply({ ...otherChat, action: "read" }, ownerB, start)).state.items.map((item) => item.id)).toEqual(["b"]);
  });
});

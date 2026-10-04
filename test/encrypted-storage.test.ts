import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AnnotationStore, ANNOTATION_MESSAGE_TYPE, type PersistedNoteItem } from "../src/annotation-store";
import { QueueStore, QUEUE_MESSAGE_TYPE } from "../src/queue-store";

let factory: IDBFactory;
let opened: Array<{ close(): Promise<void> }>;
const key = "chatgpt:private-conversation-identifier";
const queueName = "crypto-test-queue";
const noteName = "crypto-test-notes";
const queueText = "A confidential queued message not visible in database records";
const note: PersistedNoteItem = { id: "note-private", messageId: "private-message", messageExcerpt: "private excerpt",
  quote: "private quote", comment: "private comment", contextBefore: "before", contextAfter: "after", createdAt: 1 };

beforeEach(() => { factory = new IDBFactory(); opened = []; });
afterEach(async () => { await Promise.all(opened.map(store => store.close())); });
function queue() { const store = new QueueStore(factory, queueName); opened.push(store); return store; }
function annotations() { const store = new AnnotationStore(factory, noteName); opened.push(store); return store; }
function enqueue(store = queue(), id = "private-message") {
  return store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "test", action: "enqueue", id, text: queueText }, "owner", 1);
}
function readQueue(store = queue()) { return store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "test", action: "read" }, "owner", 1); }
function saveNote(store = annotations()) { return store.apply({ type: ANNOTATION_MESSAGE_TYPE, key, action: "upsert", notes: [note] }, 1); }
async function database(name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function raw(name: string, table: string): Promise<any[]> {
  const db = await database(name);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(table);
      const request = tx.objectStore(table).getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function alter(name: string, table: string, change: (table: IDBObjectStore) => void): Promise<void> {
  const db = await database(name);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(table, "readwrite");
      change(tx.objectStore(table));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function legacy(name: string, table: string, values: unknown[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(table, { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(table, "readwrite");
      values.forEach(value => tx.objectStore(table).put(value));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
function legacyQueue(otherKey = key) { return { key: otherKey, revision: 3, paused: true,
  items: [{ id: "private-message", text: queueText, createdAt: 1, status: "queued" }] }; }

describe("encrypted durable queue and notes", () => {
  test("stores only opaque record IDs/ciphertext, with nonextractable AES-256 keys", async () => {
    await enqueue(); await saveNote();
    for (const [name, table] of [[queueName, "queues"], [noteName, "annotations"]]) {
      expect(await raw(name!, table!)).toEqual([]);
      const records = await raw(name!, "encrypted-records");
      expect(records).toHaveLength(1);
      expect(Object.keys(records[0]).sort()).toEqual(["ciphertext", "format", "id", "iv", "keyToken"]);
      expect(records[0].id).toMatch(/^[0-9a-f]{64}$/);
      expect(records[0].iv.byteLength).toBe(12);
      const diskText = JSON.stringify(records) + new TextDecoder().decode(records[0].ciphertext);
      for (const secret of [key, queueText, note.id, note.messageId, note.comment, note.quote]) expect(diskText).not.toContain(secret);
      const [storedKey] = await raw(name!, "encryption-keys");
      expect(storedKey.key.extractable).toBe(false);
      expect(storedKey.key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
      await expect(crypto.subtle.exportKey("raw", storedKey.key)).rejects.toThrow();
    }
  });

  test("each committed update uses a fresh IV, while reopening decrypts the saved record", async () => {
    const store = queue(); await enqueue(store);
    const [before] = await raw(queueName, "encrypted-records");
    await store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: "test", action: "pause", paused: true }, "owner", 1);
    const [after] = await raw(queueName, "encrypted-records");
    expect(after.id).toBe(before.id);
    expect(after.iv).not.toEqual(before.iv);
    expect(after.ciphertext).not.toEqual(before.ciphertext);
    await store.close();
    expect((await readQueue()).state).toMatchObject({ key, paused: true, items: [{ text: queueText }] });
  });

  test("first use migrates every legacy record, including conversations not requested", async () => {
    await legacy(queueName, "queues", [legacyQueue(), legacyQueue("claude:another-private-conversation")]);
    await legacy(noteName, "annotations", [{ key, revision: 2, notes: [note], tombstones: [{ id: "deleted-private", createdAt: 1 }] }]);
    expect((await readQueue()).state.items[0]?.text).toBe(queueText);
    expect((await annotations().apply({ type: ANNOTATION_MESSAGE_TYPE, key, action: "read" })).notes).toEqual([note]);
    expect(await raw(queueName, "queues")).toEqual([]);
    expect(await raw(noteName, "annotations")).toEqual([]);
    expect(await raw(queueName, "encrypted-records")).toHaveLength(2);
    expect(await raw(noteName, "encrypted-records")).toHaveLength(1);
  });

  test("an aborted encrypted migration commit retains the original plaintext and retries safely", async () => {
    await legacy(queueName, "queues", [legacyQueue()]);
    const original = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
        const result = original.apply(this, args);
        if (this.name === "encrypted-records") this.transaction.abort();
        return result;
      };
      await expect(readQueue()).rejects.toThrow();
    } finally { IDBObjectStore.prototype.put = original; }
    expect(await raw(queueName, "queues")).toEqual([legacyQueue()]);
    expect(await raw(queueName, "encrypted-records")).toEqual([]);
    expect((await readQueue()).state.items[0]?.text).toBe(queueText);
    expect(await raw(queueName, "queues")).toEqual([]);
  });

  test("interruption between encrypted commit and source deletion leaves two recoverable copies", async () => {
    await legacy(queueName, "queues", [legacyQueue()]);
    const original = IDBObjectStore.prototype.delete;
    let encryptedCommitFinished = false;
    const originalPut = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
        if (this.name === "encrypted-records") {
          expect(this.transaction.durability).toBe("strict");
          this.transaction.addEventListener("complete", () => { encryptedCommitFinished = true; });
        }
        return originalPut.apply(this, args);
      };
      IDBObjectStore.prototype.delete = function (...args: Parameters<typeof original>) {
        if (this.name === "queues") {
          expect(encryptedCommitFinished).toBe(true);
          expect(this.transaction.durability).toBe("strict");
          this.transaction.abort();
        }
        return original.apply(this, args);
      };
      await expect(readQueue()).rejects.toThrow();
    } finally { IDBObjectStore.prototype.delete = original; IDBObjectStore.prototype.put = originalPut; }
    expect(await raw(queueName, "queues")).toEqual([legacyQueue()]);
    const [encrypted] = await raw(queueName, "encrypted-records");
    expect(encrypted).toBeDefined();
    expect((await readQueue()).state.items[0]?.text).toBe(queueText);
    expect(await raw(queueName, "queues")).toEqual([]);
  });

  test.each(["ciphertext", "iv", "id", "keyToken"])("tampered %s fails closed and preserves its stored record", async field => {
    const store = queue(); await enqueue(store); await store.close();
    const [record] = await raw(queueName, "encrypted-records");
    if (field === "ciphertext") { const bytes = new Uint8Array(record.ciphertext); bytes[0] ^= 1; }
    else if (field === "iv") record.iv[0] ^= 1;
    else if (field === "keyToken") record.keyToken = "incorrect-key";
    else {
      // Move a ciphertext to another valid conversation's opaque index.
      const other = queue(); await other.apply({ type: QUEUE_MESSAGE_TYPE, key: "claude:other", clientId: "test", action: "enqueue", id: "other", text: "other" }, "owner", 1); await other.close();
      const records = await raw(queueName, "encrypted-records");
      record.id = records.find(entry => entry.id !== record.id).id;
    }
    await alter(queueName, "encrypted-records", table => table.put(record));
    const targetKey = field === "id" ? "claude:other" : key;
    await expect(queue().apply({ type: QUEUE_MESSAGE_TYPE, key: targetKey, clientId: "test", action: "read" }, "owner", 1)).rejects.toThrow("could not be decrypted or verified");
    expect((await raw(queueName, "encrypted-records")).find(entry => entry.id === record.id)).toEqual(record);
  });

  test("missing encryption key never creates a replacement over existing ciphertext", async () => {
    const store = queue(); await enqueue(store); await store.close();
    const encrypted = await raw(queueName, "encrypted-records");
    await alter(queueName, "encryption-keys", table => table.delete("record-key"));
    await expect(readQueue()).rejects.toThrow("encryption key is missing");
    expect(await raw(queueName, "encryption-keys")).toEqual([]);
    expect(await raw(queueName, "encrypted-records")).toEqual(encrypted);
  });

  test("simultaneous new connections share one key and only one claimant wins", async () => {
    const stores = Array.from({ length: 12 }, () => queue());
    await Promise.all(stores.map((store, index) => enqueue(store, `message-${index}`)));
    expect(await raw(queueName, "encryption-keys")).toHaveLength(1);
    expect((await readQueue()).state.items).toHaveLength(12);
    const claimed = await Promise.all(stores.map((store, index) => store.apply({ type: QUEUE_MESSAGE_TYPE, key, clientId: `client-${index}`, action: "claim" }, `owner-${index}`, 1)));
    expect(claimed.filter(result => result.claimed)).toHaveLength(1);
  });

  test("simultaneous migration and subsequent writers preserve the original and every new item", async () => {
    await legacy(queueName, "queues", [legacyQueue()]);
    await Promise.all(Array.from({ length: 8 }, (_, index) => enqueue(queue(), `new-${index}`)));
    expect(await raw(queueName, "queues")).toEqual([]);
    const result = await readQueue();
    expect(result.state.paused).toBe(true);
    expect(result.state.items).toHaveLength(9);
    expect(result.state.items[0]?.text).toBe(queueText);
    expect(new Set(result.state.items.map(item => item.id)).size).toBe(9);
  });

  test("conflicting legacy/ciphertext copies are both preserved instead of choosing one", async () => {
    const store = queue(); await enqueue(store); await store.close();
    const encrypted = await raw(queueName, "encrypted-records");
    await alter(queueName, "queues", table => table.put(legacyQueue()));
    await expect(readQueue()).rejects.toThrow("Both copies have been preserved");
    expect(await raw(queueName, "queues")).toEqual([legacyQueue()]);
    expect(await raw(queueName, "encrypted-records")).toEqual(encrypted);
  });

  test("key persistence failure leaves legacy data intact and does not permanently poison retry", async () => {
    await legacy(queueName, "queues", [legacyQueue()]);
    const store = queue();
    const original = IDBObjectStore.prototype.add;
    try {
      IDBObjectStore.prototype.add = function (...args: Parameters<typeof original>) {
        if (this.name === "encryption-keys") throw new DOMException("Key storage unavailable", "QuotaExceededError");
        return original.apply(this, args);
      };
      await expect(readQueue(store)).rejects.toThrow("Key storage unavailable");
    } finally { IDBObjectStore.prototype.add = original; }
    expect(await raw(queueName, "queues")).toEqual([legacyQueue()]);
    expect(await raw(queueName, "encryption-keys")).toEqual([]);
    expect((await readQueue(store)).state.items[0]?.text).toBe(queueText);
  });

  test("slow encryption leaves no IndexedDB transaction active or partial mutation visible", async () => {
    const store = queue(); await enqueue(store);
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    try {
      crypto.subtle.encrypt = async (...args: Parameters<typeof original>) => { entered(); await paused; return original(...args); };
      const pending = enqueue(store, "second");
      await started;
      // A readwrite transaction can complete while crypto is suspended.
      await alter(queueName, "encrypted-records", table => { table.count(); });
      expect((await readQueue()).state.items).toHaveLength(1);
      release(); await pending;
      expect((await readQueue()).state.items).toHaveLength(2);
    } finally { release?.(); crypto.subtle.encrypt = original; }
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { getQueueKey, QUEUE_BUSY_MS, QUEUE_CLAIM_MS, QUEUE_EDIT_MS, QUEUE_MESSAGE_TYPE, QUEUE_SEND_TIMEOUT_MS, QueueStore, type QueueAction, type QueueRequest } from "../src/queue-store";

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


describe("persistent AI conversation queue", () => {
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

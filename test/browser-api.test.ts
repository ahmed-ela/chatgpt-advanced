import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { getExtensionApi, type ExtensionGlobals, type ExtensionListener } from "../src/browser-api";
import { AnnotationStore, ANNOTATION_CHANGED_TYPE, ANNOTATION_MESSAGE_TYPE, type AnnotationResponse, type PersistedNoteItem } from "../src/annotation-store";
import { registerAnnotationWorker } from "../src/queue-worker";

describe("WebExtension runtime compatibility", () => {
  test("prefers Firefox's Promise API, preserves receivers, and sends only once", async () => {
    const calls: unknown[][] = [];
    let reloads = 0;
    const runtime = {
      async sendMessage(...args: unknown[]) { expect(this).toBe(runtime); calls.push(args); return { ok: true }; },
      reload() { expect(this).toBe(runtime); reloads++; },
    };
    const tabs = {
      async query(...args: unknown[]) { expect(this).toBe(tabs); calls.push(args); return [{ id: 7 }]; },
      async sendMessage(...args: unknown[]) { expect(this).toBe(tabs); calls.push(args); return { safe: true }; },
    };
    const api = getExtensionApi({ browser: { runtime, tabs }, chrome: { runtime: { sendMessage() { throw new Error("Wrong namespace"); } } } })!;
    const message = { action: "save" };
    expect(await api.runtime.sendMessage(message)).toEqual({ ok: true });
    expect(await api.tabs!.query({})).toEqual([{ id: 7 }]);
    expect(await api.tabs!.sendMessage(7, message, { frameId: 0 })).toEqual({ safe: true });
    api.runtime.reload!();
    expect(calls).toEqual([[message], [{}], [7, message, { frameId: 0 }]]);
    expect(reloads).toBe(1);
  });

  test("callback-only Chrome waits for the actual reply and reads transient lastError", async () => {
    let reply: ((value: unknown) => void) | undefined;
    let calls = 0;
    const runtime = {
      lastError: undefined as { message: string } | undefined,
      sendMessage(_message: unknown, callback?: (value: unknown) => void) { expect(this).toBe(runtime); calls++; reply = callback; },
    };
    const api = getExtensionApi({ chrome: { runtime } })!;
    let settled = false;
    const pending = api.runtime.sendMessage({ action: "save" }).then(value => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    reply!({ ok: true, revision: 1 });
    expect(await pending).toEqual({ ok: true, revision: 1 });
    const failed = api.runtime.sendMessage({ action: "read" });
    runtime.lastError = { message: "The receiving end does not exist." };
    reply!(undefined);
    runtime.lastError = undefined;
    await expect(failed).rejects.toThrow("The receiving end does not exist.");
    expect(calls).toBe(2);
  });

  test("callback-only Chrome normalizes tab query and targeted broadcasts", async () => {
    const calls: unknown[][] = [];
    const runtime = { lastError: undefined as { message: string } | undefined };
    const tabs = {
      query(info: Record<string, never>, reply?: (value: unknown) => void) { expect(this).toBe(tabs); calls.push([info]); queueMicrotask(() => reply!([{ id: 11 }])); },
      sendMessage(id: number, message: unknown, options: { frameId: number } | undefined, reply?: (value: unknown) => void) {
        expect(this).toBe(tabs); calls.push([id, message, options]);
        queueMicrotask(() => { runtime.lastError = { message: "Tab closed" }; reply!(undefined); runtime.lastError = undefined; });
      },
    };
    const api = getExtensionApi({ chrome: { runtime, tabs } })!;
    expect(await api.tabs!.query({})).toEqual([{ id: 11 }]);
    await expect(api.tabs!.sendMessage(11, { changed: true }, { frameId: 0 })).rejects.toThrow("Tab closed");
    expect(calls).toEqual([[{}], [11, { changed: true }, { frameId: 0 }]]);
  });

  test.each(["browser", "chrome"] as const)("%s propagates Promise failures and synchronous context errors without retry", async namespace => {
    let calls = 0;
    const scope: ExtensionGlobals = { [namespace]: { runtime: { sendMessage() { calls++; return Promise.reject(new Error("Port closed")); } } } };
    await expect(getExtensionApi(scope)!.runtime.sendMessage({})).rejects.toThrow("Port closed");
    scope[namespace]!.runtime!.sendMessage = () => { calls++; throw new Error("Extension context invalidated."); };
    await expect(getExtensionApi(scope)!.runtime.sendMessage({})).rejects.toThrow("Extension context invalidated.");
    expect(calls).toBe(2);
  });

  test("supports Promise-returning Chrome implementations without a second call", async () => {
    let calls = 0;
    const api = getExtensionApi({ chrome: { runtime: { async sendMessage() { calls++; return { ok: true }; } } } })!;
    expect(await api.runtime.sendMessage({})).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  test("preserves listener identity, decline returns, and asynchronous sendResponse contract", async () => {
    const listeners: ExtensionListener[] = [];
    const event = { addListener(listener: ExtensionListener) { expect(this).toBe(event); listeners.push(listener); } };
    const api = getExtensionApi({ browser: { runtime: { onMessage: event } } })!;
    const listener: ExtensionListener = (message, _sender, respond) => {
      if (message !== "owned") return;
      queueMicrotask(() => respond({ ok: true }));
      return true;
    };
    api.runtime.onMessage!.addListener(listener);
    expect(listeners[0]).toBe(listener);
    expect(listeners[0]!("unrelated", {}, () => { throw new Error("Must decline"); })).toBeUndefined();
    const response = new Promise(resolve => expect(listeners[0]!("owned", {}, resolve)).toBe(true));
    expect(await response).toEqual({ ok: true });
  });

  test("no extension runtime stays unavailable; missing methods reject clearly", async () => {
    expect(getExtensionApi({})).toBeUndefined();
    await expect(getExtensionApi({ browser: { runtime: {} } })!.runtime.sendMessage({})).rejects.toThrow("messaging is unavailable");
  });

  test.each(["browser", "chrome"] as const)("%s carries durable worker responses and cross-tab notifications", async namespace => {
    const listeners: ExtensionListener[] = [];
    const notifications: unknown[][] = [];
    const sender = { tab: { id: 4, url: "https://chatgpt.com/c/runtime-test" }, url: "https://chatgpt.com/c/runtime-test", frameId: 0 };
    const exchange = (message: unknown) => new Promise<unknown>(resolve => {
      expect(listeners[0]!(message, sender, resolve)).toBe(true);
    });
    const runtime = {
      onMessage: { addListener(listener: ExtensionListener) { listeners.push(listener); } },
      sendMessage(message: unknown, reply?: (value: unknown) => void) {
        const response = exchange(message);
        if (namespace === "browser") { expect(reply).toBeUndefined(); return response; }
        void response.then(reply); // Legacy Chrome provides no Promise.
      },
    };
    const tabs = { sendMessage(id: number, message: unknown, options: { frameId: number } | undefined, reply?: (value: unknown) => void) {
      notifications.push([id, message, options]);
      if (namespace === "browser") return Promise.resolve(undefined);
      queueMicrotask(() => reply!(undefined));
    } };
    const api = getExtensionApi({ [namespace]: { runtime, tabs } })!;
    const factory = new IDBFactory();
    const store = new AnnotationStore(factory, `api-${namespace}`);
    const key = "chatgpt:runtime-test";
    const note: PersistedNoteItem = { id: "note", messageId: "assistant", messageExcerpt: "Answer", quote: "selected words", comment: "Keep this thought",
      contextBefore: "", contextAfter: "", startOffset: 0, endOffset: 14, createdAt: 1 };
    registerAnnotationWorker({ runtime: { onMessage: api.runtime.onMessage! }, tabs: api.tabs }, store);
    try {
      const reply = await api.runtime.sendMessage({ type: ANNOTATION_MESSAGE_TYPE, key, action: "upsert", notes: [note] }) as AnnotationResponse;
      expect(reply).toMatchObject({ ok: true, notes: [note], revision: 1 });
      expect(notifications).toEqual([[4, { type: ANNOTATION_CHANGED_TYPE, key, revision: 1 }, { frameId: 0 }]]);
      await store.close();
      const reopened = new AnnotationStore(factory, `api-${namespace}`);
      try { expect((await reopened.apply({ type: ANNOTATION_MESSAGE_TYPE, key, action: "read" })).notes).toEqual([note]); }
      finally { await reopened.close(); }
      // Invalid writes must return the worker's failure, never a synthetic ACK.
      expect(await api.runtime.sendMessage({ type: ANNOTATION_MESSAGE_TYPE, key, action: "upsert", notes: [{ ...note, id: "" }] })).toMatchObject({ ok: false });
    } finally { await store.close(); }
  });
});

import { describe, expect, test } from "bun:test";
import { registerDevReload, allExtensionPagesSafe, type DevReloadRuntime, type DevReloadTabs } from "../src/dev-worker";

type Listener = Parameters<DevReloadRuntime["onMessage"]["addListener"]>[0];
type Sender = Parameters<Listener>[1];

function harness(fetchVersion: (input: string, init?: RequestInit) => Promise<Response> = async () => new Response(JSON.stringify({ buildId: "new-build" })), canReload: () => Promise<boolean> = async () => true) {
  let listener: Listener | undefined;
  let reloads = 0;
  const scheduled: Array<{ run: () => void | Promise<void>; delayMs: number }> = [];
  registerDevReload({
    reload: () => { reloads++; },
    onMessage: { addListener: (callback) => { listener = callback; } },
  }, { origin: "http://127.0.0.1:19445", workerBuildId: "worker-build", fetchVersion, canReload, schedule: (run, delayMs) => { scheduled.push({ run, delayMs }); } });
  const send = (sender: Sender, message: unknown = { type: "plannotator:dev-reload", buildId: "new-build" }) => {
    let response: unknown;
    listener!(message, sender, reply => { response = reply; });
    return response;
  };
  const sendAsync = (sender: Sender, message: unknown) => new Promise<unknown>(resolve => {
    expect(listener!(message, sender, resolve)).toBe(true);
  });
  return { send, sendAsync, scheduled, reloads: () => reloads };
}

const sender = (url = "https://chatgpt.com/c/conversation"): Sender => ({
  tab: { id: 4, url }, url, frameId: 0,
});

describe("development reload worker", () => {
  test("schedules one extension reload for concurrent requests without tab APIs", async () => {
    const worker = harness();
    const replies = await Promise.all([
      worker.sendAsync(sender(), { type: "plannotator:dev-reload" }),
      worker.sendAsync({ ...sender(), tab: { id: 7, url: sender().url } }, { type: "plannotator:dev-reload" }),
    ]);
    expect(replies).toEqual([{ ok: true, scheduled: true }, { ok: true, scheduled: true }]);
    expect(worker.scheduled).toHaveLength(1);
    expect(worker.scheduled[0]!.delayMs).toBe(160);
    expect(worker.reloads()).toBe(0);
    await worker.scheduled[0]!.run();
    expect(worker.reloads()).toBe(1);
  });

  test.each(["https://chatgpt.com/", "https://chatgpt.com/g/custom/c/thread", "https://claude.ai/", "https://claude.ai/chat/thread", "https://gemini.google.com/app", "https://gemini.google.com/app/thread", "http://localhost:19445/harness.html", "http://127.0.0.1:19445/queue-harness.html"])("allows supported top-level page %s", async url => {
    const worker = harness();
    expect(await worker.sendAsync(sender(url), { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: true });
    expect(worker.scheduled).toHaveLength(1);
  });

  test("works without the tabs permission's optional tab URL", async () => {
    const worker = harness();
    expect(await worker.sendAsync({ tab: { id: 4 }, url: "https://chatgpt.com/c/thread", frameId: 0 }, { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: true });
  });

  test.each([
    {},
    { ...sender(), tab: undefined },
    { ...sender(), tab: { id: -1 } },
    { ...sender(), frameId: 1 },
    { ...sender(), frameId: undefined },
    { ...sender(), url: undefined },
    sender("https://example.com/"),
    sender("https://chatgpt.com.evil.example/"),
    sender("http://chatgpt.com/"),
    sender("http://claude.ai/chat/thread"),
    sender("http://gemini.google.com/app/thread"),
    sender("https://claude.ai.evil.example/chat/thread"),
    sender("https://gemini.google.com.evil.example/app/thread"),
    sender("https://claude.ai:444/chat/thread"),
    sender("https://gemini.google.com:444/app/thread"),
    sender("https://user:password@claude.ai/chat/thread"),
    sender("https://user:password@gemini.google.com/app/thread"),
    { ...sender("https://claude.ai/chat/thread"), tab: { id: 4, url: "https://gemini.google.com/app/thread" } },
    { ...sender("https://gemini.google.com/app/thread"), tab: { id: 4, url: "https://gemini.google.com/app/different" } },
    sender("https://localhost/harness"),
    sender("chrome://extensions/"),
    sender("not-a-url"),
    { ...sender(), tab: { id: 4, url: "https://chatgpt.com/c/different-conversation" } },
    { ...sender(), tab: { id: 4, url: "https://example.com/" } },
  ] satisfies Sender[])("rejects unsupported, stale, or non-top-level sender %#", value => {
    const worker = harness();
    for (const type of ["plannotator:dev-reload", "plannotator:dev-version"]) {
      expect(worker.send(value, { type })).toEqual({ ok: false, error: "Dev reload requires a supported top-level page." });
    }
    expect(worker.scheduled).toHaveLength(0);
    expect(worker.reloads()).toBe(0);
  });

  test("an unsafe tab defers global reload until every page is ready", async () => {
    let safe = false;
    const worker = harness(undefined, async () => safe);
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: false });
    expect(worker.scheduled).toHaveLength(0);
    safe = true;
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: true });
    await worker.scheduled[0]!.run();
    expect(worker.reloads()).toBe(1);
  });

  test("typing in another tab after scheduling prevents invalidation and allows a later retry", async () => {
    let safe = true;
    const worker = harness(undefined, async () => safe);
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: true });
    safe = false;
    await worker.scheduled[0]!.run();
    expect(worker.reloads()).toBe(0);
    safe = true;
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: true });
    expect(worker.scheduled).toHaveLength(2);
    await worker.scheduled[1]!.run();
    expect(worker.reloads()).toBe(1);
  });

  test("a failed global safety check conservatively defers reload", async () => {
    const worker = harness(undefined, async () => { throw new Error("tabs unavailable"); });
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-reload" })).toEqual({ ok: true, scheduled: false });
    expect(worker.scheduled).toHaveLength(0);
  });

  test("ignores unrelated and malformed messages", () => {
    const worker = harness();
    for (const message of [null, 1, "plannotator:dev-reload", { type: "plannotator:queue" }]) expect(worker.send(sender(), message)).toBeUndefined();
    expect(worker.scheduled).toHaveLength(0);
  });

  test("reads version only from configured localhost endpoint without caching", async () => {
    let fetched: { url: unknown; init?: RequestInit } | undefined;
    const worker = harness(async (url, init) => {
      fetched = { url, init };
      return new Response(JSON.stringify({ buildId: "build-42" }));
    });
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-version", url: "https://example.com/" })).toEqual({ ok: true, buildId: "build-42", workerBuildId: "worker-build" });
    expect(fetched?.url).toBe("http://127.0.0.1:19445/__plannotator/version");
    expect(fetched?.init?.cache).toBe("no-store");
    expect(fetched?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(worker.scheduled).toHaveLength(0);
  });

  test.each([{}, { buildId: "" }, { buildId: 12 }])("rejects malformed version payload %#", async payload => {
    const worker = harness(async () => new Response(JSON.stringify(payload)));
    expect(await worker.sendAsync(sender(), { type: "plannotator:dev-version" })).toEqual({ ok: false, error: "Development server returned no build ID." });
    expect(worker.scheduled).toHaveLength(0);
  });

  test("returns unavailable on offline server or HTTP failure without reload", async () => {
    const failing = harness(async () => { throw new Error("offline"); });
    expect(await failing.sendAsync(sender(), { type: "plannotator:dev-version" })).toEqual({ ok: false, error: "offline" });
    const badResponse = harness(async () => new Response("unavailable", { status: 503 }));
    expect(await badResponse.sendAsync(sender(), { type: "plannotator:dev-version" })).toEqual({ ok: false, error: "Development server is unavailable." });
    expect(failing.reloads() + badResponse.reloads()).toBe(0);
  });
});


describe("all-tab development reload safety", () => {
  const makeTabs = (replies: Array<unknown | Error | Promise<unknown>>): DevReloadTabs => ({
    query: async info => { expect(info).toEqual({}); return replies.map((_reply, id) => ({ id })); },
    sendMessage: async (id, message, options) => {
      expect(message).toEqual({ type: "plannotator:dev-can-reload" });
      expect(options).toEqual({ frameId: 0 });
      const reply = replies[id];
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });

  test("explicit safe responders plus unrelated or closed tabs permit reload", async () => {
    const tabs = makeTabs([
      { ok: true, safe: true },
      new Error("Could not establish connection. Receiving end does not exist."),
      new Error("No tab with id: 2."),
    ]);
    expect(await allExtensionPagesSafe(tabs)).toBe(true);
  });

  test.each([
    { ok: true, safe: false }, undefined, { ok: true }, { ok: true, safe: "yes" },
    new Error("The message port closed before a response was received."),
    new Error("Unexpected messaging failure"),
  ])("busy or uncertain page %# prevents global invalidation", async reply => {
    expect(await allExtensionPagesSafe(makeTabs([{ ok: true, safe: true }, reply]))).toBe(false);
  });

  test("an unresponsive page times out conservatively", async () => {
    expect(await allExtensionPagesSafe(makeTabs([new Promise(() => {})]), 10)).toBe(false);
  });

  test("tab enumeration failure or timeout also defers reload", async () => {
    const fail = makeTabs([]);
    fail.query = async () => { throw new Error("query failed"); };
    expect(await allExtensionPagesSafe(fail)).toBe(false);
    fail.query = () => new Promise(() => {});
    expect(await allExtensionPagesSafe(fail, 10)).toBe(false);
  });
});

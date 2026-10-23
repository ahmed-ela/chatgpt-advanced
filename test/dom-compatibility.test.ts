import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { runInContext } from "node:vm";

const fixture = await Bun.file(new URL("./current-layout.html", import.meta.url)).text();
const testSource = process.env.PLANNOTATOR_TEST_SOURCE ?? new URL("../src/content.ts", import.meta.url).pathname;
const helperExpression = `({ getSelectionDraft, findAssistantMessage, getAssistantMessages,
  ensureMessageId, findAssistantMessageById, restorePersistedNote,
  findComposer, isNativeComposerSendKey, isNativeSendButton,
  getComposerText, setComposerText, getConversationStorageKey,
  readPersistedConversationState, getProviderName, bootstrap,
  getDraftText: () => state.draftText, getOrderedNotes })`;
const build = await Bun.build({
  entrypoints: [testSource],
  target: "browser", format: "esm",
  plugins: [{ name: "expose-content-helpers", setup(build) {
    build.onLoad({ filter: /content\.ts$/ }, async args => args.path === testSource
      ? { contents: `${await Bun.file(args.path).text()}\nglobalThis.__contentHelpers = ${helperExpression};`, loader: "ts" }
      : undefined);
  } }],
});
if (!build.success) throw new Error(build.logs.join("\n"));
const compiled = await build.outputs[0]!.text();
const assistantId = "22222222-2222-4222-8222-222222222222";

interface SelectionDraft {
  messageId: string;
  quote: string;
  range: StaticRange | Range;
  messageExcerpt: string;
  contextBefore: string;
  contextAfter: string;
  startOffset: number;
  endOffset: number;
}

interface PersistedNote extends Omit<SelectionDraft, "range"> {
  id: string;
  comment: string;
  createdAt: number;
}

interface ContentHelpers {
  getSelectionDraft(): SelectionDraft | null;
  findAssistantMessage(node: Node): HTMLElement | null;
  getAssistantMessages(): HTMLElement[];
  ensureMessageId(message: HTMLElement): string;
  findAssistantMessageById(id: string): HTMLElement | null;
  restorePersistedNote(note: PersistedNote): (PersistedNote & { range: StaticRange | Range }) | null;
  findComposer(): HTMLElement | HTMLTextAreaElement | null;
  isNativeComposerSendKey(event: KeyboardEvent): boolean;
  isNativeSendButton(target: Element): boolean;
  getComposerText(element: HTMLElement): string;
  setComposerText(element: HTMLElement, value: string): boolean;
  getConversationStorageKey(): string;
  readPersistedConversationState(key: string): PersistedNote[];
  getProviderName(): string;
  bootstrap(): void;
  getDraftText(): string;
  getOrderedNotes(): Array<{ comment: string; quote: string }>;
}

let dom: Window;
let document: Document;
let helpers: ContentHelpers;

beforeEach(() => {
  dom = new Window({
    url: "https://chatgpt.com/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  document = dom.document as unknown as Document;
  document.write(fixture);

  // Bun's VM context does not populate Happy DOM's declared JS builtins.
  Object.assign(dom, { Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise, atob });

  // Exercise production helpers without starting persistent observers or timers.
  // A child-frame context skips the extension's top-frame-only bootstrap.
  Object.defineProperty(dom, "top", { value: {}, configurable: true });

  // The DOM simulator has no layout engine. Supply geometry only; selection,
  // ranges, selectors, DOM mutation and restoration run against actual DOM nodes.
  Object.defineProperties(dom.Range.prototype, {
    getBoundingClientRect: { value: () => new dom.DOMRect(20, 30, 160, 20), configurable: true },
    getClientRects: { value: () => [new dom.DOMRect(20, 30, 160, 20)], configurable: true },
  });
  Object.defineProperty(dom.HTMLElement.prototype, "getClientRects", {
    value: () => [new dom.DOMRect(20, 30, 160, 20)], configurable: true,
  });

  helpers = runInContext(`
    const __PLANNOTATOR_DEV__ = false;
    const __PLANNOTATOR_BUILD_ID__ = "test";
    const __PLANNOTATOR_DEV_ORIGIN__ = "";
    ${compiled}
    globalThis.__contentHelpers;
  `, dom) as ContentHelpers;
});

afterEach(async () => {
  await dom.happyDOM.close();
});

function currentAssistant(): HTMLElement {
  return document.querySelector<HTMLElement>(
    `[data-chatgpt-selection-message-id="${assistantId}"] [data-markdown-text-style="assistant-message"]`,
  )!;
}

function selectText(element: Element, quote: string): Range {
  const walker = document.createTreeWalker(element, dom.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const index = (node.textContent ?? "").indexOf(quote);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + quote.length);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }
  throw new Error(`Fixture does not contain text: ${quote}`);
}

describe("ChatGPT DOM compatibility", () => {
  test("selects current assistant text and uses the message UUID on its ancestor", () => {
    const assistant = currentAssistant();
    selectText(assistant, "latency budgets");
    const draft = helpers.getSelectionDraft();

    expect(draft?.quote).toBe("latency budgets");
    expect(draft?.messageId).toBe(assistantId);
    expect(draft?.startOffset).toBe(4);
    expect(draft?.endOffset).toBe(19);
    expect(helpers.findAssistantMessage(assistant.querySelector("p")!.firstChild!) === assistant).toBe(true);
  });

  test("keeps message IDs stable when an earlier assistant is inserted and a message remounts", () => {
    const assistant = currentAssistant();
    const originalMarkup = assistant.outerHTML;
    expect(helpers.ensureMessageId(assistant)).toBe(assistantId);

    const wrapper = assistant.parentElement!;
    wrapper.insertAdjacentHTML("beforebegin", `
      <div data-chatgpt-selection-message-id="44444444-4444-4444-8444-444444444444">
        <div data-markdown-text-style="assistant-message"><p>An earlier loaded reply.</p></div>
      </div>
    `);
    wrapper.innerHTML = originalMarkup;
    const remounted = currentAssistant();

    expect(remounted === assistant).toBe(false);
    expect(helpers.ensureMessageId(remounted)).toBe(assistantId);
    expect(helpers.findAssistantMessageById(assistantId) === remounted).toBe(true);
  });

  test("restores a saved selection after a current message remounts with split text nodes", () => {
    selectText(currentAssistant(), "latency budgets");
    const draft = helpers.getSelectionDraft();
    expect(draft).not.toBeNull();
    if (!draft) return;
    const { range: _range, ...persistedDraft } = draft;
    const persisted: PersistedNote = {
      ...persistedDraft,
      id: "saved-note",
      comment: "Give an example.",
      createdAt: 1,
    };
    currentAssistant().parentElement!.innerHTML = `
      <div data-markdown-text-style="assistant-message"><p>Set <strong>latency</strong> budgets for each request stage.</p><p>Preserve throughput and correctness.</p></div>
    `;

    const restored = helpers.restorePersistedNote(persisted);
    expect(restored?.messageId).toBe(assistantId);
    expect(restored?.quote).toBe("latency budgets");
    expect(restored?.range.startContainer.isConnected).toBe(true);
    expect(restored?.range.endContainer.isConnected).toBe(true);
    const liveRange = document.createRange();
    liveRange.setStart(restored!.range.startContainer, restored!.range.startOffset);
    liveRange.setEnd(restored!.range.endContainer, restored!.range.endOffset);
    expect(liveRange.toString()).toBe("latency budgets");
  });

  test("continues to select legacy assistant markup", () => {
    const legacy = document.querySelector<HTMLElement>("[data-message-id='legacy-assistant']")!;
    selectText(legacy, "legacy assistant response");

    expect(helpers.getSelectionDraft()?.quote).toBe("legacy assistant response");
    expect(helpers.getSelectionDraft()?.messageId).toBe("legacy-assistant");
    expect(helpers.getAssistantMessages().includes(legacy)).toBe(true);
  });

  test("lists current and legacy assistant messages together", () => {
    expect(helpers.getAssistantMessages()).toHaveLength(3);
    expect(helpers.getAssistantMessages().includes(currentAssistant())).toBe(true);
  });

  test("avoids duplicate messages when legacy and current attributes coexist", () => {
    const assistant = currentAssistant();
    const wrapper = assistant.parentElement!;
    wrapper.setAttribute("data-message-author-role", "assistant");
    wrapper.setAttribute("data-message-id", assistantId);
    const message = helpers.findAssistantMessage(assistant.querySelector("p")!.firstChild!)!;
    expect(helpers.getAssistantMessages()).toHaveLength(3);
    expect(helpers.getAssistantMessages().filter((entry) => entry === message)).toHaveLength(1);
    expect(helpers.ensureMessageId(message)).toBe(assistantId);
  });

  test("rejects current and legacy user messages", () => {
    const currentUser = document.querySelector<HTMLElement>("[data-markdown-text-style='user-message']")!;
    selectText(currentUser, "latency tradeoff");
    expect(helpers.getSelectionDraft()).toBeNull();
    expect(helpers.findAssistantMessage(currentUser)).toBeNull();

    const legacyUser = document.querySelector<HTMLElement>("[data-message-id='legacy-user']")!;
    selectText(legacyUser, "legacy user request");
    expect(helpers.getSelectionDraft()).toBeNull();
    expect(helpers.findAssistantMessage(legacyUser)).toBeNull();
  });

  test("rejects a selection spanning two assistant messages", () => {
    const first = currentAssistant().querySelector("p")!.firstChild!;
    const second = document.querySelector<HTMLElement>(
      "[data-chatgpt-selection-message-id='33333333-3333-4333-8333-333333333333'] p",
    )!.firstChild!;
    const range = document.createRange();
    range.setStart(first, 4);
    range.setEnd(second, 7);
    document.getSelection()!.addRange(range);
    expect(helpers.getSelectionDraft()).toBeNull();
  });

  test("finds the current composer without a form or prompt-textarea ID", () => {
    const composer = document.querySelector<HTMLElement>("[data-composer-markdown]")!;
    expect(document.querySelector("form, #prompt-textarea")).toBeNull();
    expect(helpers.findComposer() === composer).toBe(true);

    composer.innerHTML = "<p>Explain more.</p>";
    let sendKeyRecognized = false;
    composer.addEventListener("keydown", (event) => {
      sendKeyRecognized = helpers.isNativeComposerSendKey(event);
    });
    composer.querySelector("p")!.dispatchEvent(new dom.KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, composed: true,
    }) as unknown as KeyboardEvent);
    expect(sendKeyRecognized).toBe(true);
  });

  test("continues to find the legacy textarea composer", () => {
    document.querySelector("[data-composer-markdown]")!.remove();
    const legacy = document.createElement("textarea");
    legacy.id = "prompt-textarea";
    document.body.append(legacy);
    expect(helpers.findComposer() === legacy).toBe(true);
  });

  test.each(["Stop", "Stop generating", "STOP GENERATING", "Pause", "Pause response"])("does not treat reused submit button %s as an annotation send", (label) => {
    const button = document.createElement("button");
    button.id = "composer-submit-button";
    button.setAttribute("aria-label", label);
    button.innerHTML = "<span>Stop icon</span>";
    document.querySelector("section[aria-label='Message composer'] button")!.replaceWith(button);
    expect(helpers.isNativeSendButton(button)).toBe(false);
    expect(helpers.isNativeSendButton(button.firstElementChild!)).toBe(false);
    button.setAttribute("aria-label", "Send");
    expect(helpers.isNativeSendButton(button)).toBe(true);
    button.setAttribute("data-testid", "stop-button");
    expect(helpers.isNativeSendButton(button)).toBe(false);
  });
});

// Minimal structures from the Claude/Gemini live DOM captured on 2026-10-03.
// Sample response text keeps fixtures independent of personal conversation data.
const providerFixtures = [
  {
    provider: "Claude",
    url: "https://claude.ai/chat/11111111-2222-4333-8444-555555555555",
    assistant: "[data-perf-reply-text]",
    user: "[data-testid='user-message']",
    html: `<div role="feed" data-perf-region="transcript">
      <div data-testid="transcript-row" data-index="0" data-perf-row="human" data-perf-row-streaming="false"><div data-testid="user-message"><p>Please compare the moon and ocean.</p></div></div>
      <div data-testid="transcript-row" data-index="1" data-perf-row="assistant" data-perf-row-streaming="false"><div data-testid="assistant-message" data-is-streaming="false"><div data-perf-reply-text><p>The moon reflects sunlight.</p><p>The ocean holds salt water.</p></div></div><div role="toolbar"><button aria-label="Copy">Copy</button><button aria-label="Good response" data-testid="action-bar-thumbs-up">Like</button></div></div>
      </div><div data-cds="ChatComposer"><div data-testid="chat-input" role="textbox" contenteditable="true"><p></p></div><button aria-label="Send message"><span>Send</span></button></div>`,
  },
  {
    provider: "Gemini",
    url: "https://gemini.google.com/app/abcd1234ef567890",
    assistant: "model-response message-content .markdown",
    user: "user-query .query-text",
    html: `<div class="conversation-container" id="turn-1"><user-query><div class="query-text"><div class="query-text-line">Please compare the moon and ocean.</div></div></user-query>
      <model-response><message-content id="model-response-message-contentr_turn-1"><div class="markdown" aria-busy="false"><p>The moon reflects sunlight.</p><p>The ocean holds salt water.</p></div></message-content><div class="response-footer complete"><button aria-label="Copy">Copy</button><button aria-label="Good response">Like</button></div></model-response></div>
      <input-area-v2><rich-textarea><div class="ql-editor" role="textbox" contenteditable="true"><p><br></p></div></rich-textarea><button aria-label="Send message"><span>Send</span></button></input-area-v2>`,
  },
];

for (const fixture of providerFixtures) {
  describe(`${fixture.provider} annotations`, () => {
    beforeEach(() => {
      dom.happyDOM.setURL(fixture.url);
      document.body.innerHTML = fixture.html;
    });

    test("selects assistant text while excluding user messages and action toolbars", () => {
      const assistant = document.querySelector<HTMLElement>(fixture.assistant)!;
      selectText(assistant, "reflects sunlight");
      const draft = helpers.getSelectionDraft();
      expect(draft?.quote).toBe("reflects sunlight");
      expect(draft?.messageId.startsWith(fixture.provider.toLowerCase() + ":")).toBe(true);
      expect(helpers.getAssistantMessages()).toEqual([assistant]);
      expect(helpers.findAssistantMessage(document.querySelector("[aria-label='Copy']")!)).toBeNull();
      selectText(document.querySelector(fixture.user)!, "compare the moon");
      expect(helpers.getSelectionDraft()).toBeNull();
      expect(helpers.getProviderName()).toBe(fixture.provider);
    });

    test("restores a saved annotation after transcript remount and text-node splitting", () => {
      selectText(document.querySelector(fixture.assistant)!, "reflects sunlight");
      const { range: _range, ...draft } = helpers.getSelectionDraft()!;
      const saved: PersistedNote = { ...draft, id: "saved-note", comment: "Explain the reflection.", createdAt: 1 };
      const key = helpers.getConversationStorageKey();
      dom.localStorage.setItem(key, JSON.stringify([saved]));
      document.body.innerHTML = fixture.html;
      document.querySelector(fixture.assistant)!.innerHTML = "<p>The moon <strong>reflects</strong> sunlight.</p><p>The ocean holds salt water.</p>";
      const persisted = helpers.readPersistedConversationState(key)[0]!;
      const restored = helpers.restorePersistedNote(persisted)!;
      expect(restored.messageId).toBe(saved.messageId);
      expect(restored.comment).toBe("Explain the reflection.");
      const range = document.createRange();
      range.setStart(restored.range.startContainer, restored.range.startOffset);
      range.setEnd(restored.range.endContainer, restored.range.endOffset);
      expect(range.toString()).toBe("reflects sunlight");
    });

    test("inserts multiline plain text into its native composer without sending", () => {
      const composer = helpers.findComposer()!;
      let input = 0;
      let clicks = 0;
      composer.addEventListener("input", () => input++);
      const send = document.querySelector("[aria-label='Send message']")!;
      send.addEventListener("click", () => clicks++);
      expect(helpers.setComposerText(composer, "user: Explain the reflection.\nresponding to AI selected text: reflects sunlight")).toBe(true);
      expect(helpers.getComposerText(composer)).toContain("\nresponding to AI selected text:");
      expect(input).toBeGreaterThan(0);
      expect(clicks).toBe(0);
      expect(helpers.isNativeSendButton(send.firstElementChild!)).toBe(true);
      send.setAttribute("aria-label", "Stop response");
      expect(helpers.isNativeSendButton(send)).toBe(false);
    });

    test("preserves the storage key format and isolates provider routes", () => {
      const firstKey = helpers.getConversationStorageKey();
      expect(firstKey).toBe(`plannotator-chatgpt-notes:v1:${fixture.url}`);
      dom.localStorage.setItem(firstKey, JSON.stringify([]));
      dom.happyDOM.setURL(fixture.url + "-another-conversation");
      expect(helpers.getConversationStorageKey()).not.toBe(firstKey);
      expect(helpers.readPersistedConversationState(helpers.getConversationStorageKey())).toEqual([]);
    });

    test("keeps note typing and paste away from native document-capture composer shortcuts", () => {
      let nativeEvents = 0;
      const nativeComposer = helpers.findComposer()!;
      const originalComposerText = helpers.getComposerText(nativeComposer);
      // Register before the extension, matching a pre-existing app handler.
      for (const type of ["keydown", "keypress", "keyup", "beforeinput", "input", "paste"]) {
        document.addEventListener(type, () => { nativeEvents++; nativeComposer.focus(); }, true);
      }
      helpers.bootstrap();
      const shadow = document.getElementById("plannotator-chatgpt-root")!.shadowRoot!;
      const field = document.createElement("textarea");
      field.dataset.field = "draft";
      shadow.append(field);
      field.focus();
      for (const type of ["keydown", "keypress", "keyup"]) {
        const event = new dom.KeyboardEvent(type, { key: "a", ctrlKey: true, bubbles: true, composed: true, cancelable: true });
        field.dispatchEvent(event as unknown as Event);
        expect(event.defaultPrevented).toBe(false);
      }
      field.dispatchEvent(new dom.Event("paste", { bubbles: true, composed: true, cancelable: true }) as unknown as Event);
      field.dispatchEvent(new dom.InputEvent("beforeinput", { data: "Keep this note", bubbles: true, composed: true, cancelable: true }) as unknown as Event);
      field.value = "Keep this note";
      field.dispatchEvent(new dom.InputEvent("input", { data: "Keep this note", bubbles: true, composed: true }) as unknown as Event);
      expect(nativeEvents).toBe(0);
      expect(shadow.activeElement).toBe(field);
      expect(helpers.getDraftText()).toBe("Keep this note");
      expect(helpers.getComposerText(nativeComposer)).toBe(originalComposerText);
    });

    test.each(["pointer", "keyboard"])("commits the actual note value and inserts it using %s controls", async (activation) => {
      helpers.bootstrap();
      selectText(document.querySelector(fixture.assistant)!, "reflects sunlight");
      document.dispatchEvent(new dom.Event("selectionchange") as unknown as Event);
      const shadow = document.getElementById("plannotator-chatgpt-root")!.shadowRoot!;
      const deadline = Date.now() + 1500;
      while (!shadow.querySelector("[data-action='open-draft']") && Date.now() < deadline) await Bun.sleep(10);
      const addNote = shadow.querySelector<HTMLButtonElement>("[data-action='open-draft']")!;
      expect(addNote).not.toBeNull();
      // The UI opens on pointerdown to preserve the selected response range.
      if (activation === "pointer") addNote.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, composed: true, cancelable: true }) as unknown as Event);
      addNote.click();
      const field = shadow.querySelector<HTMLTextAreaElement>("textarea[data-field='draft']")!;
      expect(field).not.toBeNull();
      field.value = "Explain reflected light.";
      field.dispatchEvent(new dom.InputEvent("input", { bubbles: true, composed: false }) as unknown as Event);
      expect(helpers.getDraftText()).toBe("Explain reflected light.");
      // A final value change without another input event must still commit.
      field.value = "Explain how the moon affects tides.";
      field.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }) as unknown as Event);
      expect(helpers.getOrderedNotes()).toHaveLength(1);
      expect(helpers.getOrderedNotes()[0]?.comment).toBe("Explain how the moon affects tides.");
      expect(helpers.getOrderedNotes()[0]?.quote).toBe("reflects sunlight");
      expect(shadow.querySelector(`[aria-label='Insert notes into ${fixture.provider}']`)).not.toBeNull();
      expect(helpers.getComposerText(helpers.findComposer()!).trim()).toBe("");
      const insert = shadow.querySelector<HTMLButtonElement>("[data-action='insert-notes']")!;
      if (activation === "pointer") insert.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, composed: true, cancelable: true }) as unknown as Event);
      insert.click();
      const insertedDeadline = Date.now() + 1500;
      while (!helpers.getComposerText(helpers.findComposer()!).includes("Explain how the moon affects tides.") && Date.now() < insertedDeadline) await Bun.sleep(10);
      expect(helpers.getComposerText(helpers.findComposer()!)).toContain("Explain how the moon affects tides.");
      expect(helpers.getComposerText(helpers.findComposer()!)).toContain("reflects sunlight");
      expect(helpers.getOrderedNotes()).toHaveLength(0);
    });
  });
}

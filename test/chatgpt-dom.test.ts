import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { findQueueComposer, findQueueSendButton, findQueueStopButton, readComposer, writeComposer, isChatBusy, hasComposerAttachments, getVisibleUserMessages, isCurrentConversationReady, getCurrentConversationReadiness, isEmptyNewChat, getAssistantCompletionAfter, registerNewConversationAlias, clearConversationAlias } from "../src/chatgpt-dom";

let dom: Window;
let document: Document;
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const globals = ["window", "document", "HTMLElement", "HTMLTextAreaElement", "HTMLButtonElement", "Event", "InputEvent"] as const;
let originals: PropertyDescriptor[];

function layout(button = '<button data-testid="send-button" aria-label="Send prompt">Send</button>'): void {
  document.body.innerHTML = `<main>
    <div data-chatgpt-search-unit-key="one:user"><div data-chatgpt-selection-message-id="user-1" data-chatgpt-selection-conversation-id="${id}"><p>First question.</p></div><button>Edit</button></div>
    <div data-chatgpt-search-unit-key="two:assistant"><div data-chatgpt-selection-message-id="assistant-1" data-chatgpt-selection-conversation-id="${id}"><div data-markdown-text-style="assistant-message"><p>First answer.</p></div></div><button data-testid="copy-turn-action-button">Copy</button></div>
    </main><div data-composer-body><div data-composer-footer-responsive><div data-composer-input><div data-composer-markdown contenteditable="true" role="textbox"></div></div>${button}</div></div>`;
}

beforeEach(() => {
  clearConversationAlias();
  dom = new Window({ url: `https://chatgpt.com/c/${id}` });
  document = dom.document as unknown as Document;
  originals = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key)!);
  for (const key of globals) Object.defineProperty(globalThis, key, { value: key === "window" ? dom : key === "document" ? document : dom[key], configurable: true, writable: true });
  Object.defineProperty(dom.HTMLElement.prototype, "getClientRects", { value: () => [new dom.DOMRect(0, 0, 100, 20)], configurable: true });
  layout();
});

afterEach(async () => {
  await dom.happyDOM.close();
  globals.forEach((key, index) => {
    if (originals[index]) Object.defineProperty(globalThis, key, originals[index]);
    else Reflect.deleteProperty(globalThis, key);
  });
});

describe("queue DOM adapter", () => {
  test("finds the form-free composer and sibling send control", () => {
    expect(findQueueComposer()?.matches("[data-composer-markdown]")).toBe(true);
    expect(findQueueSendButton()?.getAttribute("aria-label")).toBe("Send prompt");
    expect(isCurrentConversationReady()).toBe(true);
  });

  test.each(["Stop", "Stop generating", "STOP GENERATING", "Stop streaming", "Stop generating response…", "Pause", "Pause response"])("never mistakes %s on composer-submit-button for send", (label) => {
    layout(`<button id="composer-submit-button" aria-label="${label}">Stop</button>`);
    expect(isChatBusy()).toBe(true);
    expect(findQueueSendButton()).toBeNull();
    expect(findQueueStopButton()?.getAttribute("aria-label")).toBe(label);
  });

  test("finds current form-free Stop without clicking it", () => {
    layout('<button aria-label="Stop">Stop</button>');
    let clicks = 0;
    document.querySelector("[aria-label='Stop']")!.addEventListener("click", () => clicks++);
    expect(document.querySelector("form")).toBeNull();
    expect(findQueueStopButton()).toBe(document.querySelector("[aria-label='Stop']"));
    expect(clicks).toBe(0);
  });

  test("stop lookup rejects disabled, aria-disabled and hidden Stop controls", () => {
    layout('<button aria-label="Stop" disabled>Stop</button><button data-testid="stop-button" aria-disabled="true">Stop</button><button aria-label="Stop generating" hidden>Stop</button>');
    expect(findQueueStopButton()).toBeNull();
    document.querySelector("[data-testid='stop-button']")!.removeAttribute("aria-disabled");
    expect(findQueueStopButton()?.getAttribute("data-testid")).toBe("stop-button");
  });

  test("stop lookup ignores unrelated audio Pause and uses only explicit global stop fallback", () => {
    layout('<button aria-label="Pause audio">Pause audio</button><div data-testid="voice-controls"><button aria-label="Pause">Pause voice</button></div>');
    document.body.insertAdjacentHTML("beforeend", '<button aria-label="Pause">Read aloud</button><button aria-label="Stop">Playback</button>');
    expect(findQueueStopButton()).toBeNull();
    document.body.insertAdjacentHTML("beforeend", '<button data-testid="stop-button" aria-label="Stop generating">Stop</button>');
    expect(findQueueStopButton()?.getAttribute("data-testid")).toBe("stop-button");
  });

  test("does not click a reused send ID with an unfamiliar accessible action", () => {
    layout('<button id="composer-submit-button" aria-label="Cancel request">Cancel</button>');
    expect(findQueueSendButton()).toBeNull();
  });

  test("ignores unrelated playback pause and hidden stop controls", () => {
    document.body.insertAdjacentHTML("beforeend", '<button aria-label="Pause">Playback</button><button data-testid="stop-button" hidden>Stop</button>');
    expect(isChatBusy()).toBe(false);
    document.querySelector("[data-testid='stop-button']")!.removeAttribute("hidden");
    expect(isChatBusy()).toBe(true);
  });

  test("does not send through disabled, hidden or unknown buttons", () => {
    layout('<button data-testid="send-button" disabled>Send</button><button type="submit">Unknown</button>');
    expect(findQueueSendButton()).toBeNull();
    document.querySelector("[data-testid='send-button']")!.removeAttribute("disabled");
    document.querySelector<HTMLElement>("[data-composer-body]")!.style.display = "none";
    expect(findQueueSendButton()).toBeNull();
    expect(findQueueComposer()).toBeNull();
  });

  test("writes textarea through native input events without submitting", () => {
    document.querySelector("[data-composer-body]")!.innerHTML = '<form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>';
    const composer = findQueueComposer()!;
    let input = 0;
    let submit = 0;
    composer.addEventListener("input", () => input++);
    document.addEventListener("submit", () => submit++);
    expect(writeComposer(composer, "a\nb")).toBe(true);
    expect(readComposer(composer)).toBe("a\nb");
    expect(input).toBe(1);
    expect(submit).toBe(0);
  });

  test("contenteditable write dispatches input when native editing is unavailable", () => {
    const composer = findQueueComposer()!;
    let input = "";
    composer.addEventListener("input", () => { input = readComposer(composer); });
    expect(writeComposer(composer, "queued <literal>\nnext line")).toBe(true);
    expect(input).toBe("queued <literal>\nnext line");
    expect(composer.querySelector("literal")).toBeNull();
    expect(writeComposer(composer, "")).toBe(true);
  });

  test.each(["cancelled", "not cancelled"] as const)("a hidden controlled editor commits beforeinput once (%s)", handling => {
    const composer = findQueueComposer()!;
    composer.innerHTML = "<p>Existing draft</p>";
    const paragraph = composer.firstElementChild!;
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const text = "Queued <literal>\n    Keep indentation";
    let editorState = "Existing draft";
    let edits = 0;
    let nativeEdits = 0;
    let fallbackInputs = 0;
    let observedEvent: InputEvent | undefined;
    let observedRange: Range | undefined;
    Object.defineProperty(document, "execCommand", { value: () => { nativeEdits++; return false; }, configurable: true });
    composer.addEventListener("input", () => { fallbackInputs++; });
    composer.addEventListener("beforeinput", raw => {
      const event = raw as InputEvent;
      observedEvent = event;
      observedRange = dom.getSelection()!.getRangeAt(0).cloneRange() as unknown as Range;
      // A controlled editor updates its model and renders its managed nodes.
      // The adapter must not replace those nodes or replay this same edit.
      if (handling === "cancelled") event.preventDefault();
      editorState = event.data!;
      paragraph.textContent = editorState;
      edits++;
    });
    expect(writeComposer(composer, text)).toBe(true);
    expect(observedRange?.startContainer).toBe(composer);
    expect(observedRange?.startOffset).toBe(0);
    expect(observedRange?.endContainer).toBe(composer);
    expect(observedRange?.endOffset).toBe(1);
    expect(observedEvent?.bubbles && observedEvent.composed && observedEvent.cancelable).toBe(true);
    expect(observedEvent?.inputType).toBe("insertText");
    expect(observedEvent?.data).toBe(text);
    expect(editorState).toBe(text);
    expect(readComposer(composer)).toBe(text);
    expect(composer.firstElementChild).toBe(paragraph);
    expect(composer.querySelector("literal")).toBeNull();
    expect(edits).toBe(1);
    expect(nativeEdits).toBe(0);
    expect(fallbackInputs).toBe(0);
  });

  test("a controlled editor can reject replacement without losing its original draft", () => {
    const composer = findQueueComposer()!;
    composer.innerHTML = "<p>Keep the original draft</p>";
    const paragraph = composer.firstElementChild;
    let nativeEdits = 0;
    let fallbackInputs = 0;
    Object.defineProperty(document, "execCommand", { value: () => { nativeEdits++; return false; }, configurable: true });
    composer.addEventListener("beforeinput", event => { event.preventDefault(); });
    composer.addEventListener("input", () => { fallbackInputs++; });
    expect(writeComposer(composer, "Rejected replacement")).toBe(false);
    expect(readComposer(composer)).toBe("Keep the original draft");
    expect(composer.firstElementChild).toBe(paragraph);
    expect(nativeEdits).toBe(0);
    expect(fallbackInputs).toBe(0);
  });

  test("a controlled editor receives selected deletion and preserves its empty managed paragraph", () => {
    const composer = findQueueComposer()!;
    composer.innerHTML = "<p>Saved to the queue</p>";
    const paragraph = composer.firstElementChild!;
    let editorState = "Saved to the queue";
    let nativeEdits = 0;
    let observedEvent: InputEvent | undefined;
    let selectedText = "";
    Object.defineProperty(document, "execCommand", { value: () => { nativeEdits++; return false; }, configurable: true });
    composer.addEventListener("beforeinput", raw => {
      const event = raw as InputEvent;
      observedEvent = event;
      selectedText = dom.getSelection()!.toString();
      event.preventDefault();
      editorState = "";
      paragraph.replaceChildren(document.createElement("br"));
    });
    expect(writeComposer(composer, "")).toBe(true);
    expect(observedEvent?.inputType).toBe("deleteContentBackward");
    // HappyDOM normalizes the native event's null deletion data to "".
    expect(observedEvent?.data || null).toBeNull();
    expect(selectedText).toBe("Saved to the queue");
    expect(editorState).toBe("");
    expect(readComposer(composer).trim()).toBe("");
    expect(composer.firstElementChild).toBe(paragraph);
    expect(paragraph.firstElementChild?.tagName).toBe("BR");
    expect(nativeEdits).toBe(0);
  });

  test("recognizes attachment previews/removal controls but not upload picker", () => {
    const scope = document.querySelector("[data-composer-body]")!;
    scope.insertAdjacentHTML("beforeend", '<button aria-label="Add photos and files">+</button><input type="file">');
    expect(hasComposerAttachments()).toBe(false);
    scope.insertAdjacentHTML("beforeend", '<button aria-label="Remove attachment report.pdf">X</button>');
    expect(hasComposerAttachments()).toBe(true);
    scope.querySelector("[aria-label^='Remove']")!.remove();
    scope.insertAdjacentHTML("beforeend", '<div data-file-id="file-1">report.pdf</div>');
    expect(hasComposerAttachments()).toBe(true);
  });

  test("reads only known user roles and excludes action labels, thoughts and tool blocks", () => {
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `
      <div data-chatgpt-selection-message-id="thought"><p>Thinking about tools.</p></div>
      <div data-chatgpt-search-unit-key="tool:tool"><div data-chatgpt-selection-message-id="tool"><p>Tool data.</p></div></div>
      <div data-message-author-role="user" data-message-id="legacy-user"><p>Legacy request.</p></div>
      <div data-chatgpt-selection-message-id="current-user"><div data-markdown-text-style="user-message"><p>Current request.</p></div></div>`);
    expect(getVisibleUserMessages()).toEqual([
      { id: "user-1", text: "First question." },
      { id: "legacy-user", text: "Legacy request." },
      { id: "current-user", text: "Current request." },
    ]);
  });

  test("deduplicates overlapping legacy and current user markers", () => {
    document.querySelector("[data-chatgpt-selection-message-id='user-1']")!.setAttribute("data-message-author-role", "user");
    expect(getVisibleUserMessages()).toHaveLength(1);
  });

  test("user acknowledgement reads never clone assistant replies and see newly added users immediately", () => {
    const assistant = document.querySelector("[data-markdown-text-style='assistant-message']")!;
    Object.defineProperty(assistant, "cloneNode", { value: () => { throw new Error("Assistant text must not be copied for a user-only lookup"); } });
    expect(getVisibleUserMessages()).toEqual([{ id: "user-1", text: "First question." }]);
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<div data-message-author-role="user" data-message-id="user-2"><p>Next question.</p><button>Edit</button></div>');
    expect(getVisibleUserMessages()).toEqual([
      { id: "user-1", text: "First question." },
      { id: "user-2", text: "Next question." },
    ]);
  });

  test("reads live user search IDs and multiline bubbles without selection IDs", () => {
    document.querySelector("main")!.innerHTML = `<div data-chatgpt-search-unit-key="fallback-turn-4:0:user" data-chatgpt-search-message-ids="11111111-1111-4111-8111-111111111111"><div data-user-message-bubble="true"><div data-search-result-target><div><div class="whitespace-pre-wrap" dir="auto">First line.\nSecond line.</div></div></div></div><button>Edit message</button></div>`;
    expect(getVisibleUserMessages()).toEqual([{ id: "11111111-1111-4111-8111-111111111111", text: "First line.\nSecond line." }]);
  });

  test("reads a collapsed plain user bubble without its hidden ellipsis", () => {
    document.querySelector("main")!.innerHTML = '<article data-chatgpt-search-unit-key="22222222-2222-4222-8222-222222222222:user" data-chatgpt-search-message-ids="22222222-2222-4222-8222-222222222222"><div data-user-message-bubble="true"><div data-search-result-target><div><div class="whitespace-pre-wrap" dir="auto">First line.\n    Indented line.\n\nLast paragraph.</div></div></div><span aria-hidden="true" class="block">…</span><button>Show more</button></div></article>';
    expect(getVisibleUserMessages()).toEqual([{
      id: "22222222-2222-4222-8222-222222222222",
      text: "First line.\n    Indented line.\n\nLast paragraph.",
    }]);
    // Reading a cloned bubble must leave the site's collapsed control intact.
    expect(document.querySelector("[aria-hidden='true']")?.textContent).toBe("…");
  });

  test("reads an expanded plain user bubble without changing its whitespace", () => {
    document.querySelector("main")!.innerHTML = '<article data-message-author-role="user" data-message-id="expanded"><div data-user-message-bubble="true"><div class="whitespace-pre-wrap" dir="auto">First  line.\n    Indented line.\n\nLast paragraph.</div><button>Show less</button></div></article>';
    expect(getVisibleUserMessages()).toEqual([{ id: "expanded", text: "First  line.\n    Indented line.\n\nLast paragraph." }]);
  });

  test("preserves a literal trailing ellipsis in collapsed plain user text", () => {
    document.querySelector("main")!.innerHTML = '<article data-message-author-role="user" data-message-id="literal-ellipsis"><div data-user-message-bubble="true"><div class="whitespace-pre-wrap">This submitted sentence ends with …</div><span aria-hidden="true" class="block">…</span><button>Show more</button></div></article>';
    expect(getVisibleUserMessages()).toEqual([{ id: "literal-ellipsis", text: "This submitted sentence ends with …" }]);
  });

  test("removes nested copy exclusions from plain user text only", () => {
    document.querySelector("main")!.innerHTML = '<article data-message-author-role="user" data-message-id="plain-exclusions"><div data-user-message-bubble="true"><div class="whitespace-pre-wrap">First<span aria-hidden="true"><span>Hidden accessibility decoration</span></span>  line.<span data-markdown-copy="exclude"><span>Copy decoration</span></span><br><span hidden><span>Collapsed control</span></span>    Indented line.<button><span>Nested button</span></button><span role="button">Nested action</span><br>Last …</div></div></article><article data-message-author-role="assistant" data-message-id="assistant-exclusions"><div data-markdown-text-style="assistant-message">Answer<span aria-hidden="true"> decoration</span></div></article>';
    expect(getVisibleUserMessages()).toEqual([{ id: "plain-exclusions", text: "First  line.\n    Indented line.\nLast …" }]);
    const composer = findQueueComposer()!;
    composer.innerHTML = '<p>Composer<span aria-hidden="true"> literal content</span></p>';
    expect(readComposer(composer)).toBe("Composer literal content");
    expect(document.querySelector("[data-message-id='assistant-exclusions']")?.textContent).toBe("Answer decoration");
  });

  test("reads rich user paragraphs as blank lines while retaining inline breaks and indentation", () => {
    document.querySelector("main")!.innerHTML = '<article data-chatgpt-search-unit-key="22222222-2222-4222-8222-222222222222:user" data-chatgpt-search-message-ids="22222222-2222-4222-8222-222222222222"><div data-user-message-bubble="true"><div data-markdown-text-tone="user-message"><p><span>First paragraph.</span><br><span>    Indented second line.</span></p><p><span>Second paragraph.</span></p><p><span>Third paragraph.</span><br><span>Another line.</span></p><p><span>Fourth paragraph.</span></p><p><span>Fifth paragraph.</span></p><p><span>Sixth paragraph.</span></p></div><span aria-hidden="true" class="block">t</span><button>Show more</button></div></article>';
    expect(getVisibleUserMessages()).toEqual([{
      id: "22222222-2222-4222-8222-222222222222",
      text: "First paragraph.\n    Indented second line.\n\nSecond paragraph.\n\nThird paragraph.\nAnother line.\n\nFourth paragraph.\n\nFifth paragraph.\n\nSixth paragraph.",
    }]);
  });

  test("excludes rich user copy decorations without changing legacy paragraph or composer boundaries", () => {
    document.querySelector("main")!.innerHTML = '<article data-message-author-role="user" data-message-id="rich"><div data-markdown-text-tone="user-message"><p><span>Literal  spacing</span><span aria-hidden="true">Hidden</span><span data-markdown-copy="exclude">Decoration</span><br><span>next line</span></p><p><span>Last paragraph</span></p></div><span aria-hidden="true">t</span><button>Show more</button></article><article data-message-author-role="user" data-message-id="legacy"><p>First legacy line</p><p>Second legacy line</p></article>';
    expect(getVisibleUserMessages()).toEqual([
      { id: "rich", text: "Literal  spacing\nnext line\n\nLast paragraph" },
      { id: "legacy", text: "First legacy line\nSecond legacy line" },
    ]);
    const composer = findQueueComposer()!;
    composer.innerHTML = '<p>First composer line</p><p>Second composer line</p>';
    expect(readComposer(composer)).toBe("First composer line\nSecond composer line");
  });

  test("preserves empty rich user paragraphs rather than collapsing consecutive blank lines", () => {
    document.querySelector("main")!.innerHTML = '<article data-message-author-role="user" data-message-id="empty-paragraph"><div data-markdown-text-tone="user-message"><p>First paragraph.</p><p></p><p>Last paragraph.</p></div></article>';
    expect(getVisibleUserMessages()).toEqual([{ id: "empty-paragraph", text: "First paragraph.\n\n\n\nLast paragraph." }]);
  });

  test("requires exact user, later assistant and completion toolbar", () => {
    expect(getAssistantCompletionAfter("user-1")).toBe(true);
    expect(getAssistantCompletionAfter("missing-user")).toBe(false);
    document.querySelector("[data-testid='copy-turn-action-button']")!.remove();
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("completion shares one fresh transcript read and rechecks changed completion evidence on the next call", () => {
    const copies = { user: 0, assistant: 0 };
    const bodies = {
      user: document.querySelector("[data-chatgpt-selection-message-id='user-1']")!,
      assistant: document.querySelector("[data-markdown-text-style='assistant-message']")!,
    };
    for (const role of ["user", "assistant"] as const) {
      const body = bodies[role];
      const clone = body.cloneNode.bind(body);
      Object.defineProperty(body, "cloneNode", { value: (deep?: boolean) => { copies[role]++; return clone(deep); } });
    }
    expect(getAssistantCompletionAfter("user-1")).toBe(true);
    expect(copies).toEqual({ user: 1, assistant: 1 });
    document.querySelector("[data-testid='copy-turn-action-button']")!.remove();
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
    expect(copies).toEqual({ user: 2, assistant: 2 });
    document.querySelector("[data-chatgpt-search-unit-key='two:assistant']")!.insertAdjacentHTML("beforeend", '<button data-testid="copy-turn-action-button">Copy</button>');
    expect(getAssistantCompletionAfter("user-1")).toBe(true);
    dom.happyDOM.setURL("https://chatgpt.com/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("recognizes explicit legacy action testids inside the assistant wrapper", () => {
    document.querySelector("main")!.innerHTML = '<article data-message-author-role="user" data-message-id="legacy-user">Question</article><article data-message-author-role="assistant" data-message-id="legacy-assistant"><p>Answer</p><button data-testid="copy-turn-action-button">Copy</button></article>';
    document.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", id);
    expect(getAssistantCompletionAfter("legacy-user")).toBe(true);
  });

  test("cannot use the next user's response to confirm a prior user", () => {
    document.querySelector("[data-chatgpt-search-unit-key='one:user']")!.insertAdjacentHTML("afterend", '<div data-message-author-role="user" data-message-id="user-2">Another request.</div>');
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
    expect(getAssistantCompletionAfter("user-2")).toBe(true);
  });

  test("finds the live sibling toolbar while rejecting code-block copy alone", () => {
    const main = document.querySelector("main")!;
    main.innerHTML = `<div class="turn"><div class="turn-content">${main.innerHTML}</div><div><button aria-label="Copy">Copy</button><button aria-label="Rate response">Rate</button></div></div>`;
    main.querySelector("[data-testid='copy-turn-action-button']")!.remove();
    expect(getAssistantCompletionAfter("user-1")).toBe(true);
    main.querySelector("[aria-label='Rate response']")!.remove();
    main.querySelector("[data-markdown-text-style='assistant-message']")!.insertAdjacentHTML("beforeend", '<pre><code>example</code><button aria-label="Copy">Copy</button></pre>');
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("an uncommitted animated body counts as busy between stop-button updates", () => {
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<div data-markdown-animated><p>Streaming…</p></div>');
    expect(isChatBusy()).toBe(true);
    document.querySelector("[data-markdown-animated]")!.setAttribute("data-chatgpt-selection-message-id", "finished");
    expect(isChatBusy()).toBe(false);
  });

  function completedTurnWithAnimatedThought(): void {
    document.querySelector("[data-chatgpt-search-unit-key='two:assistant']")!.insertAdjacentHTML("afterbegin", '<div data-markdown-animated><p>Earlier thinking text.</p></div>');
  }

  test.each(["visible", "hidden"] as const)("a %s completed turn's earlier thinking animation does not hold the next send", visibility => {
    Object.defineProperty(document, "visibilityState", { value: visibility, configurable: true });
    completedTurnWithAnimatedThought();
    expect(isChatBusy()).toBe(false);
    expect(getAssistantCompletionAfter("user-1")).toBe(true);
    // Completion proof is fresh, not a timeout or a cached finished state.
    document.querySelector("[data-testid='copy-turn-action-button']")!.remove();
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test.each([
    '<button aria-label="Stop">Stop</button>',
    '<button data-testid="stop-button">Stop</button>',
  ])("completed thinking animation never overrides an active generation control", control => {
    completedTurnWithAnimatedThought();
    document.querySelector("[data-composer-body]")!.insertAdjacentHTML("beforeend", control);
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test.each([
    '<span role="status" aria-busy="true">ChatGPT is responding</span>',
    '<div data-is-streaming="true">New response</div>',
    '<div data-testid="conversation-loading">Loading conversation</div>',
  ])("completed thinking animation never overrides native loading or streaming", activeState => {
    completedTurnWithAnimatedThought();
    document.querySelector("main")!.insertAdjacentHTML("beforeend", activeState);
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("a completed prior answer cannot authorize a newer uncommitted assistant body", () => {
    const turn = document.querySelector("[data-chatgpt-search-unit-key='two:assistant']")!;
    turn.insertAdjacentHTML("afterbegin", '<div data-markdown-text-style="assistant-message" data-markdown-animated><p>New answer is streaming.</p></div>');
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("an animated body after a completed answer still counts as a new response", () => {
    const turn = document.querySelector("[data-chatgpt-search-unit-key='two:assistant']")!;
    turn.insertAdjacentHTML("beforeend", '<div data-markdown-animated><p>New answer is streaming.</p></div>');
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("another turn's completion controls cannot release unrelated thinking animation", () => {
    const main = document.querySelector("main")!;
    main.innerHTML = `<div class="turn">${main.innerHTML}</div><div class="next-turn"><div data-markdown-animated><p>Uncommitted thinking.</p></div></div>`;
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("a newer user without a committed answer keeps the queue busy despite older thinking completion", () => {
    completedTurnWithAnimatedThought();
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<div data-message-author-role="user" data-message-id="user-2">Next request.</div>');
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
    expect(getAssistantCompletionAfter("user-2")).toBe(false);
  });

  test("an older completed thinking animation remains harmless as later completed turns arrive", () => {
    completedTurnWithAnimatedThought();
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<div data-message-author-role="user" data-message-id="user-2">Next request.</div><article data-message-author-role="assistant" data-message-id="assistant-2"><p>Next answer.</p><button data-testid="copy-turn-action-button">Copy</button></article>');
    expect(isChatBusy()).toBe(false);
    expect(getAssistantCompletionAfter("user-2")).toBe(true);
    // It still needs its own toolbar, even when a newer turn is finished.
    document.querySelector("[data-chatgpt-search-unit-key='two:assistant'] [data-testid='copy-turn-action-button']")!.remove();
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-2")).toBe(false);
  });

  test("a completion container spanning a different user cannot release retained animation", () => {
    completedTurnWithAnimatedThought();
    document.querySelector("[data-chatgpt-search-unit-key='two:assistant']")!.insertAdjacentHTML("beforeend", '<div data-message-author-role="user" data-message-id="user-2">Next request.</div>');
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<article data-message-author-role="assistant" data-message-id="assistant-2"><p>Next answer.</p><button data-testid="copy-turn-action-button">Copy</button></article>');
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-2")).toBe(false);
  });

  test("stale route identity cannot release a completed turn's animated thinking", () => {
    completedTurnWithAnimatedThought();
    dom.happyDOM.setURL("https://chatgpt.com/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("a code-block copy button alone cannot complete the animated turn", () => {
    completedTurnWithAnimatedThought();
    document.querySelector("[data-testid='copy-turn-action-button']")!.remove();
    document.querySelector("[data-markdown-text-style='assistant-message']")!.insertAdjacentHTML("beforeend", '<pre><code>example</code><button aria-label="Copy">Copy</button></pre>');
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("keeps the current initial response busy when typing replaces Stop with Send", () => {
    layout('<button type="button" aria-label="Stop">Stop</button>');
    const main = document.querySelector("main")!;
    main.insertAdjacentHTML("beforeend", '<span aria-busy="true" role="status"><span class="sr-only">ChatGPT is responding</span><span aria-hidden="true" class="pulsing-dot"></span></span>');
    expect(isChatBusy()).toBe(true);
    const action = document.querySelector<HTMLButtonElement>("[aria-label='Stop']")!;
    action.setAttribute("type", "submit");
    action.setAttribute("aria-label", "Send");
    findQueueComposer()!.textContent = "A follow-up draft";
    expect(findQueueSendButton()).toBe(action);
    expect(findQueueStopButton()).toBeNull();
    expect(isChatBusy()).toBe(true);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
    main.querySelector("[role='status']")!.remove();
    expect(isChatBusy()).toBe(false);
    expect(getAssistantCompletionAfter("user-1")).toBe(true);
  });

  test("response-status detection ignores hidden, idle and unrelated status controls", () => {
    document.body.insertAdjacentHTML("beforeend", '<span aria-busy="true" role="status">Unrelated background task</span>');
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<span hidden aria-busy="true" role="status">ChatGPT is responding</span><span aria-busy="false" role="status">Response complete</span>');
    document.querySelector("[data-composer-body]")!.insertAdjacentHTML("beforeend", '<span aria-busy="true" role="status">Preparing dictation</span>');
    expect(isChatBusy()).toBe(false);
  });

  test("does not confirm completion while generating or when route DOM is stale", () => {
    document.querySelector("[data-composer-body]")!.insertAdjacentHTML("beforeend", '<button data-testid="stop-button">Stop</button>');
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
    document.querySelector("[data-testid='stop-button']")!.remove();
    dom.happyDOM.setURL("https://chatgpt.com/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(isCurrentConversationReady()).toBe(false);
    expect(getAssistantCompletionAfter("user-1")).toBe(false);
  });

  test("blocks loading state and new/unknown conversation routes", () => {
    document.querySelector("main")!.setAttribute("aria-busy", "true");
    expect(isChatBusy()).toBe(true);
    expect(isCurrentConversationReady()).toBe(false);
    document.querySelector("main")!.removeAttribute("aria-busy");
    dom.happyDOM.setURL("https://chatgpt.com/");
    expect(isCurrentConversationReady()).toBe(false);
  });

  test("requires positive visible conversation identity before dispatching on ChatGPT", () => {
    for (const marker of Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) marker.removeAttribute("data-chatgpt-selection-conversation-id");
    expect(isCurrentConversationReady()).toBe(false);
    document.body.insertAdjacentHTML("beforeend", `<div hidden data-chatgpt-selection-conversation-id="${id}">Hidden stale marker</div>`);
    expect(isCurrentConversationReady()).toBe(false);
    document.querySelector("main")!.setAttribute("data-chatgpt-selection-conversation-id", id);
    expect(isCurrentConversationReady()).toBe(true);
  });

  function localConversation(): void {
    document.querySelector("[data-chatgpt-selection-message-id='user-1']")!.setAttribute("data-chatgpt-selection-message-id", "11111111-1111-4111-8111-111111111111");
    for (const marker of Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) {
      marker.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    }
  }

  test.each(['aria-hidden="true"', 'style="visibility:hidden"', 'hidden', 'style="display:none"'])("empty new-chat capture ignores semantically hidden cached turns (%s)", attributes => {
    dom.happyDOM.setURL("https://chatgpt.com/");
    document.querySelector("main")!.innerHTML = `<section ${attributes} data-chatgpt-selection-conversation-id="${id}">
      <div data-message-author-role="user">Cached question without a committed ID</div>
      <div data-markdown-text-style="assistant-message">Cached assistant with nonempty layout rectangles</div>
    </section>`;
    expect(document.querySelector("section")!.getClientRects().length).toBeGreaterThan(0);
    expect(isEmptyNewChat()).toBe(true);
    document.querySelector("section")!.removeAttribute("aria-hidden");
    document.querySelector("section")!.removeAttribute("hidden");
    document.querySelector("section")!.removeAttribute("style");
    expect(isEmptyNewChat()).toBe(false);
  });

  test("empty new-chat capture rejects a visible unidentified user, assistant or busy transcript", () => {
    dom.happyDOM.setURL("https://chatgpt.com/");
    const main = document.querySelector("main")!;
    for (const markup of ['<div data-message-author-role="user">Uncommitted user</div>', '<div data-markdown-text-style="assistant-message">Uncommitted assistant</div>', '<span role="status" aria-busy="true">Responding</span>']) {
      main.innerHTML = markup;
      expect(isEmptyNewChat()).toBe(false);
    }
    main.replaceChildren();
    expect(isEmptyNewChat()).toBe(true);
  });

  test("verified aliases survive a SPA round trip but cannot authorize a stale or changed transcript", () => {
    const otherRoute = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const otherLocal = "local-chatgpt:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const firstUserId = "11111111-1111-4111-8111-111111111111";
    localConversation();
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(true);
    clearConversationAlias(true);
    dom.happyDOM.setURL(`https://chatgpt.com/c/${otherRoute}`);
    expect(getCurrentConversationReadiness()).toBe("identity-unverified");
    expect(registerNewConversationAlias(`chatgpt:${otherRoute}`, "First question.")).toBe(false);
    for (const marker of Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) marker.setAttribute("data-chatgpt-selection-conversation-id", otherLocal);
    document.querySelector(`[data-chatgpt-selection-message-id='${firstUserId}']`)!.setAttribute("data-chatgpt-selection-message-id", "22222222-2222-4222-8222-222222222222");
    expect(registerNewConversationAlias(`chatgpt:${otherRoute}`, "First question.")).toBe(true);
    clearConversationAlias(true);
    dom.happyDOM.setURL(`https://chatgpt.com/c/${id}`);
    expect(isCurrentConversationReady()).toBe(false);
    expect(getAssistantCompletionAfter("22222222-2222-4222-8222-222222222222")).toBe(false);
    layout(); localConversation();
    expect(isCurrentConversationReady()).toBe(true);
    expect(getAssistantCompletionAfter(firstUserId)).toBe(true);
    const main = document.querySelector("main")!;
    main.setAttribute("aria-busy", "true");
    expect(getCurrentConversationReadiness()).toBe("loading");
    expect(getAssistantCompletionAfter(firstUserId)).toBe(false);
    main.removeAttribute("aria-busy");
    const marker = document.querySelector("[data-chatgpt-selection-conversation-id]")!;
    marker.setAttribute("data-chatgpt-selection-conversation-id", id);
    expect(getCurrentConversationReadiness()).toBe("identity-unverified");
    marker.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(isCurrentConversationReady()).toBe(false);
    layout(); localConversation();
    document.querySelector(`[data-chatgpt-selection-message-id='${firstUserId}']`)!.setAttribute("data-chatgpt-selection-message-id", "33333333-3333-4333-8333-333333333333");
    expect(isCurrentConversationReady()).toBe(false);
    layout(); localConversation();
    document.querySelector("main")!.insertAdjacentHTML("afterbegin", '<div data-message-author-role="user" data-message-id="44444444-4444-4444-8444-444444444444">Different first user</div>');
    expect(isCurrentConversationReady()).toBe(false);
    clearConversationAlias(true);
    dom.happyDOM.setURL(`https://chatgpt.com/c/${otherRoute}`);
    layout();
    for (const entry of Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) entry.setAttribute("data-chatgpt-selection-conversation-id", otherLocal);
    document.querySelector("[data-chatgpt-selection-message-id='user-1']")!.setAttribute("data-chatgpt-selection-message-id", "22222222-2222-4222-8222-222222222222");
    expect(isCurrentConversationReady()).toBe(true);
  });

  test("identity-only alias registration never bypasses loading and document memory retains only 16 verified routes", () => {
    localConversation();
    document.querySelector("main")!.setAttribute("aria-busy", "true");
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(true);
    expect(isCurrentConversationReady()).toBe(false);
    expect(getAssistantCompletionAfter("11111111-1111-4111-8111-111111111111")).toBe(false);
    clearConversationAlias(true);
    expect(isCurrentConversationReady()).toBe(false);
    document.querySelector("main")!.removeAttribute("aria-busy");
    expect(isCurrentConversationReady()).toBe(true);
    for (let index = 1; index <= 16; index++) {
      clearConversationAlias(true);
      const suffix = index.toString(16).padStart(12, "0");
      const route = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`;
      dom.happyDOM.setURL(`https://chatgpt.com/c/${route}`);
      for (const marker of Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) marker.setAttribute("data-chatgpt-selection-conversation-id", `local-chatgpt:cccccccc-cccc-4ccc-8ccc-${suffix}`);
      expect(registerNewConversationAlias(`chatgpt:${route}`, "First question.")).toBe(true);
    }
    clearConversationAlias(true);
    dom.happyDOM.setURL(`https://chatgpt.com/c/${id}`);
    layout(); localConversation();
    expect(isCurrentConversationReady()).toBe(false);
  });

  test("verified aliases never carry into a replacement document with matching URL and transcript", async () => {
    localConversation();
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(true);
    expect(isCurrentConversationReady()).toBe(true);
    const previousDom = dom;
    dom = new Window({ url: `https://chatgpt.com/c/${id}` });
    document = dom.document as unknown as Document;
    for (const name of globals) Object.defineProperty(globalThis, name, { value: name === "window" ? dom : name === "document" ? document : dom[name], configurable: true, writable: true });
    Object.defineProperty(dom.HTMLElement.prototype, "getClientRects", { value: () => [new dom.DOMRect(0, 0, 100, 20)], configurable: true });
    layout(); localConversation();
    expect(isCurrentConversationReady()).toBe(false);
    expect(getCurrentConversationReadiness()).toBe("identity-unverified");
    await previousDom.happyDOM.close();
  });

  test("new-chat local IDs require an explicit first-send binding and survive only their matching route", () => {
    localConversation();
    expect(isCurrentConversationReady()).toBe(false);
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(true);
    expect(isCurrentConversationReady()).toBe(true);
    expect(getAssistantCompletionAfter("11111111-1111-4111-8111-111111111111")).toBe(true);
    dom.happyDOM.setURL("https://chatgpt.com/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(isCurrentConversationReady()).toBe(false);
    expect(registerNewConversationAlias("chatgpt:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "First question.")).toBe(false);
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(false);
  });

  test("alias registration rejects mismatched first prompt and mixed or invalid marker identities", () => {
    localConversation();
    expect(registerNewConversationAlias(`chatgpt:${id}`, "Different question.")).toBe(false);
    const marker = document.querySelector("[data-chatgpt-selection-conversation-id]")!;
    marker.setAttribute("data-chatgpt-selection-conversation-id", id);
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(false);
    for (const entry of Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))) entry.setAttribute("data-chatgpt-selection-conversation-id", "local-chatgpt:invalid");
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(false);
  });

  test("alias cannot authorize sending after its anchor disappears or binding clears", () => {
    localConversation();
    expect(registerNewConversationAlias(`chatgpt:${id}`, "First question.")).toBe(true);
    document.querySelector("[data-chatgpt-search-unit-key='one:user']")!.remove();
    expect(isCurrentConversationReady()).toBe(false);
    layout(); localConversation();
    expect(isCurrentConversationReady()).toBe(true);
    clearConversationAlias();
    expect(isCurrentConversationReady()).toBe(false);
  });
});

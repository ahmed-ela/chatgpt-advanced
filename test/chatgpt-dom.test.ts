import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { findQueueComposer, findQueueSendButton, findQueueStopButton, readComposer, writeComposer, isChatBusy, hasComposerAttachments, getVisibleUserMessages, isCurrentConversationReady, getAssistantCompletionAfter, registerNewConversationAlias, clearConversationAlias } from "../src/chatgpt-dom";

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

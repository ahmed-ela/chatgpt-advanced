import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { getQueueKey } from "../src/queue-store";
import { providerMessages } from "../src/provider-dom";
import {
  findQueueComposer, findQueueSendButton, findQueueStopButton, readComposer, writeComposer,
  isChatBusy, hasComposerAttachments, getVisibleUserMessages, getAssistantCompletionAfter,
  isCurrentConversationReady, getAssistantMessageElements, getAssistantMessageId,
} from "../src/chatgpt-dom";

type Provider = "claude" | "gemini";
const chat = "e284b3373d6e5bc6";
const providerUrl = (provider: Provider, id = chat) => provider === "claude" ? `https://claude.ai/chat/${id}` : `https://gemini.google.com/app/${id}`;
const metadata = (id = chat) => `173913;track:generic_click;BardVeMetadataKey:${btoa(JSON.stringify([["r_turn", `c_${id}`, null, "rc_turn"]]))};mutable:true`;
const toolbar = '<button aria-label="Copy">Copy</button><button aria-label="Good response">Good</button><button aria-label="Bad response">Bad</button>';
const globals = ["window", "document", "HTMLElement", "HTMLTextAreaElement", "HTMLButtonElement", "Event", "InputEvent"] as const;
let dom: Window | undefined;
let doc: Document;
let originals: Array<PropertyDescriptor | undefined>;

// Reduced from the captured October 3 live DOM: Claude's indexed transcript
// rows/ProseMirror composer and Gemini's conversation turn/Quill/response footer.
function geminiQueryText(text: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<h5 class="cdk-visually-hidden">You said ${escape(text)}</h5>` +
    text.split("\n").map(line => line === ""
      ? '<p class="query-text-line"><!----><br class="ng-star-inserted"><!----><!----></p>'
      : `<p class="query-text-line"> ${escape(line)} <!----></p>`).join("<!---->");
}
function user(provider: Provider, index: number, text = "Repeat this request"): string {
  return provider === "claude"
    ? `<div data-testid="transcript-row" data-index="${index * 2}" data-perf-row="human"><div data-testid="user-message"><p>${text}</p></div></div>`
    : `<div class="conversation-container" id="turn-${index}"><user-query><div class="query-content" id="user-query-content-${index}"><div class="query-text">${geminiQueryText(text)}</div></div></user-query></div>`;
}
function assistant(provider: Provider, index: number, text = "Completed answer"): string {
  return provider === "claude"
    ? `<div data-testid="transcript-row" data-index="${index * 2 + 1}" data-perf-row="assistant" data-perf-row-streaming="false"><div data-testid="assistant-message" data-is-streaming="false"><div data-perf-reply-text><p>${text}</p></div></div><div data-testid="message-actions">${toolbar}</div></div>`
    : `<model-response><message-content><div class="markdown" aria-busy="false"><p>${text}</p></div></message-content><div class="response-footer complete"></div><message-actions><span jslog="${metadata()}"></span>${toolbar}</message-actions></model-response>`;
}
function appendAnswer(provider: Provider, index: number): void {
  const target = provider === "claude" ? doc.querySelector("main")! : doc.getElementById(`turn-${index}`)!;
  target.insertAdjacentHTML("beforeend", assistant(provider, index));
}
function mount(provider: Provider): void {
  dom = new Window({ url: providerUrl(provider) });
  doc = dom.document as unknown as Document;
  originals = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of globals) Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom : key === "document" ? doc : dom[key], configurable: true, writable: true,
  });
  Object.defineProperty(dom.HTMLElement.prototype, "getClientRects", { value: () => [new dom!.DOMRect(10, 10, 600, 50)], configurable: true });
  doc.body.innerHTML = provider === "claude"
    ? `<nav><a aria-current="page" href="/chat/${chat}">Selected chat</a></nav><main>${user(provider, 0)}</main><div data-cds="ChatComposer"><div data-testid="chat-input" class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div><button id="native" aria-label="Send message">Send</button></div>`
    : `<main>${user(provider, 0)}</main><input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"><p><br></p></div><div class="ql-clipboard" contenteditable="true"></div></rich-textarea><button id="native" aria-label="Send message">Send</button></input-area-v2>`;
  appendAnswer(provider, 0);
}
afterEach(async () => {
  await dom?.happyDOM.close();
  if (originals) globals.forEach((key, index) => {
    if (originals[index]) Object.defineProperty(globalThis, key, originals[index]!);
    else Reflect.deleteProperty(globalThis, key);
  });
  dom = undefined;
});

describe("Claude and Gemini DOM adapters", () => {
  test("conversation IDs with identical text are isolated by site", () => {
    expect(getQueueKey(providerUrl("claude"))).toBe(`claude:${chat}`);
    expect(getQueueKey(providerUrl("gemini"))).toBe(`gemini:${chat}`);
    expect(getQueueKey(`https://chatgpt.com/c/${chat}`)).toBe(`chatgpt:${chat}`);
    expect(getQueueKey("https://claude.ai/new")).toBeNull();
    expect(getQueueKey("https://gemini.google.com/app")).toBeNull();
  });

  for (const provider of ["claude", "gemini"] as const) {
    test(`${provider}: finds the real composer and preserves multiline input`, () => {
      mount(provider);
      const composer = findQueueComposer()!;
      expect(composer).not.toBeNull();
      expect(composer.classList.contains(provider === "claude" ? "ProseMirror" : "ql-editor")).toBe(true);
      let inputs = 0;
      composer.addEventListener("input", () => { inputs++; });
      expect(writeComposer(composer, "First line\nSecond line")).toBe(true);
      expect(readComposer(composer)).toBe("First line\nSecond line");
      expect(inputs).toBeGreaterThan(0);
      expect(findQueueSendButton()).toBe(doc.querySelector<HTMLButtonElement>("#native"));
      expect(isCurrentConversationReady()).toBe(true);
    });

    test(`${provider}: Stop is distinct from Send, and voice Stop is never a generation control`, () => {
      mount(provider);
      const action = doc.querySelector<HTMLButtonElement>("#native")!;
      action.setAttribute("aria-label", "Stop response");
      expect(isChatBusy()).toBe(true);
      expect(findQueueSendButton()).toBeNull();
      expect(findQueueStopButton()).toBe(action);
      action.setAttribute("aria-label", "Stop recording");
      expect(findQueueStopButton()).toBeNull();
      action.setAttribute("aria-label", "Send message");
      doc.body.insertAdjacentHTML("beforeend", '<button aria-label="Pause playback">Pause</button>');
      expect(isChatBusy()).toBe(false);
    });

    test(`${provider}: duplicate user text keeps separate stable IDs across remounts`, () => {
      mount(provider);
      doc.querySelector("main")!.insertAdjacentHTML("beforeend", user(provider, 1));
      appendAnswer(provider, 1);
      const before = getVisibleUserMessages();
      expect(before).toHaveLength(2);
      expect(before[0]?.text).toBe(before[1]?.text);
      expect(before[0]?.id).not.toBe(before[1]?.id);
      const surviving = provider === "claude" ? doc.querySelector("[data-index='2']")! : doc.getElementById("turn-1")!;
      const markup = surviving.outerHTML;
      surviving.outerHTML = markup;
      const first = provider === "claude" ? doc.querySelector("[data-index='0']")! : doc.getElementById("turn-0")!;
      first.remove();
      expect(getVisibleUserMessages()[0]?.id).toBe(before[1]?.id);
      expect(getAssistantMessageElements().map(getAssistantMessageId).every(Boolean)).toBe(true);
    });

    test(`${provider}: only the assistant after the requested user proves completion`, () => {
      mount(provider);
      doc.querySelector("main")!.insertAdjacentHTML("beforeend", user(provider, 1, "A later unanswered request"));
      const [first, later] = getVisibleUserMessages();
      expect(getAssistantCompletionAfter(first!.id)).toBe(true);
      expect(getAssistantCompletionAfter(later!.id)).toBe(false);
      appendAnswer(provider, 1);
      expect(getAssistantCompletionAfter(later!.id)).toBe(true);
      const answer = getAssistantMessageElements().at(-1)!;
      if (provider === "claude") answer.closest("[data-testid='assistant-message']")!.setAttribute("data-is-streaming", "true");
      else answer.setAttribute("aria-busy", "true");
      expect(isChatBusy()).toBe(true);
      expect(getAssistantCompletionAfter(later!.id)).toBe(false);
    });

    test(`${provider}: attachment previews block text queue operations`, () => {
      mount(provider);
      const scope = provider === "claude" ? doc.querySelector("[data-cds='ChatComposer']")! : doc.querySelector("input-area-v2")!;
      scope.insertAdjacentHTML("beforeend", provider === "claude" ? '<div data-testid="attachment-preview">notes.pdf</div>' : '<uploaded-file>notes.pdf</uploaded-file>');
      expect(hasComposerAttachments()).toBe(true);
    });

    test(`${provider}: user-only reads never extract assistant bodies`, () => {
      mount(provider);
      const extracted: string[] = [];
      const messages = providerMessages(() => true, node => {
        extracted.push(node.textContent ?? "");
        return node.textContent ?? "";
      }, "user");
      expect(messages.map(message => message.role)).toEqual(["user"]);
      expect(messages[0]?.text).toBe("Repeat this request");
      expect(extracted.join("\n")).not.toContain("Completed answer");
    });
  }

  test("Claude rejects a changed route with stale rows until the selected transcript changes", () => {
    mount("claude");
    expect(isCurrentConversationReady()).toBe(true);
    dom!.history.pushState({}, "", "/chat/different-chat");
    doc.querySelector("a[aria-current='page']")!.setAttribute("href", "/chat/different-chat");
    expect(isCurrentConversationReady()).toBe(false);
    doc.querySelector("[data-testid='user-message'] p")!.textContent = "New conversation request";
    expect(isCurrentConversationReady()).toBe(true);
    doc.querySelector("a[aria-current='page']")!.removeAttribute("aria-current");
    expect(isCurrentConversationReady()).toBe(false);
  });

  test("Claude keeps stale-route sending blocked when only the old assistant reply changes", () => {
    mount("claude");
    expect(isCurrentConversationReady()).toBe(true);
    dom!.history.pushState({}, "", "/chat/different-chat");
    doc.querySelector("a[aria-current='page']")!.setAttribute("href", "/chat/different-chat");
    expect(isCurrentConversationReady()).toBe(false);
    doc.querySelector("[data-perf-reply-text] p")!.textContent = "The old reply finished a delayed render";
    expect(isCurrentConversationReady()).toBe(false);
    doc.querySelector("[data-testid='user-message'] p")!.textContent = "A user prompt from the new conversation";
    expect(isCurrentConversationReady()).toBe(true);
  });

  test("Claude retains assistant identity and completion after reload removes the perf attribute", () => {
    mount("claude");
    const userId = getVisibleUserMessages()[0]!.id;
    const body = getAssistantMessageElements()[0]!;
    const id = getAssistantMessageId(body);
    body.classList.add("standard-markdown");
    expect(getAssistantMessageElements()).toHaveLength(1);
    expect(getAssistantMessageId(getAssistantMessageElements()[0]!)).toBe(id);
    body.removeAttribute("data-perf-reply-text");
    expect(getAssistantMessageElements()).toHaveLength(1);
    expect(getAssistantMessageId(getAssistantMessageElements()[0]!)).toBe(id);
    expect(getAssistantCompletionAfter(userId)).toBe(true);
    expect(isCurrentConversationReady()).toBe(true);
  });

  test("Gemini requires every decoded response conversation ID to match its route", () => {
    mount("gemini");
    expect(isCurrentConversationReady()).toBe(true);
    dom!.history.pushState({}, "", "/app/new-conversation");
    expect(isCurrentConversationReady()).toBe(false);
    doc.querySelector("model-response [jslog]")!.setAttribute("jslog", metadata("new-conversation"));
    expect(isCurrentConversationReady()).toBe(true);
    doc.querySelector("model-response")!.insertAdjacentHTML("beforeend", `<span jslog="${metadata("stale-conversation")}"></span>`);
    expect(isCurrentConversationReady()).toBe(false);
  });

  test("Gemini missing or malformed identity metadata cannot authorize sending", () => {
    mount("gemini");
    const identity = doc.querySelector("model-response [jslog]")!;
    identity.setAttribute("jslog", "track:click;BardVeMetadataKey:not-base64");
    expect(isCurrentConversationReady()).toBe(false);
    identity.remove();
    expect(isCurrentConversationReady()).toBe(false);
  });

  test("Gemini removes only template padding and retains multiline prompt whitespace", () => {
    mount("gemini");
    const query = doc.querySelector("user-query .query-text")!;
    for (const text of [
      "First line\nSecond line",
      "Code:\n    if (ready) {\n\treturn value;  \n    }\n\nAfter",
      "\n  first line indentation\n\n\nlast line  \n",
      "Text\n \n\t\nDone",
      "Literal <tag> & data",
    ]) {
      query.innerHTML = geminiQueryText(text);
      expect(getVisibleUserMessages()[0]?.text).toBe(text);
    }
    query.innerHTML = geminiQueryText("First line\n  Second line");
    expect(getVisibleUserMessages()[0]?.text).not.toBe("First line\nSecond line");
    query.innerHTML = geminiQueryText("First line\n\nSecond line");
    expect(getVisibleUserMessages()[0]?.text).not.toBe("First line\nSecond line");
  });

  test("Gemini multiline prompt identity remains compatible across extraction changes and remounts", () => {
    mount("gemini");
    const text = "Inspect this code:\n    first();  \n\n\tsecond();";
    const query = doc.querySelector("user-query .query-text")!;
    // Simulate the previous generic extraction to check persisted anchor IDs.
    const paragraph = doc.createElement("p");
    paragraph.textContent = " Inspect this code: \n     first();   \n  \n \tsecond(); ";
    query.replaceChildren(paragraph);
    const previousId = getVisibleUserMessages()[0]!.id;
    query.innerHTML = geminiQueryText(text);
    expect(getVisibleUserMessages()[0]).toEqual({ id: previousId, text });
    expect(getAssistantCompletionAfter(previousId)).toBe(true);
    doc.body.innerHTML = doc.body.innerHTML;
    expect(getVisibleUserMessages()[0]).toEqual({ id: previousId, text });
    expect(getAssistantCompletionAfter(previousId)).toBe(true);
    doc.querySelector("main")!.insertAdjacentHTML("beforeend", user("gemini", 1, text));
    const messages = getVisibleUserMessages();
    expect(messages[1]?.text).toBe(text);
    expect(messages[1]?.id).not.toBe(previousId);
  });

  test("Gemini standalone BR lines preserve each blank line without discarding mixed text", () => {
    mount("gemini");
    const query = doc.querySelector("user-query .query-text")!;
    query.innerHTML = geminiQueryText("ALPHA\n\n\n    OMEGA");
    expect(query.querySelectorAll(".query-text-line > br")).toHaveLength(2);
    expect(getVisibleUserMessages()[0]?.text).toBe("ALPHA\n\n\n    OMEGA");
    query.innerHTML = '<p class="query-text-line"> First<br>Second </p>';
    expect(getVisibleUserMessages()[0]?.text).toBe("First\nSecond");
    query.innerHTML = '<p class="query-text-line"> <br>Keep this text </p>';
    expect(getVisibleUserMessages()[0]?.text).toBe("\nKeep this text");
  });

  test("Gemini recognizes an immediate user prompt before its response turn wrapper exists", () => {
    mount("gemini");
    const staging = doc.createElement("div");
    staging.innerHTML = user("gemini", 1, "A prompt whose answer has not started");
    const query = staging.querySelector("user-query")!;
    doc.querySelector("main")!.append(query);
    expect(query.closest(".conversation-container")).toBeNull();
    const immediate = getVisibleUserMessages().at(-1)!;
    expect(immediate.text).toBe("A prompt whose answer has not started");
    expect(immediate.id).toContain("gemini:user:user-query-content-1:");
    expect(getAssistantCompletionAfter(immediate.id)).toBe(false);
    const turn = doc.createElement("div");
    turn.className = "conversation-container"; turn.id = "response-turn-arrived-later";
    query.replaceWith(turn); turn.append(query);
    turn.insertAdjacentHTML("beforeend", assistant("gemini", 1));
    expect(getVisibleUserMessages().at(-1)?.id).toBe(immediate.id);
    expect(getAssistantCompletionAfter(immediate.id)).toBe(true);
  });

  test("Gemini legacy turn anchors and current prompt anchors match only their own completed reply", () => {
    mount("gemini");
    doc.querySelector("main")!.insertAdjacentHTML("beforeend", user("gemini", 1, "A later reply is still missing"));
    const [completed, unanswered] = getVisibleUserMessages();
    expect(getAssistantCompletionAfter(completed!.id)).toBe(true);
    expect(getAssistantCompletionAfter("gemini:user:turn-0")).toBe(true);
    expect(getAssistantCompletionAfter(unanswered!.id)).toBe(false);
    expect(getAssistantCompletionAfter("gemini:user:turn-1")).toBe(false);
    expect(getAssistantCompletionAfter("gemini:user:unrelated-turn")).toBe(false);
  });

  test("Gemini optimistic undefined IDs follow the last visible index and distinguish repeated prompt text", () => {
    mount("gemini");
    doc.querySelector(".query-content")!.id = "user-query-content-5";
    const optimistic: Element[] = [];
    for (const index of [6, 7]) {
      const staging = doc.createElement("div");
      staging.innerHTML = user("gemini", index);
      const query = staging.querySelector("user-query")!;
      query.querySelector(".query-content")!.id = "user-query-content-undefined";
      doc.querySelector("main")!.append(query);
      optimistic.push(query);
    }
    const before = getVisibleUserMessages();
    expect(before).toHaveLength(3);
    expect(new Set(before.map(message => message.text)).size).toBe(1);
    expect(new Set(before.map(message => message.id)).size).toBe(3);
    expect(before[1]!.id).toContain("user-query-content-6:");
    expect(before[2]!.id).toContain("user-query-content-7:");
    optimistic.forEach((query, index) => { query.querySelector(".query-content")!.id = `user-query-content-${index + 6}`; });
    expect(getVisibleUserMessages().map(message => message.id)).toEqual(before.map(message => message.id));
    doc.getElementById("turn-0")!.remove();
    expect(getVisibleUserMessages().map(message => message.id)).toEqual(before.slice(1).map(message => message.id));
  });

  test("Gemini's sole first optimistic prompt becomes index zero without changing identity", () => {
    mount("gemini");
    const query = doc.querySelector("user-query")!;
    query.querySelector(".query-content")!.id = "user-query-content-undefined";
    doc.querySelector("main")!.replaceChildren(query);
    const initial = getVisibleUserMessages()[0]!.id;
    expect(initial).toContain("user-query-content-0:");
    query.querySelector(".query-content")!.id = "user-query-content-0";
    expect(getVisibleUserMessages()[0]!.id).toBe(initial);
  });

  test("Gemini refuses ambiguous optimistic IDs when no indexed prior prompt exists", () => {
    mount("gemini");
    doc.querySelector("main")!.innerHTML = user("gemini", 0) + user("gemini", 1);
    doc.querySelectorAll(".query-content").forEach(prompt => { prompt.id = "user-query-content-undefined"; });
    expect(getVisibleUserMessages()).toEqual([]);
  });
});

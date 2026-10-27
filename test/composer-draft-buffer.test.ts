import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { runInContext } from "node:vm";
import type { ComposerDraftBuffer } from "../src/composer-draft-buffer";

const build = await Bun.build({ entrypoints: [new URL("../src/composer-draft-buffer.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!build.success) throw new Error(build.logs.join("\n"));
const source = (await build.outputs[0]!.text()).replace(/export\s*\{\s*ComposerDraftBuffer\s*\};?\s*$/, "globalThis.__Buffer = ComposerDraftBuffer;");
let dom: Window, doc: Document;
let BufferClass: typeof ComposerDraftBuffer;
let buffers: ComposerDraftBuffer[];
beforeEach(() => {
  dom = new Window({ url: "https://chatgpt.com/c/draft-test" });
  doc = dom.document as unknown as Document;
  doc.write('<div contenteditable="true" id="native" role="textbox"></div><input id="other">');
  Object.assign(dom, { Array, Boolean, String, Number, Set, Map, WeakMap, Math, Date, Object, JSON, RegExp, Error, Promise });
  Object.defineProperty(dom.HTMLElement.prototype, "getBoundingClientRect", { value: () => new dom.DOMRect(100, 500, 600, 80), configurable: true });
  runInContext(source, dom);
  BufferClass = (dom as unknown as { __Buffer: typeof ComposerDraftBuffer }).__Buffer;
  buffers = [];
});
afterEach(async () => { buffers.forEach(buffer => buffer.destroy()); await dom.happyDOM.close(); });
function native(): HTMLElement { return doc.getElementById("native")!; }
function buffer(options: { onChange?: (text: string, revision: number) => void; onSubmit?: () => void } = {}): ComposerDraftBuffer {
  const value = new BufferClass(native(), { onChange: options.onChange ?? (() => {}), onSubmit: options.onSubmit ?? (() => {}) });
  buffers.push(value); value.start(); return value;
}
function input(value: ComposerDraftBuffer, text: string): void {
  value.editor.value = text;
  value.editor.dispatchEvent(new dom.InputEvent("input", { bubbles: true, composed: true }) as unknown as InputEvent);
}
function key(value: ComposerDraftBuffer, options: Record<string, unknown> = {}): boolean {
  return value.editor.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true, ...options }) as unknown as KeyboardEvent);
}

test("draft typing preserves exact multiline whitespace and never changes native queued payload", () => {
  native().textContent = "  original\n\nlast  "; native().focus();
  const changes: Array<[string, number]> = [];
  const draft = buffer({ onChange: (text, revision) => changes.push([text, revision]) });
  expect(draft.text).toBe("  original\n\nlast  ");
  expect(draft.revision).toBe(1);
  draft.beforeNativeWrite(); native().textContent = "Only this queued message"; native().focus(); draft.refocusAfterNativeWrite();
  input(draft, "  original\n\nlast continued  ");
  expect(native().textContent).toBe("Only this queued message");
  expect(changes).toEqual([["  original\n\nlast continued  ", 2]]);
  expect(doc.activeElement).toBe(draft.host);
  expect(doc.querySelector("textarea")).toBeNull();
});

test("plain paragraph and BR drafts preserve selection across native replacement", () => {
  native().innerHTML = "<p>one</p><p>two<br>three</p>"; native().focus();
  const selection = dom.getSelection()!;
  selection.setBaseAndExtent(native().lastChild!.firstChild as never, 1, native().lastChild!.lastChild as never, 2);
  const draft = buffer();
  expect(draft.text).toBe("one\ntwo\nthree");
  expect([draft.editor.selectionStart, draft.editor.selectionEnd]).toEqual([5, 10]);
  draft.beforeNativeWrite(); native().textContent = "Queued"; native().focus(); draft.refocusAfterNativeWrite();
  draft.beforeNativeWrite(); native().textContent = draft.text; native().focus();
  expect(draft.restoreSelection()).toBe(true);
  expect(selection.anchorOffset).toBe(5); expect(selection.focusOffset).toBe(10);
  expect(doc.activeElement).toBe(native());
});

test("empty ProseMirror placeholder keeps a zero-length draft and caret", () => {
  native().innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>'; native().focus();
  const paragraph = native().firstChild!;
  dom.getSelection()!.setBaseAndExtent(paragraph as never, 1, paragraph as never, 1);
  const draft = buffer();
  expect(BufferClass.supported(native())).toBe(true);
  expect(draft.text).toBe("");
  expect([draft.editor.selectionStart, draft.editor.selectionEnd]).toEqual([0, 0]);
  draft.beforeNativeWrite();
  expect(draft.restoreSelection()).toBe(true);
  expect(dom.getSelection()!.anchorOffset).toBe(0);
  expect(dom.getSelection()!.focusOffset).toBe(0);
});

test("real newlines before ProseMirror trailing decoration keep exact caret offsets", () => {
  native().innerHTML = '<p>one<br>two<br><br class="ProseMirror-trailingBreak"></p>'; native().focus();
  const paragraph = native().firstChild!;
  const selection = dom.getSelection()!;
  selection.setBaseAndExtent(paragraph as never, 5, paragraph.childNodes[2] as never, 1);
  const draft = buffer();
  expect(draft.text).toBe("one\ntwo\n");
  expect([draft.editor.selectionStart, draft.editor.selectionEnd, draft.editor.selectionDirection]).toEqual([5, 8, "backward"]);
  draft.beforeNativeWrite(); native().textContent = draft.text; native().focus();
  expect(draft.restoreSelection()).toBe(true);
  expect(selection.anchorOffset).toBe(8); expect(selection.focusOffset).toBe(5);
});

test("backward selection in a textarea is restored after further typing", () => {
  native().outerHTML = '<textarea id="native">line one\nline two</textarea>';
  const composer = native() as HTMLTextAreaElement;
  composer.focus(); composer.setSelectionRange(3, 13, "backward");
  const draft = buffer();
  expect([draft.editor.selectionStart, draft.editor.selectionEnd, draft.editor.selectionDirection]).toEqual([3, 13, "backward"]);
  input(draft, "line one\nline two plus");
  draft.editor.setSelectionRange(2, 9, "backward");
  draft.beforeNativeWrite(); composer.value = draft.text;
  expect(draft.restoreSelection()).toBe(true);
  expect([composer.selectionStart, composer.selectionEnd, composer.selectionDirection]).toEqual([2, 9, "backward"]);
});

test("background drafts never steal focus, including after an adapter focuses native", () => {
  native().textContent = "Draft";
  const other = doc.getElementById("other")!; other.focus();
  const draft = buffer();
  expect(doc.activeElement).toBe(other);
  draft.beforeNativeWrite(); native().textContent = "Queued"; native().focus(); draft.refocusAfterNativeWrite();
  expect(doc.activeElement).toBe(other);
  draft.beforeNativeWrite(); native().textContent = draft.text; native().focus();
  expect(draft.restoreSelection()).toBe(true);
  expect(doc.activeElement).toBe(other);
});

test("moving focus away while sending is respected when restoring", () => {
  native().textContent = "Draft"; native().focus();
  const draft = buffer();
  const other = doc.getElementById("other")!; other.focus();
  draft.beforeNativeWrite(); native().textContent = draft.text; native().focus(); draft.restoreSelection();
  expect(doc.activeElement).toBe(other);
});

test("ending owned write before native commit blocks user edits without refocusing early", () => {
  native().textContent = "User draft"; native().focus();
  const draft = buffer();
  draft.beforeNativeWrite(); native().textContent = "Queued payload"; native().focus(); draft.endNativeWrite();
  expect(doc.activeElement).toBe(native());
  const event = new dom.InputEvent("beforeinput", { inputType: "insertText", data: "!", cancelable: true, bubbles: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  expect(native().dispatchEvent(event as unknown as Event)).toBe(false);
  expect(native().textContent).toBe("Queued payload");
  expect(draft.text).toBe("User draft!");
  draft.refocusAfterNativeWrite();
  expect(doc.activeElement).toBe(draft.host);
});

test("focus selected during native commit is not replaced with the prior draft focus", () => {
  native().textContent = "Draft"; native().focus();
  const draft = buffer();
  draft.beforeNativeWrite(); native().textContent = "Queued payload"; native().focus(); draft.endNativeWrite();
  const other = doc.getElementById("other")!; other.focus();
  draft.refocusAfterNativeWrite();
  expect(doc.activeElement).toBe(other);
});

test("restoration does not steal focus chosen during its native commit", () => {
  native().textContent = "Draft"; native().focus();
  const draft = buffer();
  draft.beforeNativeWrite(); native().textContent = draft.text; native().focus(); draft.endNativeWrite();
  const other = doc.getElementById("other")!; other.focus();
  expect(draft.restoreSelection()).toBe(true);
  expect(doc.activeElement).toBe(other);
});

test("Enter requests submit once, while Shift+Enter and composition stay editable", () => {
  let submits = 0;
  const draft = buffer({ onSubmit: () => { submits++; } });
  expect(key(draft)).toBe(false); expect(submits).toBe(1);
  expect(key(draft, { repeat: true })).toBe(false); expect(submits).toBe(1);
  expect(key(draft, { shiftKey: true })).toBe(true); expect(submits).toBe(1);
  expect(key(draft, { isComposing: true })).toBe(true);
  draft.editor.dispatchEvent(new dom.CompositionEvent("compositionstart") as unknown as Event);
  expect(draft.composing).toBe(true); expect(key(draft)).toBe(true);
  expect(draft.restoreSelection()).toBe(false);
  draft.editor.dispatchEvent(new dom.CompositionEvent("compositionend") as unknown as Event);
  expect(draft.composing).toBe(false); expect(key(draft)).toBe(false); expect(submits).toBe(2);
});

test.each(["<strong>bold</strong>", '<span data-mention-id="x">mention</span>', '<div contenteditable="false">chip</div>', '<img src="attachment.png">', '<a href="https://example.com">link</a>', '<p style="font-weight:bold">bold</p>'])("rich or structured draft stays protected: %s", html => {
  native().innerHTML = html;
  expect(BufferClass.supported(native())).toBe(false);
});

test("only editable connected text composers are supported", () => {
  native().innerHTML = "<p>hello<br>world</p><div>more</div>";
  expect(BufferClass.supported(native())).toBe(true);
  native().setAttribute("aria-disabled", "true"); expect(BufferClass.supported(native())).toBe(false);
  native().removeAttribute("aria-disabled"); native().remove();
  expect(BufferClass.supported(doc.createElement("textarea"))).toBe(false);
});

test("restoration rejects unexpected native contents and disconnected composers", () => {
  native().textContent = "Draft";
  const draft = buffer();
  native().textContent = "Someone else changed native";
  expect(draft.restoreSelection()).toBe(false);
  expect(native().textContent).toBe("Someone else changed native");
  native().textContent = draft.text; native().remove();
  expect(draft.restoreSelection()).toBe(false);
});

test("destroy removes overlay and event handlers without modifying the native editor", () => {
  native().textContent = "Draft";
  let changes = 0;
  const draft = buffer({ onChange: () => { changes++; } });
  draft.destroy(); input(draft, "After destroy");
  expect(changes).toBe(0); expect(draft.host.isConnected).toBe(false); expect(native().textContent).toBe("Draft");
});

test("enqueue acknowledgement clears only its exact draft revision", () => {
  native().textContent = "First draft";
  const changes: Array<[string, number]> = [];
  const draft = buffer({ onChange: (text, revision) => changes.push([text, revision]) });
  input(draft, "First draft continued");
  expect(draft.clearIfUnchanged("First draft", 1)).toBe(false);
  expect(draft.clearIfUnchanged("First draft continued", 1)).toBe(false);
  expect(draft.text).toBe("First draft continued");
  expect(draft.clearIfUnchanged("First draft continued", 2)).toBe(true);
  expect(draft.text).toBe("");
  expect(changes).toEqual([["First draft continued", 2], ["", 3]]);
  expect([draft.editor.selectionStart, draft.editor.selectionEnd]).toEqual([0, 0]);
  expect(native().textContent).toBe("First draft");
});

test("an accessibility edit in the borrowed native composer is redirected to draft", () => {
  native().textContent = "Draft"; native().focus();
  const draft = buffer();
  draft.beforeNativeWrite(); native().textContent = "Queued payload"; native().focus(); draft.refocusAfterNativeWrite();
  draft.editor.setSelectionRange(5, 5);
  const event = new dom.InputEvent("beforeinput", { inputType: "insertText", data: "!", cancelable: true, bubbles: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  expect(native().dispatchEvent(event as unknown as Event)).toBe(false);
  expect(draft.text).toBe("Draft!"); expect(native().textContent).toBe("Queued payload");
  expect(doc.activeElement).toBe(draft.host);
});

test("owned native editing remains allowed inside the paired write boundary", () => {
  const draft = buffer(); draft.beforeNativeWrite();
  const event = new dom.InputEvent("beforeinput", { inputType: "insertText", data: "Queue", cancelable: true, bubbles: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  expect(native().dispatchEvent(event as unknown as Event)).toBe(true);
  draft.refocusAfterNativeWrite();
  const next = new dom.InputEvent("beforeinput", { inputType: "insertText", data: "User", cancelable: true, bubbles: true });
  Object.defineProperty(next, "isTrusted", { value: true });
  expect(native().dispatchEvent(next as unknown as Event)).toBe(false);
  expect(draft.text).toBe("User");
});

test("recovery remains editable and visible after the original composer disappears", () => {
  native().textContent = "Keep this draft";
  let submits = 0;
  const changes: string[] = [];
  const draft = buffer({ onChange: text => changes.push(text), onSubmit: () => { submits++; } });
  const composer = native(); composer.remove();
  draft.showRecovery("Return to the original conversation to save this draft.");
  draft.position();
  expect(draft.host.style.display).toBe("block");
  expect(draft.host.shadowRoot!.textContent).toContain("Return to the original conversation");
  input(draft, "Keep this draft, with more text");
  expect(changes).toEqual(["Keep this draft, with more text"]);
  expect(key(draft)).toBe(true); expect(submits).toBe(0);
  draft.host.shadowRoot!.querySelector("button")!.click();
  expect([draft.editor.selectionStart, draft.editor.selectionEnd]).toEqual([0, draft.text.length]);
});

test("recovery never intercepts native input after navigation", () => {
  const draft = buffer();
  draft.showRecovery("Return to your previous conversation.");
  const event = new dom.InputEvent("beforeinput", { inputType: "insertText", data: "New conversation", cancelable: true, bubbles: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  expect(native().dispatchEvent(event as unknown as Event)).toBe(true);
  expect(draft.text).toBe("");
});

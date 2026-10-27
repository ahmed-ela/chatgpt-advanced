import { readComposer, type QueueComposer } from "./chatgpt-dom";

interface DraftBufferOptions {
  onChange(text: string, revision: number): void;
  onSubmit(): void;
  onRetry?(): void;
}

type Caret = { start: number; end: number; direction: "forward" | "backward" | "none" };
type Point = { node: Node; offset: number };

function focusedElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Map the same plain paragraph/BR representation used by readComposer to DOM positions. */
function textPositions(root: Node): { text: string; offsets: Map<Node, number[]>; points: Point[] } {
  const offsets = new Map<Node, number[]>();
  const points: Point[] = [];
  let text = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      offsets.set(node, Array.from({ length: value.length + 1 }, (_, index) => text.length + index));
      for (let index = 0; index <= value.length; index++) points[text.length + index] = { node, offset: index };
      text += value.replace(/\u00a0/g, " ");
      return;
    }
    const start = text.length;
    const boundaries: number[] = [];
    const children = Array.from(node.childNodes);
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      const element = child instanceof HTMLElement ? child : null;
      const block = Boolean(element && /^(?:P|DIV)$/.test(element.tagName));
      if (block && text.length > start && !text.endsWith("\n")) text += "\n";
      boundaries[index] = text.length;
      points[text.length] ??= { node, offset: index };
      if (element?.tagName === "BR") {
        // ProseMirror's caret placeholder is editor decoration, not a user
        // newline. Keep its DOM positions at the surrounding text offset.
        offsets.set(element, [text.length]);
        if (!element.classList.contains("ProseMirror-trailingBreak")) {
          text += "\n";
          points[text.length] = { node, offset: index + 1 };
        }
      } else walk(child);
      if (block && index + 1 < children.length && !text.endsWith("\n")) text += "\n";
      boundaries[index + 1] = text.length;
      points[text.length] ??= { node, offset: index + 1 };
    }
    if (!children.length) { boundaries[0] = text.length; points[text.length] ??= { node, offset: 0 }; }
    offsets.set(node, boundaries);
  };
  walk(root);
  return { text, offsets, points };
}

function captureCaret(composer: QueueComposer, length: number): Caret {
  if (composer instanceof HTMLTextAreaElement) return {
    start: composer.selectionStart, end: composer.selectionEnd, direction: composer.selectionDirection,
  };
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || !composer.contains(selection.anchorNode) || !composer.contains(selection.focusNode)) {
    return { start: length, end: length, direction: "none" };
  }
  const { offsets } = textPositions(composer);
  const anchor = offsets.get(selection.anchorNode)?.[selection.anchorOffset];
  const focus = offsets.get(selection.focusNode)?.[selection.focusOffset];
  if (anchor === undefined || focus === undefined) return { start: length, end: length, direction: "none" };
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), direction: anchor > focus ? "backward" : "forward" };
}

/**
 * Keep ongoing typing separate from the native editor during its asynchronous
 * send/replay. The caller owns durable backup, route checks and native writes.
 */
export class ComposerDraftBuffer {
  static supported(composer: QueueComposer): boolean {
    if (!composer.isConnected) return false;
    if (composer instanceof HTMLTextAreaElement) return !composer.disabled && !composer.readOnly;
    if (composer.getAttribute("contenteditable") !== "true" || composer.getAttribute("aria-disabled") === "true") return false;
    // Flattening formatting, mention chips or other editor entities would lose
    // data. Those drafts keep the existing protective hold instead.
    return Array.from(composer.querySelectorAll("*")).every(element =>
      /^(?:P|DIV|BR)$/.test(element.tagName) && element.getAttribute("contenteditable") !== "false" &&
      !element.hasAttribute("style") && !element.hasAttribute("data-mention-id") && !element.hasAttribute("data-file-id"));
  }

  readonly host = document.createElement("div");
  readonly editor = document.createElement("textarea");
  private readonly shadow = this.host.attachShadow({ mode: "open" });
  private readonly abort = new AbortController();
  private initialCaret: Caret;
  private initialFocus: Element | null;
  private focusBeforeWrite: Element | null = null;
  private bufferFocusedBeforeWrite = false;
  private writeCaptured = false;
  private nativeWrite = false;
  private focusAfterWrite: Element | null = null;
  private recovery = false;
  private recoveryMessage: HTMLElement | null = null;
  private started = false;
  private destroyed = false;
  revision = 1;
  composing = false;

  constructor(readonly composer: QueueComposer, private options: DraftBufferOptions) {
    this.editor.value = readComposer(composer);
    this.initialCaret = captureCaret(composer, this.editor.value.length);
    this.initialFocus = document.activeElement;
    this.host.setAttribute("data-plannotator-queue-root", "draft-buffer");
    this.host.style.cssText = "position:fixed;z-index:2147483646;box-sizing:border-box;";
    this.editor.setAttribute("aria-label", "Your draft (kept while a queued message sends)");
    this.editor.spellcheck = composer.spellcheck;
    const nativeStyle = window.getComputedStyle(composer);
    this.shadow.innerHTML = `<style>:host{color-scheme:light dark}textarea{display:block;box-sizing:border-box;width:100%;height:100%;min-height:32px;resize:none;border:0;border-radius:4px;outline:none;background:light-dark(#fff,#212121);color:light-dark(#222,#eee);padding:0;white-space:pre-wrap;overflow-wrap:anywhere}</style>`;
    for (const property of ["font", "line-height", "letter-spacing", "padding-top", "padding-right", "padding-bottom", "padding-left"] as const) {
      this.editor.style.setProperty(property, nativeStyle.getPropertyValue(property));
    }
    this.shadow.append(this.editor);
  }

  get text(): string { return this.editor.value; }

  /** A durable enqueue may finish after the user continues typing. */
  clearIfUnchanged(text: string, revision: number): boolean {
    if (this.destroyed || this.composing || this.text !== text || this.revision !== revision) return false;
    this.editor.value = "";
    this.editor.setSelectionRange(0, 0);
    this.revision++;
    this.options.onChange(this.text, this.revision);
    return true;
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    document.body.append(this.host);
    this.position();
    const options = { signal: this.abort.signal };
    this.editor.addEventListener("input", () => {
      this.revision++;
      this.options.onChange(this.text, this.revision);
    }, options);
    this.editor.addEventListener("compositionstart", () => { this.composing = true; }, options);
    this.editor.addEventListener("compositionend", () => { this.composing = false; }, options);
    this.editor.addEventListener("keydown", event => {
      if (this.recovery) return;
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || this.composing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) this.options.onSubmit();
    }, options);
    // The overlay catches normal pointer input. An accessibility tool can still
    // focus the native editor: do not let that edit the queued payload.
    this.composer.addEventListener("beforeinput", event => {
      if (this.recovery || !event.isTrusted || this.nativeWrite) return; // writeComposer's owned edit remains allowed.
      event.preventDefault(); event.stopImmediatePropagation();
      this.editor.focus({ preventScroll: true });
      const input = event as InputEvent;
      let start = this.editor.selectionStart, end = this.editor.selectionEnd;
      let insertion: string | null = input.data;
      if (input.inputType === "insertLineBreak" || input.inputType === "insertParagraph") insertion = "\n";
      else if (input.inputType === "deleteContentBackward") { if (start === end) start = Math.max(0, start - 1); insertion = ""; }
      else if (input.inputType === "deleteContentForward") { if (start === end) end = Math.min(this.text.length, end + 1); insertion = ""; }
      if (insertion === null) return;
      this.editor.setRangeText(insertion, start, end, "end");
      this.revision++;
      this.options.onChange(this.text, this.revision);
    }, { capture: true, signal: this.abort.signal });
    window.addEventListener("resize", () => this.position(), options);
    document.addEventListener("scroll", () => this.position(), { capture: true, passive: true, signal: this.abort.signal });
    this.editor.setSelectionRange(this.initialCaret.start, this.initialCaret.end, this.initialCaret.direction);
    if (this.initialFocus === this.composer || Boolean(this.initialFocus && this.composer.contains(this.initialFocus))) {
      this.editor.focus({ preventScroll: true });
    }
  }

  /** Pair around writeComposer, whose native contenteditable path changes focus. */
  beforeNativeWrite(): void {
    this.focusBeforeWrite = focusedElement();
    this.bufferFocusedBeforeWrite = this.shadow.activeElement === this.editor;
    this.writeCaptured = true;
    this.nativeWrite = true;
  }

  /** End the synchronous owned edit before yielding for native model commit. */
  endNativeWrite(): void {
    if (!this.nativeWrite) return;
    this.nativeWrite = false;
    this.focusAfterWrite = focusedElement();
  }

  refocusAfterNativeWrite(): void {
    this.endNativeWrite();
    if (!this.writeCaptured || this.destroyed) return;
    // Native commit can require a task boundary. The user may deliberately
    // focus another input during that wait; never undo that newer intent.
    const active = focusedElement();
    if (active === this.focusAfterWrite) {
      if (this.bufferFocusedBeforeWrite) this.editor.focus({ preventScroll: true });
      else this.restoreOtherFocus();
    }
    this.writeCaptured = false;
  }

  /** Only call after a guarded native write has restored this.text exactly. */
  restoreSelection(): boolean {
    this.endNativeWrite();
    if (!this.composer.isConnected || readComposer(this.composer) !== this.text || this.composing) return false;
    const active = focusedElement();
    const unchangedFocus = !this.writeCaptured || active === this.focusAfterWrite;
    const shouldFocus = active === this.editor || (unchangedFocus && this.writeCaptured && this.bufferFocusedBeforeWrite);
    if (shouldFocus) {
      const start = this.editor.selectionStart, end = this.editor.selectionEnd;
      const backward = this.editor.selectionDirection === "backward";
      this.composer.focus({ preventScroll: true });
      if (this.composer instanceof HTMLTextAreaElement) this.composer.setSelectionRange(start, end, this.editor.selectionDirection);
      else {
        const { points } = textPositions(this.composer);
        const a = points[backward ? end : start], b = points[backward ? start : end];
        const selection = window.getSelection();
        if (a && b && selection) selection.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
      }
    } else if (this.writeCaptured && unchangedFocus) this.restoreOtherFocus();
    this.writeCaptured = false;
    return true;
  }

  private restoreOtherFocus(): void {
    if (this.focusBeforeWrite instanceof HTMLElement && this.focusBeforeWrite.isConnected &&
        this.focusBeforeWrite !== this.host && this.focusBeforeWrite !== this.composer) {
      this.focusBeforeWrite.focus({ preventScroll: true });
    } else if (document.activeElement === this.composer && this.focusBeforeWrite !== this.composer) this.composer.blur();
  }

  /** A route change or storage failure must not discard text still only in memory. */
  showRecovery(message: string): void {
    if (this.destroyed) return;
    this.recovery = true;
    this.nativeWrite = false;
    this.writeCaptured = false;
    this.editor.setAttribute("aria-label", "Your unsent draft — return to the original conversation to save it");
    if (!this.recoveryMessage) {
      const style = document.createElement("style");
      style.textContent = ":host{font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:light-dark(#fff,#232323);color:light-dark(#222,#eee);border:1px solid light-dark(#bbb,#555);border-radius:12px;box-shadow:0 4px 18px #0002;padding:12px}p{margin:0 0 8px}textarea{height:150px;border:1px solid light-dark(#bbb,#555);border-radius:6px;padding:8px}button{font:inherit;color:inherit;background:transparent;border:1px solid light-dark(#bbb,#555);border-radius:6px;padding:5px 8px;margin-top:8px;margin-right:6px;cursor:pointer}";
      this.shadow.prepend(style);
      this.recoveryMessage = document.createElement("p");
      this.recoveryMessage.setAttribute("role", "status");
      this.editor.before(this.recoveryMessage);
      const select = document.createElement("button");
      select.type = "button"; select.textContent = "Select draft";
      select.addEventListener("click", () => { this.editor.focus({ preventScroll: true }); this.editor.select(); }, { signal: this.abort.signal });
      this.shadow.append(select);
      if (this.options.onRetry) {
        const retry = document.createElement("button");
        retry.type = "button"; retry.textContent = "Retry saving draft";
        retry.addEventListener("click", () => this.options.onRetry?.(), { signal: this.abort.signal });
        this.shadow.append(retry);
      }
    }
    this.recoveryMessage.textContent = message;
    this.position();
  }

  position(): void {
    if (this.recovery) {
      this.host.style.left = "50%";
      this.host.style.top = "auto";
      this.host.style.bottom = "16px";
      this.host.style.transform = "translateX(-50%)";
      this.host.style.width = "min(600px, calc(100vw - 24px))";
      this.host.style.height = "auto";
      this.host.style.display = "block";
      return;
    }
    const rect = this.composer.getBoundingClientRect();
    this.host.style.left = `${rect.left}px`;
    this.host.style.top = `${rect.top}px`;
    this.host.style.width = `${rect.width}px`;
    this.host.style.height = `${Math.max(32, rect.height)}px`;
    this.host.style.display = this.composer.isConnected && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight ? "block" : "none";
  }

  destroy(): void {
    this.destroyed = true;
    this.abort.abort();
    this.host.remove();
  }
}

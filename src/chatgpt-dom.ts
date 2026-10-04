import { getQueueKey } from "./queue-store";
import { currentProvider, providerComposerSelectors, providerScopeSelector, providerAssistantElements,
  providerMessageId, providerMessages, providerLoading, providerConversationReady, providerCompletion } from "./provider-dom";

export type QueueComposer = HTMLElement | HTMLTextAreaElement;

const COMPOSER_SELECTORS = [
  "[data-composer-input] [data-composer-markdown][contenteditable='true']",
  "[data-composer-markdown][contenteditable='true'][role='textbox']",
  "#prompt-textarea",
  "[data-testid='prompt-textarea']",
  "form[data-type='unified-composer'] textarea",
  "form.group\\/composer textarea",
  "form[data-type='unified-composer'] [contenteditable='true']",
  "form.group\\/composer [contenteditable='true']",
];
const USER_SELECTOR = "[data-message-author-role='user'], [data-markdown-text-style='user-message'], [data-chatgpt-search-unit-key$=':user']";
const ASSISTANT_SELECTOR = "[data-message-author-role='assistant'], [data-markdown-text-style='assistant-message']";
const MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;
const STOP_LABEL = /^(?:stop|pause)(?:$|[\s…])/i;
const SEND_LABEL = /^(?:send|send message|send prompt)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let conversationAlias: { routeKey: string; localId: string; firstUserId: string } | null = null;

// Do not use viewport position: a message can be above the fold, and background
// tabs still need to reconcile submitted messages after a browser restart.
function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return element.getClientRects().length > 0;
}

export function findQueueComposer(): QueueComposer | null {
  const provider = currentProvider();
  for (const selector of provider === "chatgpt" ? COMPOSER_SELECTORS : providerComposerSelectors[provider]) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisible(element) || element.closest("[data-plannotator-queue-root], #plannotator-chatgpt-root")) continue;
      if (element instanceof HTMLTextAreaElement) {
        if (!element.disabled && !element.readOnly) return element;
      } else if (element.getAttribute("contenteditable") === "true" && element.getAttribute("aria-disabled") !== "true") {
        return element;
      }
    }
  }
  return null;
}

export function composerScope(composer = findQueueComposer()): HTMLElement | null {
  if (!composer) return null;
  const known = composer.closest<HTMLElement>(
    `[data-composer-body], form, [data-composer-surface], section[aria-label*='composer' i], ${providerScopeSelector}`,
  );
  if (known) return known;
  // Older layouts do not identify a composer wrapper. Bound the fallback and
  // never let unrelated conversation/voice controls elsewhere on the page match.
  let parent = composer.parentElement;
  for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
    if (parent === document.body || parent.matches("main, [role='main']")) break;
    if (Array.from(parent.querySelectorAll("button")).some((button) => isSendControl(button) || isStopControl(button))) return parent;
  }
  return composer.parentElement;
}

function isStopControl(button: Element): boolean {
  return button.getAttribute("data-testid") === "stop-button" ||
    STOP_LABEL.test((button.getAttribute("aria-label") || button.getAttribute("title") || "").trim());
}

function isSendControl(button: Element): boolean {
  if (isStopControl(button)) return false;
  const label = (button.getAttribute("aria-label") || button.getAttribute("title") || "").trim();
  // The submit ID is reused for Stop. An unexpected accessible label wins over
  // a stale send ID too, so a future Cancel/Pause variation cannot be clicked.
  if (label && !SEND_LABEL.test(label)) return false;
  return button.getAttribute("data-testid") === "send-button" ||
    button.id === "composer-submit-button" ||
    SEND_LABEL.test(label);
}

export function findQueueSendButton(): HTMLButtonElement | null {
  const scope = composerScope();
  if (!scope) return null;
  for (const button of Array.from(scope.querySelectorAll("button"))) {
    if (isVisible(button) && isSendControl(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true") return button;
  }
  return null;
}

/** Locate only; callers may click this solely for an explicit Send now action. */
export function findQueueStopButton(): HTMLButtonElement | null {
  const enabledGenerationStop = (button: HTMLButtonElement): boolean => {
    if (!isVisible(button) || button.disabled || button.getAttribute("aria-disabled") === "true" || !isStopControl(button)) return false;
    const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
    // A composer can also contain voice controls. Their Stop/Pause must not
    // be treated as interruption of an assistant response.
    return !/\b(?:audio|playback|recording|dictation|voice|music|read[ -]?aloud)\b/i.test(label) &&
      !button.closest("[data-testid*='audio'], [data-testid*='voice'], [aria-label*='read aloud' i]");
  };
  const scope = composerScope();
  const local = scope && Array.from(scope.querySelectorAll("button")).find(enabledGenerationStop);
  if (local) return local;
  // The stable ChatGPT stop testid is the only allowed global fallback.
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-testid='stop-button']"))
    .find(enabledGenerationStop) ?? null;
}

export function readComposer(element: QueueComposer): string {
  if (element instanceof HTMLTextAreaElement) return element.value;
  return plainText(element).replace(/\u00a0/g, " ");
}

// innerText on detached clones loses paragraph boundaries, while textContent
// loses <br>s. A small text walker keeps multiline queued text intact in both.
function plainText(element: Node): string {
  let text = "";
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) { text += child.textContent ?? ""; continue; }
    if (!(child instanceof HTMLElement)) continue;
    if (child.tagName === "BR") { text += "\n"; continue; }
    const block = /^(?:P|DIV|LI|PRE|BLOCKQUOTE|H[1-6])$/.test(child.tagName);
    if (block && text && !text.endsWith("\n")) text += "\n";
    text += plainText(child);
    if (block && child.nextSibling && !text.endsWith("\n")) text += "\n";
  }
  return text;
}

/** Update through the browser's editing path so React/Lexical receive input. Never sends. */
export function writeComposer(element: QueueComposer, text: string): boolean {
  if (!element.isConnected) return false;
  if (element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    if (element.getAttribute("contenteditable") !== "true" || element.getAttribute("aria-disabled") === "true") return false;
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const inputType = text ? "insertText" : "deleteContentBackward";
    const data = text || null;
    const previousMarkup = element.innerHTML;
    // Managed editors use beforeinput to reconcile the selected DOM range with
    // their own state, including when their tab is unfocused. Give them the edit
    // before a direct DOM fallback can replace the nodes they manage.
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true, composed: true, cancelable: true, data, inputType,
    });
    element.dispatchEvent(beforeInput);
    const matches = normalizeText(readComposer(element)) === normalizeText(text);
    // Cancellation can mean either a handled edit or rejection. Never insert a
    // second time or overwrite a rejected edit. Also honor synchronous editors
    // that commit the requested content without cancelling the event.
    if (beforeInput.defaultPrevented || (element.innerHTML !== previousMarkup && matches)) return element.isConnected && matches;
    if (!element.isConnected || element.getAttribute("contenteditable") !== "true" || element.getAttribute("aria-disabled") === "true") return false;
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, text); } catch { /* Fallback for editors without execCommand. */ }
    if (!inserted) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true, composed: true, data, inputType,
      }));
    }
  }
  return normalizeText(readComposer(element)) === normalizeText(text);
}

function hasLoadingState(): boolean {
  if (currentProvider() !== "chatgpt") return providerLoading(isVisible);
  // Current ChatGPT replaces Stop with Send as soon as a draft is entered,
  // including before its first animated thinking/answer body appears. The
  // transcript's busy status remains present during that initial response.
  if (Array.from(document.querySelectorAll("main [role='status'][aria-busy='true'], [role='main'] [role='status'][aria-busy='true']"))
    .some((status) => isVisible(status) && !status.closest("[data-composer-body], form, [data-composer-surface]"))) return true;
  return Array.from(document.querySelectorAll(
    "main[aria-busy='true'], [role='main'][aria-busy='true'], [data-testid='conversation-loading'], [data-testid='conversation-loading-spinner'], [data-is-streaming='true'], [data-message-author-role='assistant'][aria-busy='true'], [data-markdown-text-style='assistant-message'][aria-busy='true']",
  )).some(isVisible);
}

export function isChatBusy(): boolean {
  const scope = composerScope();
  if (scope && Array.from(scope.querySelectorAll("button")).some((button) => isVisible(button) && isStopControl(button))) return true;
  // The stable stop testid is safe outside a known wrapper; a generic Pause
  // label elsewhere can belong to read-aloud playback and must not queue sends.
  if (Array.from(document.querySelectorAll("button[data-testid='stop-button']")).some(isVisible)) return true;
  // Live streaming bodies do not receive their final message ID until the
  // generation is committed. Animation alone is not enough: it may persist.
  if (Array.from(document.querySelectorAll<HTMLElement>("[data-markdown-animated]")).some((body) =>
    isVisible(body) && !body.closest("[data-chatgpt-selection-message-id], [data-message-id]"),
  )) return true;
  return hasLoadingState();
}

export function hasComposerAttachments(): boolean {
  const scope = composerScope();
  if (!scope) return false;
  if (Array.from(scope.querySelectorAll<HTMLInputElement>("input[type='file']")).some((input) => (input.files?.length ?? 0) > 0)) return true;
  const previews = scope.querySelectorAll(
    "[data-file-id], [data-attachment-id], [data-testid='attachment'], [data-testid*='file-preview'], [data-testid*='attachment-preview'], [data-testid*='image-preview'], [data-test-id*='file-preview'], [data-test-id*='attachment-preview'], uploaded-file, file-preview, img[src^='blob:'], img[src^='data:']",
  );
  if (Array.from(previews).some(isVisible)) return true;
  return Array.from(scope.querySelectorAll("button")).some((button) => {
    const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
    return isVisible(button) && /\b(?:remove|delete)\b.*\b(?:attachment|file|image|upload)\b/i.test(label);
  });
}

interface MessageRecord { id: string; text: string; role: "user" | "assistant"; element: HTMLElement; }

function messageId(element: HTMLElement): string | null {
  const wrapper = element.closest("[data-chatgpt-selection-message-id], [data-message-id]") ||
    element.querySelector("[data-chatgpt-selection-message-id], [data-message-id]");
  const stableId = wrapper?.getAttribute("data-chatgpt-selection-message-id") || wrapper?.getAttribute("data-message-id");
  if (stableId) return stableId;
  const unit = element.closest("[data-chatgpt-search-message-ids]");
  // Current user bubbles have IDs on the search unit, not selection wrappers.
  // The attribute can carry a comma/space/JSON list; take its first UUID.
  return unit?.getAttribute("data-chatgpt-search-message-ids")?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function visibleMessages(roleFilter?: MessageRecord["role"]): MessageRecord[] {
  if (currentProvider() !== "chatgpt") return providerMessages(isVisible, plainText, roleFilter);
  const records: MessageRecord[] = [];
  const seen = new Set<string>();
  const selector = roleFilter === "user" ? USER_SELECTOR : roleFilter === "assistant" ? ASSISTANT_SELECTOR : MESSAGE_SELECTOR;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (!isVisible(element)) continue;
    const id = messageId(element);
    if (!id || seen.has(id)) continue;
    const role = element.matches(USER_SELECTOR) ? "user" : "assistant";
    // Search-unit wrappers carry the user role in current ChatGPT. Limit the
    // text to their message wrapper so sibling action button text is excluded.
    const body = element.querySelector<HTMLElement>(
      role === "user"
        ? "[data-user-message-bubble='true'], [data-markdown-text-style='user-message'], [data-chatgpt-selection-message-id], [data-message-author-role='user']"
        : "[data-markdown-text-style='assistant-message']",
    ) ?? element;
    const copy = body.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("button, [role='button'], script, style").forEach((node) => node.remove());
    const text = normalizeText(plainText(copy));
    if (!text) continue;
    seen.add(id);
    records.push({ id, text, role, element });
  }
  return records;
}

export function getVisibleUserMessages(): Array<{ id: string; text: string }> {
  return visibleMessages("user").map(({ id, text }) => ({ id, text }));
}

function visibleConversationIds(): string[] {
  return Array.from(document.querySelectorAll("[data-chatgpt-selection-conversation-id]"))
    .filter(isVisible).map((marker) => marker.getAttribute("data-chatgpt-selection-conversation-id")!);
}

/** Only the UI's observed first-send/new-chat transition may call this. */
export function registerNewConversationAlias(routeKey: string, firstMessageText: string): boolean {
  if (!routeKey.startsWith("chatgpt:") || getQueueKey(window.location.href) !== routeKey) return false;
  // Never let the same document's local ID silently migrate to another route.
  // The UI clears the binding whenever the observed route changes.
  if (conversationAlias && conversationAlias.routeKey !== routeKey) return false;
  const firstUser = getVisibleUserMessages()[0];
  const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
  if (!firstUser || !UUID_PATTERN.test(firstUser.id) || !firstMessageText.trim() ||
      collapse(firstUser.text) !== collapse(firstMessageText)) return false;
  const markerIds = visibleConversationIds();
  const localId = markerIds[0];
  if (!localId?.startsWith("local-chatgpt:") || !UUID_PATTERN.test(localId.slice("local-chatgpt:".length)) ||
      markerIds.some((id) => id !== localId)) return false;
  if (conversationAlias && (conversationAlias.localId !== localId || conversationAlias.firstUserId !== firstUser.id)) return false;
  conversationAlias = { routeKey, localId, firstUserId: firstUser.id };
  return true;
}

export function clearConversationAlias(): void { conversationAlias = null; }

// Return records for this synchronous validation only. Callers must read again
// after an await or DOM change; route and completion evidence is never cached.
function currentConversationMessages(): MessageRecord[] | null {
  const key = getQueueKey(window.location.href);
  if (!key || !findQueueComposer() || (currentProvider() === "chatgpt" && hasLoadingState())) return null;
  const messages = visibleMessages();
  if (!messages.length) return null;
  if (currentProvider() !== "chatgpt") return providerConversationReady(key, messages) ? messages : null;
  if (key.startsWith("chatgpt:")) {
    const id = key.slice("chatgpt:".length);
    const markerIds = visibleConversationIds();
    if (!markerIds.length) return null;
    if (markerIds.some((markerId) => markerId !== id)) {
      if (!conversationAlias || conversationAlias.routeKey !== key ||
          markerIds.some((markerId) => markerId !== conversationAlias!.localId) ||
          !messages.some((message) => message.role === "user" && message.id === conversationAlias!.firstUserId)) return null;
    }
  }
  return messages;
}

export function isCurrentConversationReady(): boolean {
  return currentConversationMessages() !== null;
}

/**
 * Gemini renumbers prompt indices on reload. Promote only a prompt we can
 * still identify exactly in this route's DOM, never by repeated text alone.
 * Keep getVisibleUserMessages IDs unchanged: switching them to turn IDs would
 * make a pre-existing optimistic prompt appear newly sent to the ACK detector.
 */
export function getStableUserMessageAnchor(userId: string): string | null {
  if (currentProvider() !== "gemini" || !/^gemini:user:user-query-content-\d+:[a-z0-9]+$/.test(userId)) return null;
  const messages = currentConversationMessages();
  if (!messages) return null;
  const user = messages.find(message => message.role === "user" && message.id === userId);
  const turn = user?.element.closest<HTMLElement>(".conversation-container[id]");
  return turn && /^[0-9a-f]{16}$/i.test(turn.id) ? `gemini:user:${turn.id}` : null;
}

/** Absence of a stop button alone is not proof of an assistant's completion. */
export function getAssistantCompletionAfter(userId: string): boolean {
  if (isChatBusy()) return false;
  const messages = currentConversationMessages();
  if (!messages) return false;
  const userIndex = messages.findIndex((message) => message.role === "user" && (message.id === userId ||
    // Preserve queue anchors written before Gemini's immediate prompt IDs were used.
    (currentProvider() === "gemini" && userId === `gemini:user:${message.element.closest('.conversation-container[id]')?.id}`)));
  if (userIndex < 0) return false;
  let assistant: MessageRecord | undefined;
  for (const message of messages.slice(userIndex + 1)) {
    if (message.role === "user") break;
    assistant = message;
  }
  if (!assistant) return false;
  if (currentProvider() !== "chatgpt") return providerCompletion(assistant, isVisible);
  // In the current layout the toolbar is a sibling several wrappers above the
  // body, alongside this same turn's user bubble. Stop before another turn.
  let container: HTMLElement | null = assistant.element;
  for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
    if (container === document.body || container.matches("main, [role='main']")) break;
    const containedMessages = messages.filter((message) => container!.contains(message.element));
    if (containedMessages.some((message) => message.role === "user" ? message.id !== userId : message.id !== assistant!.id)) break;
    const controls = Array.from(container.querySelectorAll("button")).filter(isVisible);
    if (controls.some((button) => /^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(button.getAttribute("data-testid") ?? ""))) return true;
    // A code-block Copy button is never completion proof. Require the current
    // response toolbar's separate rating and copy actions outside the body.
    const labels = controls.filter((button) => !button.closest(ASSISTANT_SELECTOR))
      .map((button) => (button.getAttribute("aria-label") ?? "").trim().toLowerCase());
    if (labels.includes("rate response") && (labels.includes("copy") || labels.includes("copy response"))) return true;
  }
  return false;
}

export function getProviderName(): "ChatGPT" | "Claude" | "Gemini" {
  return currentProvider() === "claude" ? "Claude" : currentProvider() === "gemini" ? "Gemini" : "ChatGPT";
}

export function findAssistantMessageElement(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  if (!element) return null;
  if (currentProvider() !== "chatgpt") return providerAssistantElements().find(body => body === element || body.contains(element)) ?? null;
  return element.closest<HTMLElement>("[data-message-author-role='assistant']") ??
    element.closest<HTMLElement>("[data-markdown-text-style='assistant-message']");
}

export function getAssistantMessageElements(): HTMLElement[] {
  if (currentProvider() !== "chatgpt") return providerAssistantElements();
  return [...new Set(Array.from(document.querySelectorAll<HTMLElement>(ASSISTANT_SELECTOR))
    .map(findAssistantMessageElement).filter((element): element is HTMLElement => element !== null))];
}

export function getAssistantMessageId(element: HTMLElement): string | null {
  if (currentProvider() !== "chatgpt") return providerMessageId(element, plainText(element));
  return messageId(element);
}

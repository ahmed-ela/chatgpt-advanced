import { getQueueKey, isValidConversationAlias } from "./queue-store";
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
export interface ConversationAlias { routeKey: string; localId: string; firstUserId: string; }
let conversationAlias: ConversationAlias | null = null;
let aliasDocument: Document | null = null;
const verifiedAliases = new Map<string, ConversationAlias>();
const MAX_VERIFIED_ALIASES = 16;

function ensureAliasDocument(): void {
  if (aliasDocument === document) return;
  aliasDocument = document;
  conversationAlias = null;
  verifiedAliases.clear();
}

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
  if (hasLoadingState()) return true;
  // Live streaming bodies do not receive their final message ID until the
  // generation is committed. A completed turn can retain a separate animated
  // thinking body, so reconcile that body with positive same-turn evidence.
  const uncommitted = Array.from(document.querySelectorAll<HTMLElement>("[data-markdown-animated]")).filter((body) =>
    isVisible(body) && !body.closest("[data-chatgpt-selection-message-id], [data-message-id]"),
  );
  if (!uncommitted.length) return false;
  if (currentProvider() !== "chatgpt") return true;
  const messages = currentConversationMessages();
  const latest = messages?.at(-1);
  if (!messages || latest?.role !== "assistant") return true;
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUser || !chatGptCompletionContainer(latest, latestUser.id, messages)) return true;
  return uncommitted.some((body) => {
    // A new answer body, or animation after the committed reply, can be a new
    // generation. Never let an old toolbar authorize either of those states.
    if (body.closest(ASSISTANT_SELECTOR) || body.querySelector(MESSAGE_SELECTOR)) return true;
    const assistantIndex = messages.findIndex((message) => message.role === "assistant" &&
      !!(body.compareDocumentPosition(message.element) & body.DOCUMENT_POSITION_FOLLOWING));
    const assistant = messages[assistantIndex];
    const user = messages.slice(0, assistantIndex).reverse().find((message) => message.role === "user");
    if (!assistant || !user || !(user.element.compareDocumentPosition(body) & body.DOCUMENT_POSITION_FOLLOWING)) return true;
    return !chatGptCompletionContainer(assistant, user.id, messages, body);
  });
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

function userMessageText(element: HTMLElement): string {
  // Collapse and copy decorations appear in both rich and plain user bubbles.
  // Remove them from the cloned body before selecting either text format;
  // a literal ellipsis in the submitted text remains untouched.
  element.querySelectorAll("[aria-hidden='true'], [data-markdown-copy='exclude'], [hidden]").forEach(node => node.remove());
  const selector = "[data-markdown-text-tone='user-message']";
  const rich = element.matches(selector) ? element : element.querySelector<HTMLElement>(selector);
  if (!rich) return plainText(element);
  // Current rich user bubbles represent blank lines as adjacent paragraphs,
  // and single newlines as <br>s inside each paragraph. Read only their text
  // root: collapse affordances outside it are not part of the submitted text.
  const nodes = Array.from(rich.childNodes);
  const paragraphs = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "P");
  if (paragraphs.length && nodes.every(node =>
    (node instanceof HTMLElement && node.tagName === "P") || (node.nodeType === 3 && !node.textContent?.trim()),
  )) return paragraphs.map(paragraph => plainText(paragraph)).join("\n\n");
  return plainText(rich);
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
    const text = normalizeText(role === "user" ? userMessageText(copy) : plainText(copy));
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

/** Hidden cached turns must not turn a genuinely empty new chat into an old one. */
export function isEmptyNewChat(): boolean {
  return window.location.hostname === "chatgpt.com" && window.location.pathname === "/" &&
    !!findQueueComposer() && !isChatBusy() &&
    !Array.from(document.querySelectorAll(`${MESSAGE_SELECTOR}, [data-chatgpt-selection-conversation-id]`)).some(isVisible);
}

/** Only the UI's observed first-send/new-chat transition may call this. */
export function registerNewConversationAlias(routeKey: string, firstMessageText: string): boolean {
  ensureAliasDocument();
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
  return restoreConversationAlias({ routeKey, localId, firstUserId: firstUser.id });
}

function matchesVisibleConversationAlias(alias: ConversationAlias): boolean {
  if (!isValidConversationAlias(alias) || getQueueKey(window.location.href) !== alias.routeKey || !findQueueComposer()) return false;
  const markerIds = visibleConversationIds();
  const firstUser = getVisibleUserMessages()[0];
  return markerIds.length > 0 && markerIds.every(id => id === alias.localId) &&
    firstUser?.id === alias.firstUserId;
}

/** Return an exact observed witness, including while its first answer is busy. */
export function getVerifiedConversationAlias(): ConversationAlias | null {
  ensureAliasDocument();
  const key = getQueueKey(window.location.href);
  const alias = key && (conversationAlias?.routeKey === key ? conversationAlias : verifiedAliases.get(key));
  return alias && matchesVisibleConversationAlias(alias) ? { ...alias } : null;
}

/** Restore only a durable first-send witness; this does not authorize completion. */
export function restoreConversationAlias(alias: ConversationAlias): boolean {
  ensureAliasDocument();
  if (!matchesVisibleConversationAlias(alias)) return false;
  if (conversationAlias && (conversationAlias.routeKey !== alias.routeKey || conversationAlias.localId !== alias.localId ||
      conversationAlias.firstUserId !== alias.firstUserId)) return false;
  // Neither a stale mounted transcript nor a stored witness may rebind a local
  // identity to another route or first message in this document.
  if (Array.from(verifiedAliases.values()).some(previous =>
    (previous.localId === alias.localId && (previous.routeKey !== alias.routeKey || previous.firstUserId !== alias.firstUserId)) ||
    (previous.firstUserId === alias.firstUserId && previous.routeKey !== alias.routeKey),
  )) return false;
  conversationAlias = { routeKey: alias.routeKey, localId: alias.localId, firstUserId: alias.firstUserId };
  verifiedAliases.delete(alias.routeKey);
  verifiedAliases.set(alias.routeKey, conversationAlias);
  if (verifiedAliases.size > MAX_VERIFIED_ALIASES) verifiedAliases.delete(verifiedAliases.keys().next().value!);
  return true;
}

export function clearConversationAlias(retainVerified = false): void {
  conversationAlias = null;
  if (retainVerified) ensureAliasDocument();
  else { verifiedAliases.clear(); aliasDocument = null; }
}

type ConversationReadiness = "ready" | "loading" | "identity-unverified";
type ConversationState = { status: "ready"; messages: MessageRecord[] } |
  { status: Exclude<ConversationReadiness, "ready">; messages: null };

// Return records for this synchronous validation only. Callers must read again
// after an await or DOM change; route and completion evidence is never cached.
function currentConversationState(): ConversationState {
  ensureAliasDocument();
  const key = getQueueKey(window.location.href);
  if (conversationAlias && conversationAlias.routeKey !== key) conversationAlias = null;
  if (!key || !findQueueComposer() || (currentProvider() === "chatgpt" && hasLoadingState())) return { status: "loading", messages: null };
  const messages = visibleMessages();
  if (!messages.length) return { status: "loading", messages: null };
  if (currentProvider() !== "chatgpt") return providerConversationReady(key, messages)
    ? { status: "ready", messages } : { status: "loading", messages: null };
  if (key.startsWith("chatgpt:")) {
    const id = key.slice("chatgpt:".length);
    const markerIds = visibleConversationIds();
    if (!markerIds.length) return { status: "identity-unverified", messages: null };
    if (markerIds.some((markerId) => markerId !== id)) {
      // Restoration authorizes only the exact tuple this document observed on
      // a real first send. URL and matching text alone never create an alias.
      const alias = conversationAlias ?? verifiedAliases.get(key);
      if (!alias || alias.routeKey !== key || markerIds.some((markerId) => markerId !== alias.localId) ||
          messages.find(message => message.role === "user")?.id !== alias.firstUserId) return { status: "identity-unverified", messages: null };
      conversationAlias = alias;
    }
  }
  return { status: "ready", messages };
}

function currentConversationMessages(): MessageRecord[] | null {
  return currentConversationState().messages;
}

export function getCurrentConversationReadiness(): ConversationReadiness {
  return currentConversationState().status;
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
  return chatGptCompletionContainer(assistant, userId, messages) !== null;
}

function chatGptCompletionContainer(assistant: MessageRecord, userId: string, messages: MessageRecord[], alongside?: HTMLElement): HTMLElement | null {
  // In the current layout the toolbar is a sibling several wrappers above the
  // body, alongside this same turn's user bubble. Stop before another turn.
  let container: HTMLElement | null = assistant.element;
  for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
    if (container === document.body || container.matches("main, [role='main']")) break;
    const containedMessages = messages.filter((message) => container!.contains(message.element));
    if (containedMessages.some((message) => message.role === "user" ? message.id !== userId : message.id !== assistant.id)) break;
    if (alongside && !container.contains(alongside)) continue;
    const controls = Array.from(container.querySelectorAll("button")).filter(isVisible);
    if (controls.some((button) => /^(?:copy-turn-action-button|good-response-turn-action-button|bad-response-turn-action-button)$/.test(button.getAttribute("data-testid") ?? ""))) return container;
    // A code-block Copy button is never completion proof. Require the current
    // response toolbar's separate rating and copy actions outside the body.
    const labels = controls.filter((button) => !button.closest(ASSISTANT_SELECTOR))
      .map((button) => (button.getAttribute("aria-label") ?? "").trim().toLowerCase());
    if (labels.includes("rate response") && (labels.includes("copy") || labels.includes("copy response"))) return container;
  }
  return null;
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

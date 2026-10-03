/** Provider selectors are grounded in the live Claude and Gemini web clients. */
export type Provider = "chatgpt" | "claude" | "gemini";
export interface ProviderMessage { id: string; text: string; role: "user" | "assistant"; element: HTMLElement }
export function currentProvider(): Provider {
  return window.location.hostname === "claude.ai" ? "claude" : window.location.hostname === "gemini.google.com" ? "gemini" : "chatgpt";
}
export const providerComposerSelectors = {
  claude: ["[data-cds='ChatComposer'] [data-testid='chat-input'][contenteditable='true']", "[data-testid='chat-input'][contenteditable='true'][role='textbox']"],
  gemini: ["input-area-v2 rich-textarea .ql-editor[contenteditable='true'][role='textbox']"],
};
export const providerScopeSelector = "[data-cds='ChatComposer'], input-area-v2";
// Reloaded Claude replies omit the performance attribute present on fresh replies.
const claudeBody = "[data-testid='assistant-message'] :is([data-perf-reply-text], .standard-markdown)";
const geminiBody = "model-response message-content .markdown";
type Visible = (element: Element) => boolean;
type Read = (element: Node) => string;

export function providerAssistantElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(currentProvider() === "claude" ? claudeBody : geminiBody));
}

function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(36);
}

export function providerMessageId(element: HTMLElement, text: string): string | null {
  if (currentProvider() === "claude") {
    const row = element.closest("[data-testid='transcript-row']");
    const index = row?.getAttribute("data-index");
    const role = row?.getAttribute("data-perf-row");
    // Claude virtualizes old rows. DOM order and React-generated IDs are not
    // stable; the transcript index survives remounts and repeated text.
    if (!index || !/^\d+$/.test(index) || !["human", "assistant"].includes(role ?? "")) return null;
    return `claude:${role}:${index}:${hash(text.replace(/\s+/g, " ").trim())}`;
  }
  const user = element.closest("user-query");
  if (user) {
    // Gemini only assigns the response turn ID after the server starts its
    // answer, which can exceed the send acknowledgement deadline. Its prompt
    // index exists immediately and survives the turn wrapper's replacement.
    const prompt = user.querySelector<HTMLElement>(".query-content[id^='user-query-content-']");
    if (!prompt) return null;
    let index = prompt.id.match(/^user-query-content-(\d+)$/)?.[1];
    if (!index) {
      // The optimistic prompt is literally "user-query-content-undefined".
      // Its position after the last indexed prompt supplies the final index.
      const prompts = Array.from(document.querySelectorAll<HTMLElement>("user-query .query-content[id]"));
      const position = prompts.indexOf(prompt);
      for (let previous = position - 1; previous >= 0; previous--) {
        const priorIndex = prompts[previous]!.id.match(/^user-query-content-(\d+)$/)?.[1];
        if (priorIndex) { index = String(Number(priorIndex) + position - previous); break; }
      }
      if (!index && position === 0 && prompts.length === 1) index = "0";
    }
    if (index === undefined) return null;
    return `gemini:user:user-query-content-${index}:${hash(text.replace(/\s+/g, " ").trim())}`;
  }
  const turn = element.closest<HTMLElement>(".conversation-container[id]");
  if (!turn?.id) return null;
  return `gemini:assistant:${turn.id}`;
}

function geminiUserText(element: HTMLElement, read: Read): string {
  const lines = Array.from(element.querySelectorAll<HTMLElement>(".query-text-line"));
  if (!lines.length) return read(element).replace(/\u00a0/g, " ").trim();
  // Gemini's template adds one literal space on each side of each prompt
  // line. Remove only that pair, retaining user indentation/trailing spaces.
  // Joining explicit lines also preserves empty paragraphs the generic DOM
  // walker cannot distinguish from paragraph separators.
  return lines.map(line => {
    // Gemini renders an empty logical line as a standalone <br>, without
    // template padding. The join below supplies its line separator.
    if (line.children.length === 1 && line.firstElementChild?.tagName === "BR" && !line.textContent) return "";
    const text = read(line);
    return text.length >= 2 && text.startsWith(" ") && text.endsWith(" ") ? text.slice(1, -1) : text;
  }).join("\n").replace(/\u00a0/g, " ");
}

export function providerMessages(visible: Visible, read: Read, onlyRole?: "user" | "assistant"): ProviderMessage[] {
  const provider = currentProvider();
  const userSelector = provider === "claude" ? "[data-testid='user-message']" : "user-query .query-text";
  const assistantSelector = provider === "claude" ? claudeBody : geminiBody;
  const selector = onlyRole === "user" ? userSelector : onlyRole === "assistant" ? assistantSelector : `${userSelector}, ${assistantSelector}`;
  const messages: ProviderMessage[] = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (!visible(element)) continue;
    const role = element.matches("[data-testid='user-message'], .query-text") ? "user" : "assistant";
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("button, [role='button'], script, style, .cdk-visually-hidden, .sr-only").forEach(node => node.remove());
    const text = provider === "gemini" && role === "user"
      ? geminiUserText(copy, read) : read(copy).replace(/\u00a0/g, " ").trim();
    const id = providerMessageId(element, text);
    if (id && text.trim() && !messages.some(message => message.id === id)) messages.push({ id, text, role, element });
  }
  return messages;
}

export function providerLoading(visible: Visible): boolean {
  const selectors = currentProvider() === "claude"
    ? "[data-testid='transcript-row'][data-perf-row-streaming='true'], [data-testid='assistant-message'][data-is-streaming='true'], [aria-label='Currently streaming message']"
    : "model-response [aria-busy='true']";
  return Array.from(document.querySelectorAll(selectors)).some(visible);
}

const routeStates = new WeakMap<Document, { key: string; signature: string; stale: string | null }>();
export function providerConversationReady(key: string, messages: ProviderMessage[]): boolean {
  if (currentProvider() === "gemini") {
    const id = key.slice("gemini:".length);
    // The response's DOM telemetry includes its actual conversation identity.
    // Require it to agree with the route; a URL change alone isn't enough.
    const ids: string[] = [];
    for (const node of Array.from(document.querySelectorAll("model-response [jslog]"))) {
      const encoded = node.getAttribute("jslog")?.match(/BardVeMetadataKey:([^;]+)/)?.[1];
      if (!encoded) continue;
      try {
        const value: unknown = JSON.parse(atob(encoded));
        const conversation = Array.isArray(value) && Array.isArray(value[0]) ? value[0][1] : null;
        if (typeof conversation === "string" && conversation.startsWith("c_")) ids.push(conversation.slice(2));
      } catch { /* Unknown markup cannot authorize an automatic send. */ }
    }
    return ids.length > 0 && ids.every(value => value === id);
  }
  // Old assistant text can keep streaming during a route transition. Only a
  // changed user transcript can release the stale-conversation guard.
  const signature = messages.filter(message => message.role === "user").map(message => message.id).join("|");
  let state = routeStates.get(document);
  if (!state) {
    state = { key, signature, stale: null };
    routeStates.set(document, state);
  } else if (state.key !== key) {
    state.stale = state.signature;
    state.key = key;
  }
  if (state.stale !== null) {
    if (!signature || signature === state.stale) return false;
    state.stale = null;
  }
  state.signature = signature;
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[aria-current='page'][href]"))
    .some(link => {
      try { return new URL(link.href).pathname === window.location.pathname; } catch { return false; }
    });
}

export function providerCompletion(assistant: ProviderMessage, visible: Visible): boolean {
  const provider = currentProvider();
  const container = assistant.element.closest(provider === "claude" ? "[data-testid='transcript-row']" : "model-response");
  if (!container) return false;
  if (provider === "claude" && (container.getAttribute("data-perf-row-streaming") !== "false" ||
      assistant.element.closest("[data-testid='assistant-message']")?.getAttribute("data-is-streaming") !== "false")) return false;
  if (provider === "gemini" && (assistant.element.getAttribute("aria-busy") !== "false" ||
      !container.querySelector(".response-footer.complete"))) return false;
  const labels = Array.from(container.querySelectorAll("button")).filter(visible)
    .filter(button => !assistant.element.contains(button))
    .map(button => button.getAttribute("aria-label")?.toLowerCase());
  return labels.includes("copy") && labels.includes("good response") && labels.includes("bad response");
}

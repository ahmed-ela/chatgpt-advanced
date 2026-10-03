import { QUEUE_MESSAGE_TYPE, getQueueKey, type QueueItem, type QueueState } from "./queue-store";
import {
  findQueueComposer, readComposer, writeComposer, findQueueSendButton, findQueueStopButton,
  isChatBusy, hasComposerAttachments, getVisibleUserMessages,
  getAssistantCompletionAfter, isCurrentConversationReady,
  registerNewConversationAlias, clearConversationAlias, composerScope, getProviderName,
} from "./chatgpt-dom";

interface QueueRuntime {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage?: { addListener(listener: (message: { type?: string; key?: string }) => void): void };
}

const ROOT = "plannotator-message-queue";
const POLL_MS = 900;
const SEND_DRAFT_WARNING = "Queue or clear the current draft before using Send now.";
const EDIT_DRAFT_WARNING = "Queue or clear the current draft before editing a queued message.";
const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const icon = (name: "edit" | "trash" | "send") => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === "edit" ? '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>' : name === "trash" ? '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>' : '<path d="M12 20V4m-7 7 7-7 7 7"/>'}</svg>`;
const grip = '<svg class="grip" width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="4" cy="9" r="1.3"/><circle cx="10" cy="9" r="1.3"/><circle cx="4" cy="14" r="1.3"/><circle cx="10" cy="14" r="1.3"/></svg>';

/** Each tab is a view. Only the background's transactional claim grants sending. */
export class MessageQueue {
  private clientId = crypto.randomUUID();
  private key: string | null = null;
  private state: QueueState | null = null;
  private error = "";
  private expanded = true;
  private editing: string | null = null;
  private editToken: string | null = null;
  private editBaseText = "";
  private editingBusy = false;
  private editRevision = 0;
  private saving = false;
  private dispatching = false;
  private nativeDispatch = false;
  private polling = false;
  private tickPending = false;
  private tickTimer = 0;
  private observer: MutationObserver | null = null;
  private domWaiters = new Set<() => void>();
  private signature = "";
  private dragId: string | null = null;
  private pointerDrag: { id: string; pointerId: number; x: number; y: number; handle: HTMLElement; toId?: string } | null = null;
  private pendingSave: { id: string; key: string; text: string } | null = null;
  private firstSend: { text: string; expiresAt: number; key?: string } | null = null;
  private pollTimer = 0;
  private lastPoll = 0;
  private retryAfter = 0;
  private host = document.createElement("div");
  private shadow = this.host.attachShadow({ mode: "open" });
  private panel = document.createElement("section");
  private abort = new AbortController();

  constructor(private runtime: QueueRuntime) {}

  start(): void {
    if (document.getElementById(ROOT)) return;
    this.host.id = ROOT;
    this.host.style.cssText = "position:fixed;z-index:2147483645;pointer-events:none;display:none";
    this.shadow.innerHTML = `<style>
      :host{color-scheme:light dark;font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:light-dark(#242424,#eee)}
      *{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:8px;padding:5px 8px;background:transparent;color:inherit}
      button:hover{background:light-dark(#e9e9e9,#3a3a3a)}button:disabled{opacity:.4;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid #458cff;outline-offset:2px}
      section{pointer-events:auto;background:light-dark(#fafafa,#232323);border:1px solid light-dark(#dedede,#444);border-radius:16px;box-shadow:0 4px 18px #00000010;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;padding:7px 9px;min-height:42px}.title{font-weight:600;flex:1;text-align:left}.count{font-size:11px;opacity:.65;margin-left:4px}.add{background:light-dark(#222,#eee);color:light-dark(#fff,#222);font-weight:600}.add:hover{opacity:.85;background:light-dark(#222,#eee)}
      ol{padding:0;margin:0;list-style:none;max-height:240px;overflow:auto}li{position:relative;padding:9px 12px;border-top:1px solid light-dark(#e5e5e5,#3c3c3c);display:flex;gap:9px;align-items:flex-start}.order-slot{position:relative;flex:0 0 18px;width:18px;height:24px;padding:0;border-radius:4px;display:grid;place-items:center}.num{opacity:.45;font-size:11px;transition:opacity 140ms ease}.drag-handle{cursor:grab;user-select:none}.drag-handle:hover{background:transparent}.grip{position:absolute;opacity:0;transition:opacity 140ms ease;pointer-events:none}.drag-handle:active{cursor:grabbing}li:hover .drag-handle .num,.drag-handle:focus-visible .num,li.dragging .num{opacity:0}li:hover .grip,.drag-handle:focus-visible .grip,li.dragging .grip{opacity:.65}li.dragging .body{opacity:.5}li.drop-before{box-shadow:inset 0 2px #458cff}li.drop-after{box-shadow:inset 0 -2px #458cff}.body{flex:1;min-width:0}.text{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.status{font-size:11px;opacity:.7;margin-top:3px}.tools{display:flex;align-items:center;gap:1px}.tools button{padding:3px 6px}textarea{display:block;width:100%;min-height:70px;resize:vertical;border:1px solid light-dark(#bbb,#555);border-radius:8px;background:light-dark(white,#181818);color:inherit;padding:8px}.edit-tools{margin-top:6px;display:flex;gap:6px}
      .hint{padding:4px 12px 8px;font-size:11px;opacity:.65}.error{padding:8px 12px;color:light-dark(#9b3025,#ffb3a9);border-top:1px solid light-dark(#e5e5e5,#444)}.review{color:light-dark(#9b3025,#ffb3a9)}
      @media(max-height:650px){ol{max-height:150px}}
      .drag-handle{touch-action:none}
      @media(prefers-reduced-motion:reduce){.num,.grip{transition:none}}
    </style>`;
    this.panel.setAttribute("aria-label", "Message queue");
    this.shadow.append(this.panel);
    document.body.append(this.host);
    const options = { capture: true, signal: this.abort.signal };
    window.addEventListener("keydown", event => this.onKey(event), options);
    window.addEventListener("click", event => this.onNativeClick(event), options);
    window.addEventListener("submit", event => {
      if (this.nativeDispatch) return;
      const composer = findQueueComposer();
      if (composer && event.target instanceof Element && event.target.contains(composer) && this.shouldQueue()) {
        event.preventDefault(); event.stopImmediatePropagation(); void this.enqueue();
      }
    }, options);
    document.addEventListener("input", () => {
      // Native editors may commit after our capture listener. Read their final
      // draft at the end of the event, so cleared inputs don't look occupied.
      queueMicrotask(() => {
        if (this.abort.signal.aborted) return;
        this.render(); this.scheduleTick();
      });
    }, { signal: this.abort.signal });
    document.addEventListener("visibilitychange", () => this.scheduleTick(), { signal: this.abort.signal });
    window.addEventListener("resize", () => this.position(), { signal: this.abort.signal });
    document.addEventListener("scroll", () => this.position(), { capture: true, passive: true, signal: this.abort.signal });
    this.shadow.addEventListener("click", event => { void this.onAction(event); });
    this.shadow.addEventListener("pointerdown", raw => {
      const event = raw as PointerEvent;
      const handle = (event.target as Element).closest<HTMLElement>(".drag-handle");
      const id = handle?.closest<HTMLElement>("li[data-id]")?.dataset.id;
      if (event.button !== 0 || !handle || !id || this.state?.items.find(item => item.id === id)?.status !== "queued") return;
      // Capture the gesture so holding the handle works across rows and beyond
      // the small icon, without depending on the browser's native text drag.
      event.preventDefault();
      handle.focus({ preventScroll: true });
      this.pointerDrag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, handle };
      this.host.dataset.reloadBlocked = "true";
      handle.setPointerCapture?.(event.pointerId);
    });
    this.shadow.addEventListener("pointermove", raw => {
      const event = raw as PointerEvent;
      const held = this.pointerDrag;
      if (!held || event.pointerId !== held.pointerId) return;
      if (!this.dragId && Math.hypot(event.clientX - held.x, event.clientY - held.y) < 4) return;
      this.dragId = held.id;
      held.handle.closest("li")?.classList.add("dragging");
      this.host.dataset.reloadBlocked = "true";
      const rows = Array.from(this.shadow.querySelectorAll<HTMLElement>("li[data-id]"));
      const row = rows.find(entry => {
        const rect = entry.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      held.toId = row?.dataset.id;
      rows.forEach(entry => entry.classList.remove("drop-before", "drop-after"));
      const from = this.state?.items.findIndex(item => item.id === held.id) ?? -1;
      const to = this.state?.items.findIndex(item => item.id === held.toId) ?? -1;
      if (row && from >= 0 && to >= 0 && from !== to) row.classList.add(from > to ? "drop-before" : "drop-after");
    });
    this.shadow.addEventListener("pointerup", raw => {
      const event = raw as PointerEvent;
      const held = this.pointerDrag;
      if (!held || event.pointerId !== held.pointerId) return;
      const from = this.state?.items.findIndex(item => item.id === this.dragId) ?? -1;
      const to = this.state?.items.findIndex(item => item.id === held.toId) ?? -1;
      this.clearDrag();
      if (from !== to && from >= 0 && to >= 0) void this.change("move", { id: held.id, delta: to - from });
    });
    this.shadow.addEventListener("pointercancel", () => this.clearDrag());
    this.shadow.addEventListener("lostpointercapture", () => { if (this.pointerDrag) this.clearDrag(); });
    this.shadow.addEventListener("keydown", raw => {
      const event = raw as KeyboardEvent;
      if (event.key === "Escape" && this.pointerDrag) { event.preventDefault(); event.stopPropagation(); this.clearDrag(); return; }
      const handle = (event.target as Element).closest(".drag-handle");
      if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const id = handle.closest<HTMLElement>("li[data-id]")?.dataset.id;
      if (id) void this.change("move", { id, delta: event.key === "ArrowUp" ? -1 : 1 }).then(() => {
        const row = Array.from(this.shadow.querySelectorAll<HTMLElement>("li[data-id]")).find(entry => entry.dataset.id === id);
        row?.querySelector<HTMLButtonElement>(".drag-handle")?.focus();
      });
    });
    this.shadow.addEventListener("dragstart", raw => {
      const event = raw as DragEvent;
      const handle = (event.target as Element).closest(".drag-handle");
      const row = handle?.closest<HTMLElement>("li[data-id]");
      const id = row?.dataset.id;
      if (!id || this.state?.items.find(item => item.id === id)?.status !== "queued") { event.preventDefault(); return; }
      this.dragId = id;
      row.classList.add("dragging");
      this.host.dataset.reloadBlocked = "true";
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.setDragImage(row, 18, 18);
      }
    });
    this.shadow.addEventListener("dragover", raw => {
      if (!this.dragId) return;
      const event = raw as DragEvent;
      const row = (event.target as Element).closest<HTMLElement>("li[data-id]");
      const from = this.state?.items.findIndex(item => item.id === this.dragId) ?? -1;
      const to = this.state?.items.findIndex(item => item.id === row?.dataset.id) ?? -1;
      this.shadow.querySelectorAll(".drop-before,.drop-after").forEach(entry => entry.classList.remove("drop-before", "drop-after"));
      if (!row || from < 0 || to < 0) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (from !== to) row.classList.add(from > to ? "drop-before" : "drop-after");
    });
    this.shadow.addEventListener("drop", event => {
      event.preventDefault();
      const toId = (event.target as Element).closest<HTMLElement>("li[data-id]")?.dataset.id;
      const fromId = this.dragId;
      this.clearDrag();
      if (!fromId || !toId || !this.state) return;
      const from = this.state.items.findIndex(item => item.id === fromId);
      const to = this.state.items.findIndex(item => item.id === toId);
      if (from !== to && from >= 0 && to >= 0) void this.change("move", { id: fromId, delta: to - from });
    });
    this.shadow.addEventListener("dragend", () => this.clearDrag());
    this.runtime.onMessage?.addListener(message => {
      if (message.type === "plannotator:queue:changed" && message.key === this.key) this.scheduleTick();
    });
    // React to native completion signals immediately; polling is only fallback.
    this.observer = new MutationObserver(records => {
      if (records.every(record => record.target === this.host || this.host.contains(record.target))) return;
      for (const wake of this.domWaiters) wake();
      if (!this.state?.items.length || this.dispatching || this.saving || isChatBusy()) return;
      this.scheduleTick();
    });
    this.observer.observe(document.body, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ["aria-label", "title", "disabled", "aria-disabled", "hidden", "aria-hidden", "class", "data-testid", "data-is-streaming", "data-perf-row-streaming", "aria-busy", "data-status"],
    });
    this.pollTimer = window.setInterval(() => { void this.tick(); }, POLL_MS);
    void this.tick();
  }

  stop(): void {
    clearInterval(this.pollTimer); clearTimeout(this.tickTimer); this.observer?.disconnect(); this.abort.abort();
    for (const wake of this.domWaiters) wake();
    this.host.remove();
  }

  private waitForDomChange(timeoutMs: number): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const wake = () => { clearTimeout(timer); this.domWaiters.delete(wake); resolve(); };
      const timer = window.setTimeout(wake, timeoutMs);
      this.domWaiters.add(wake);
    });
  }

  private scheduleTick(): void {
    if (this.abort.signal.aborted) return;
    this.tickPending = true;
    if (this.tickTimer || this.polling || this.dispatching || this.saving || this.editingBusy) return;
    this.tickTimer = window.setTimeout(() => {
      this.tickTimer = 0; this.tickPending = false;
      void this.tick(true);
    }, 0);
  }

  private clearDrag(): void {
    const held = this.pointerDrag;
    this.pointerDrag = null;
    if (held?.handle.hasPointerCapture?.(held.pointerId)) held.handle.releasePointerCapture(held.pointerId);
    this.dragId = null;
    this.shadow.querySelectorAll(".dragging,.drop-before,.drop-after").forEach(row => row.classList.remove("dragging", "drop-before", "drop-after"));
    this.render();
  }

  private syncRoute(): string | null {
    const key = getQueueKey(location.href);
    if (key !== this.key) {
      clearConversationAlias();
      if (!this.key && key?.startsWith("chatgpt:") && this.firstSend && !this.firstSend.key && Date.now() < this.firstSend.expiresAt) {
        this.firstSend.key = key;
      } else this.firstSend = null;
      this.key = key; this.state = null; this.editing = null; this.editToken = null; this.error = "";
      this.editRevision++; this.retryAfter = 0;
      this.pendingSave = null; this.signature = "";
    }
    if (key && this.firstSend?.key === key && registerNewConversationAlias(key, this.firstSend.text)) this.firstSend = null;
    return key;
  }

  private captureFirstSend(): void {
    // A temporary conversation identity is trusted only after observing this
    // tab send the first message from a genuinely empty new-chat page.
    if (location.hostname !== "chatgpt.com" || location.pathname !== "/" || getVisibleUserMessages().length ||
        Array.from(document.querySelectorAll("[data-markdown-text-style='assistant-message'],[data-message-author-role='assistant'],[data-chatgpt-selection-conversation-id]"))
          .some(element => element.getClientRects().length)) return;
    const composer = findQueueComposer();
    const text = composer && readComposer(composer);
    if (text?.trim() && !hasComposerAttachments()) this.firstSend = { text, expiresAt: Date.now() + 120000 };
  }

  private async request(action: string, extra: Record<string, unknown> = {}, key = this.key): Promise<{ state: QueueState; claimed?: QueueItem }> {
    if (!key) throw new Error(`Open a saved ${getProviderName()} conversation to use the queue.`);
    const reply = await this.runtime.sendMessage({ type: QUEUE_MESSAGE_TYPE, key, clientId: this.clientId, action, ...extra }) as
      { ok: boolean; error?: string; state?: QueueState; claimed?: QueueItem };
    if (!reply?.ok || !reply.state) throw new Error(reply?.error || "The queue is unavailable. Reload the extension and this tab.");
    if (key === getQueueKey(location.href) && key === this.key && (!this.state || reply.state.revision >= this.state.revision)) {
      this.state = reply.state;
    }
    return { state: reply.state, claimed: reply.claimed };
  }

  private async change(action: string, extra: Record<string, unknown> = {}): Promise<void> {
    try { await this.request(action, extra); this.error = ""; }
    catch (error) { this.error = this.describe(error); }
    this.render();
  }

  private async tick(immediate = false): Promise<void> {
    if (this.polling || this.dispatching || this.saving || this.editingBusy || this.abort.signal.aborted || (!immediate && Date.now() - this.lastPoll < 400)) return;
    this.lastPoll = Date.now();
    this.polling = true;
    let editRevision = this.editRevision;
    try {
      const key = this.syncRoute();
      editRevision = this.editRevision;
      if (!key) { this.render(); return; }
      const busy = isChatBusy();
      // Release this tab's busy lease promptly; other tabs' busy evidence still
      // blocks claims until they report idle or expire.
      await this.request("heartbeat", { busy });
      if (key !== this.syncRoute() || editRevision !== this.editRevision || this.editingBusy) return;
      if (this.editing && this.editToken) {
        const edited = this.state?.items.find(item => item.id === this.editing);
        if (edited?.status === "editing" && edited.editToken === this.editToken) {
          await this.request("edit-heartbeat", { id: this.editing, editToken: this.editToken }, key);
          if (editRevision !== this.editRevision || this.editingBusy) return;
        }
      }
      for (const item of this.state?.items ?? []) {
        if (item.status === "waiting" && item.userMessageId && !busy && getAssistantCompletionAfter(item.userMessageId)) {
          await this.request("complete", { id: item.id, userMessageId: item.userMessageId }, key);
        }
      }
      this.render();
      if (this.canDispatch()) await this.dispatch();
    } catch (error) {
      // A heartbeat that began before an edit may be stale, especially when
      // the save committed but its acknowledgement was lost. Preserve the
      // edit's result and error instead of renewing that obsolete reservation.
      if (editRevision === this.editRevision && !this.editingBusy) {
        this.error = this.describe(error); this.render();
      }
    } finally { this.polling = false; if (this.tickPending) this.scheduleTick(); }
  }

  private shouldQueue(): boolean {
    // Before the first durable read returns, a native send could skip a saved
    // paused queue. Persist it first; an empty unpaused queue drains normally.
    return Boolean(this.syncRoute() && (!this.state || this.editing || isChatBusy() || this.state.paused || this.state.items.length));
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing || event.repeat) return;
    const composer = findQueueComposer();
    const target = event.composedPath()[0];
    if (!composer || !(target instanceof Node) || !composer.contains(target)) return;
    if (!this.shouldQueue()) { this.captureFirstSend(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void this.enqueue();
  }

  private onNativeClick(event: MouseEvent): void {
    if (this.nativeDispatch) return;
    const send = findQueueSendButton();
    if (!send || !event.composedPath().includes(send)) return;
    if (!this.shouldQueue()) { this.captureFirstSend(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void this.enqueue();
  }

  private async enqueue(): Promise<void> {
    if (this.editing) { await this.saveEdit(); return; }
    if (this.saving || this.dispatching) return;
    const key = this.syncRoute();
    const composer = findQueueComposer();
    const text = composer ? readComposer(composer) : "";
    if (!key || !composer || !text.trim()) return;
    if (hasComposerAttachments()) { this.error = "Queue supports text messages. Send attachments directly after this response finishes."; this.render(); return; }
    this.saving = true; this.error = "";
    if (!this.pendingSave || this.pendingSave.text !== text || this.pendingSave.key !== key) {
      this.pendingSave = { id: crypto.randomUUID(), text, key };
    }
    this.render();
    try {
      const pending = this.pendingSave;
      await this.request("enqueue", { id: pending.id, text, afterUserMessageId: getVisibleUserMessages().at(-1)?.id }, key);
      if (key === this.syncRoute() && composer.isConnected && readComposer(composer) === text) {
        if (!writeComposer(composer, "")) this.error = "Saved to queue. Clear the composer to continue.";
        else this.pendingSave = null;
      } else {
        this.pendingSave = null;
      }
      this.expanded = true;
    } catch (error) { this.error = `${this.describe(error)} Your draft is still in the composer.`; }
    finally { this.saving = false; this.render(); this.scheduleTick(); }
  }

  private canDispatch(): boolean {
    const composer = findQueueComposer();
    return Boolean(this.state && this.state.items.length && !this.state.paused &&
      Date.now() >= this.retryAfter &&
      !this.state.items.some(item => item.status !== "queued") &&
      document.visibilityState === "visible" && !this.editing && !this.saving && !this.dragId && !this.pointerDrag &&
      composer && !readComposer(composer).trim() && !hasComposerAttachments() &&
      !isChatBusy() && this.transcriptReady());
  }

  private transcriptReady(): boolean {
    return this.state?.lastCompletedUserMessageId
      ? getAssistantCompletionAfter(this.state.lastCompletedUserMessageId)
      : isCurrentConversationReady();
  }

  private async dispatch(sendNowId?: string): Promise<void> {
    if (this.dispatching || this.saving || this.editing) return;
    const sendNow = Boolean(sendNowId);
    if (!sendNow && !this.canDispatch()) return;
    if (sendNow) {
      this.syncRoute();
      const composer = findQueueComposer();
      if (!composer) {
        this.error = "Wait for the message input to finish loading before using Send now."; this.render(); return;
      }
      if (readComposer(composer).trim() || hasComposerAttachments()) {
        this.error = SEND_DRAFT_WARNING; this.render(); return;
      }
      if (!isCurrentConversationReady() || document.visibilityState !== "visible") {
        this.error = "Wait for this conversation to finish loading before using Send now."; this.render(); return;
      }
    }
    this.dispatching = true;
    this.host.dataset.reloadBlocked = "true";
    const key = this.key!;
    let item: QueueItem | undefined;
    let attempted = false;
    let postedUserMessageId: string | undefined;
    let composer: ReturnType<typeof findQueueComposer> = null;
    let clicked = false;
    try {
      item = (await this.request(sendNow ? "steer" : "claim", sendNow ? { id: sendNowId } : { afterUserMessageId: this.state?.lastCompletedUserMessageId }, key)).claimed;
      if (!item) return;
      this.error = ""; this.render();
      composer = findQueueComposer();
      if (key !== this.syncRoute() || !composer || !isCurrentConversationReady() ||
          readComposer(composer).trim() || hasComposerAttachments() || document.visibilityState !== "visible") {
        await this.request("release", { id: item.id }, key); return;
      }
      if (sendNow && isChatBusy()) {
        const stop = findQueueStopButton();
        if (!stop) throw new Error("The current response cannot be stopped yet. The message remains queued.");
        composer.setAttribute("data-plannotator-queued-send", item.id);
        try { stop.click(); } finally { composer.removeAttribute("data-plannotator-queued-send"); }
        const deadline = Date.now() + 7000;
        while (isChatBusy() && key === this.syncRoute() && !this.abort.signal.aborted && Date.now() < deadline) {
          await this.waitForDomChange(200);
        }
        if (isChatBusy()) throw new Error("The response is still stopping. The message remains queued.");
      }
      const ready = () => sendNow ? isCurrentConversationReady() : this.transcriptReady();
      composer = findQueueComposer();
      if (key !== this.syncRoute() || !composer || readComposer(composer).trim() || isChatBusy() ||
          !ready() || document.visibilityState !== "visible" || hasComposerAttachments()) {
        await this.request("release", { id: item.id }, key); return;
      }
      const before = new Set(getVisibleUserMessages().map(message => message.id));
      if (!writeComposer(composer, item.text)) throw new Error("Could not fill the composer. The message remains saved.");
      // Yield for the native composer commit, then wait only while Send is not
      // ready instead of adding a fixed delay to every queued message.
      await new Promise(resolve => window.setTimeout(resolve, 0));
      const composerDeadline = Date.now() + 1000;
      while (!findQueueSendButton() && Date.now() < composerDeadline && key === this.syncRoute() &&
          !this.abort.signal.aborted && !isChatBusy() && composer.isConnected && normalize(readComposer(composer)) === normalize(item.text)) {
        await this.waitForDomChange(100);
      }
      if (this.abort.signal.aborted || key !== this.syncRoute() || isChatBusy() || !composer.isConnected ||
          normalize(readComposer(composer)) !== normalize(item.text) || hasComposerAttachments() ||
          !findQueueSendButton() || !ready() || document.visibilityState !== "visible") {
        throw new Error("The conversation changed before sending. The message remains saved.");
      }
      await this.request("attempt", { id: item.id }, key);
      attempted = true;
      this.render();
      const send = findQueueSendButton();
      if (this.abort.signal.aborted || !send || key !== this.syncRoute() || isChatBusy() || !composer.isConnected ||
          normalize(readComposer(composer)) !== normalize(item.text) || hasComposerAttachments() || !ready()) {
        throw new Error("Send was interrupted. Check the conversation before retrying.");
      }
      clicked = true;
      this.nativeDispatch = true;
      composer.setAttribute("data-plannotator-queued-send", item.id);
      try { send.click(); } finally { this.nativeDispatch = false; composer.removeAttribute("data-plannotator-queued-send"); }
      const deadline = Date.now() + 15000;
      while (!this.abort.signal.aborted && Date.now() < deadline && key === this.syncRoute()) {
        const posted = getVisibleUserMessages().find(message => !before.has(message.id) && normalize(message.text) === normalize(item!.text));
        if (posted) {
          postedUserMessageId = posted.id;
          await this.request("ack", { id: item.id, userMessageId: posted.id }, key);
          this.error = ""; return;
        }
        await this.waitForDomChange(300);
      }
      throw new Error("Could not confirm the send. Check the conversation before retrying.");
    } catch (error) {
      if (item) {
        try {
          const result = await this.request(attempted ? "review" : "release", { id: item.id, reason: this.describe(error) }, key);
          // The acknowledgement can commit while its IPC reply is lost. A
          // confirmed store record wins over this tab's transport error.
          if (attempted && result.state.items.some(entry => entry.id === item!.id && entry.status === "waiting" && entry.userMessageId)) {
            this.error = ""; return;
          }
        } catch {
          // Another tab may already have completed this confirmed turn while
          // the sender's acknowledgement reply was lost. Require that exact
          // durable completion anchor before clearing the transport error.
          if (attempted && postedUserMessageId) {
            try {
              const result = await this.request("read", {}, key);
              if (!result.state.items.some(entry => entry.id === item!.id) && result.state.lastCompletedUserMessageId === postedUserMessageId) {
                this.error = ""; return;
              }
            } catch { /* No durable confirmation: keep the error visible. */ }
          }
          // Persisted claims recover; attempted sends never auto-retry.
        }
      }
      if (!clicked && composer?.isConnected && key === this.key && item && normalize(readComposer(composer)) === normalize(item.text)) {
        writeComposer(composer, "");
      }
      this.error = this.describe(error);
    } finally {
      // Releasing a failed claim broadcasts a change and clearing its draft
      // emits input. Neither should immediately retry the same failed fill.
      // Successful sends have no cooldown; only pre-send failures back off.
      if (item && !attempted) this.retryAfter = Date.now() + 1000;
      this.dispatching = false; this.render(); if (this.tickPending) this.scheduleTick();
    }
  }

  private async onAction(event: Event): Promise<void> {
    const button = (event.target as Element)?.closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled) return;
    const id = button.closest<HTMLElement>("[data-id]")?.dataset.id;
    switch (button.dataset.action) {
      case "enqueue": await this.enqueue(); break;
      case "expand": this.expanded = !this.expanded; this.render(); break;
      case "pause": await this.change("pause", { paused: !this.state?.paused }); break;
      case "remove": if (id) await this.removeItem(id); break;
      case "edit": if (id) await this.beginEdit(id); break;
      case "steer": if (id) await this.dispatch(id); break;
      case "save": await this.saveEdit(); break;
      case "cancel-edit": await this.cancelEdit(); break;
      case "retry": if (id) await this.change("retry", { id }); break;
      case "resolve": if (id) await this.change("remove", { id }); break;
      case "check": this.error = ""; this.lastPoll = 0; await this.tick(); break;
    }
  }

  private async saveEdit(): Promise<void> {
    if (!this.editing || !this.editToken || this.editingBusy || this.saving || this.dispatching) return;
    const key = this.key;
    const id = this.editing;
    const composer = findQueueComposer();
    const text = composer ? readComposer(composer) : "";
    if (!key || !composer || !text.trim()) return;
    if (hasComposerAttachments()) { this.error = "Queue edits support text. Remove attachments before saving this edit."; this.render(); return; }
    this.editingBusy = true; this.editRevision++; this.render();
    try {
      await this.request("read", {}, key);
      if (key !== this.syncRoute()) return;
      const current = this.state?.items.find(item => item.id === id);
      if (current?.status === "queued" && current.lastEditToken !== this.editToken) {
        // A sleeping tab can outlive its edit lease. Reacquire the original
        // slot without overwriting changes made by a different editor.
        const token = crypto.randomUUID();
        this.editToken = token;
        const reserved = (await this.request("begin-edit", { id, editToken: token }, key)).state.items.find(item => item.id === id);
        if (reserved?.text !== this.editBaseText) {
          await this.request("cancel-edit", { id, editToken: token }, key);
          throw new Error("This queued message changed in another tab. Your draft is still in the composer.");
        }
      }
      await this.request("edit", { id, text, editToken: this.editToken }, key);
      if (key !== this.syncRoute()) return;
      this.editing = null; this.editToken = null; this.error = "";
      if (composer.isConnected && readComposer(composer) === text && !writeComposer(composer, "")) {
        // Reuse the saved item's ID if clearing fails, so another Enter cannot
        // append a duplicate even if the edited message has already been sent.
        this.pendingSave = { id, key, text };
        this.error = "Edit saved in its queue position. Clear the composer to continue.";
      }
    }
    catch (error) { this.error = this.describe(error); }
    finally { this.editingBusy = false; this.render(); this.scheduleTick(); }
  }

  private async beginEdit(id: string): Promise<void> {
    if (this.editing || this.saving || this.dispatching) return;
    const key = this.syncRoute();
    const composer = findQueueComposer();
    if (!key || !composer) return;
    if (readComposer(composer).trim() || hasComposerAttachments()) {
      this.error = EDIT_DRAFT_WARNING; this.render(); return;
    }
    const token = crypto.randomUUID();
    this.saving = true; this.editRevision++; this.render();
    try {
      await this.request("begin-edit", { id, editToken: token }, key);
      const item = this.state?.items.find(entry => entry.id === id);
      if (key !== this.syncRoute() || !item || !composer.isConnected || readComposer(composer).trim() || hasComposerAttachments()) {
        await this.request("cancel-edit", { id, editToken: token }, key); return;
      }
      this.editing = id; this.editToken = token; this.editBaseText = item.text;
      if (!writeComposer(composer, item.text)) {
        await this.request("cancel-edit", { id, editToken: token }, key);
        this.editing = null; this.editToken = null;
        throw new Error("Could not move the saved message into the composer. It remains queued.");
      }
      composer.focus(); this.error = ""; this.expanded = true;
    } catch (error) { this.error = this.describe(error); }
    finally { this.saving = false; this.render(); if (this.tickPending) this.scheduleTick(); }
  }

  private async cancelEdit(): Promise<void> {
    if (!this.editing || !this.editToken || this.editingBusy) return;
    const key = this.key;
    const composer = findQueueComposer();
    const text = composer && readComposer(composer);
    this.editingBusy = true; this.editRevision++;
    try {
      const current = (await this.request("read")).state.items.find(item => item.id === this.editing);
      if (current?.status === "editing" && current.editToken === this.editToken) {
        await this.request("cancel-edit", { id: this.editing, editToken: this.editToken });
      }
      if (key !== this.syncRoute()) return;
      this.editing = null; this.editToken = null; this.error = "";
      if (composer?.isConnected && readComposer(composer) === text) writeComposer(composer, "");
    } catch (error) { this.error = this.describe(error); }
    finally { this.editingBusy = false; this.render(); this.scheduleTick(); }
  }

  private async removeItem(id: string): Promise<void> {
    const ownedEdit = id === this.editing;
    if (ownedEdit && this.editingBusy) return;
    const key = this.key;
    const composer = ownedEdit ? findQueueComposer() : null;
    const text = composer && readComposer(composer);
    if (ownedEdit) { this.editingBusy = true; this.editRevision++; }
    try {
      await this.request("remove", { id, ...(ownedEdit ? { editToken: this.editToken } : {}) });
      if (ownedEdit && key === this.syncRoute()) {
        this.editing = null; this.editToken = null;
        if (composer?.isConnected && readComposer(composer) === text) writeComposer(composer, "");
      }
      this.error = "";
    } catch (error) { this.error = this.describe(error); }
    finally {
      if (ownedEdit) this.editingBusy = false;
      this.render(); this.scheduleTick();
    }
  }

  private render(): void {
    this.host.dataset.reloadBlocked = String(this.saving || this.dispatching || Boolean(this.editing) || Boolean(this.dragId) || Boolean(this.pointerDrag));
    const composer = findQueueComposer();
    // Confirmed sends leave the visible queue immediately. Keep their durable
    // response anchors internally so every tab still waits before sending next.
    const allItems = this.state?.items ?? [];
    const items = allItems.filter(item => item.status !== "waiting");
    const draft = composer ? readComposer(composer).trim() : "";
    if (composer && !draft && !hasComposerAttachments() && [SEND_DRAFT_WARNING, EDIT_DRAFT_WARNING].includes(this.error)) this.error = "";
    const busy = isChatBusy();
    const showAdd = Boolean(draft && (busy || allItems.length || this.state?.paused));
    if (!this.key || !composer || (!items.length && !showAdd && !this.error && !this.state?.paused)) {
      this.host.style.display = "none";
      this.panel.replaceChildren(); this.signature = "";
      return;
    }
    if (!this.host.isConnected) document.body.append(this.host);
    this.host.style.display = "block";
    const status = this.editing ? `Editing message ${items.findIndex(item => item.id === this.editing) + 1} in composer · Send saves its place` : this.state?.paused ? "Paused" : items.some(item => item.status === "editing") ? "Waiting for an edit" : items.some(item => item.status === "review") ? "Needs review" :
      allItems.some(item => item.status === "sending") ? "Confirming send" : allItems.some(item => item.status === "claimed") ? "Preparing message" :
      busy || allItems.some(item => item.status === "waiting") ? "Waiting for response" : draft && items.length ? "Waiting for composer" : "Saved across tabs";
    const signature = JSON.stringify([items, this.state?.paused, status, showAdd, this.saving, this.editingBusy, this.dispatching, this.expanded, this.editing, this.error]);
    if (signature !== this.signature && !this.dragId && !this.pointerDrag) {
      this.signature = signature;
      this.panel.innerHTML = `<header>
        <button class="title" data-action="expand" aria-label="${this.expanded ? "Collapse" : "Expand"} message queue" aria-expanded="${this.expanded}">${items.length ? `Queue <span class="count">${items.length}</span>` : "Queue next message"}</button>
        ${items.length || this.state?.paused ? `<button data-action="pause" aria-label="${this.state?.paused ? "Resume" : "Pause"} queue">${this.state?.paused ? "Resume" : "Pause"}</button>` : ""}
        ${showAdd ? `<button class="add" data-action="enqueue" ${this.saving || this.editingBusy ? "disabled" : ""}>${this.saving || this.editingBusy ? "Saving…" : this.editing ? "Save edit" : "Queue message"}</button>` : ""}
      </header>
      ${this.expanded && items.length ? `<ol>${items.map((item, index) => this.itemHtml(item, index)).join("")}</ol><div class="hint">${status} · Stored in this Chrome profile</div>` : ""}
      ${this.error ? `<div class="error" role="status">${escapeHtml(this.error)} <button data-action="check">Check again</button></div>` : ""}`;
    }
    this.position();
  }

  private itemHtml(item: QueueItem, index: number): string {
    const id = escapeHtml(item.id);
    if (this.editing === item.id) return `<li data-id="${id}"><span class="order-slot"><span class="num">${index + 1}</span></span><div class="body"><div class="text">${escapeHtml(item.text)}</div><div class="status">Editing in composer · position reserved</div><div class="edit-tools"><button class="add" data-action="save" ${this.editingBusy ? "disabled" : ""}>Save edit</button><button data-action="cancel-edit" ${this.editingBusy ? "disabled" : ""}>Cancel edit</button></div></div><div class="tools"><button data-action="remove" aria-label="Remove message ${index + 1}" title="Delete queued message" ${this.editingBusy ? "disabled" : ""}>${icon("trash")}</button></div></li>`;
    const pending = item.status === "queued";
    const blocked = Boolean(this.editing || this.saving || this.dispatching || this.state?.items.some(entry => ["editing", "claimed", "sending", "review"].includes(entry.status)));
    const status = item.status === "editing" ? "Editing in a composer · position reserved" : item.status === "claimed" ? "Preparing…" : item.status === "sending" ? "Confirming send…" : item.status === "review" ? "Send unconfirmed · check this chat before retrying" : "";
    const order = pending ? `<button class="order-slot drag-handle" draggable="true" aria-label="Reorder message ${index + 1}" title="Drag to reorder; use arrow keys when focused"><span class="num" aria-hidden="true">${index + 1}</span>${grip}</button>` : `<span class="order-slot"><span class="num">${index + 1}</span></span>`;
    return `<li data-id="${id}" data-user-message-id="${escapeHtml(item.userMessageId ?? "")}">${order}<div class="body"><div class="text">${escapeHtml(item.text)}</div>${status ? `<div class="status ${item.status === "review" ? "review" : ""}">${status}</div>` : ""}
      ${item.status === "review" ? `<div class="edit-tools"><button data-action="retry" title="Retry only after checking that it was not sent">Retry message</button><button data-action="resolve">Dismiss from queue</button></div>` : ""}</div>
      ${pending ? `<div class="tools"><button data-action="steer" aria-label="Send message ${index + 1} now" title="Send now · stop the current response first" ${blocked ? "disabled" : ""}>${icon("send")}</button><button data-action="edit" aria-label="Edit message ${index + 1}" title="Edit in composer" ${blocked ? "disabled" : ""}>${icon("edit")}</button><button data-action="remove" aria-label="Remove message ${index + 1}" title="Delete queued message">${icon("trash")}</button></div>` : ""}</li>`;
  }

  private position(): void {
    const composer = findQueueComposer();
    if (!composer) return;
    const anchor = composerScope(composer) ?? composer;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) { this.host.style.display = "none"; return; }
    const width = Math.min(Math.max(rect.width, 300), innerWidth - 24);
    this.host.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    this.host.style.width = `${width}px`;
    this.host.style.bottom = `${Math.max(12, innerHeight - rect.top + 9)}px`;
  }

  private describe(error: unknown): string {
    if (error instanceof Error && /context invalidated|Receiving end|message port/i.test(error.message)) return "Reload this tab to reconnect the saved queue.";
    return error instanceof Error ? error.message : "Could not save the queue. Please try again.";
  }
}

const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: QueueRuntime } }).chrome?.runtime;
if (window.top === window && runtime?.sendMessage) new MessageQueue(runtime).start();

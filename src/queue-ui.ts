import { QUEUE_MESSAGE_TYPE, getQueueKey, type QueueItem, type QueueState } from "./queue-store";
import { icon } from "./icons";
import { getExtensionApi, type ExtensionRuntime } from "./browser-api";
import { NativeReplayGuard } from "./native-replay-guard";
import {
  findQueueComposer, readComposer, writeComposer, findQueueSendButton, findQueueStopButton,
  isChatBusy, hasComposerAttachments, getVisibleUserMessages,
  getAssistantCompletionAfter, getStableUserMessageAnchor, isCurrentConversationReady, getCurrentConversationReadiness,
  registerNewConversationAlias, clearConversationAlias, isEmptyNewChat, composerScope, getProviderName,
} from "./chatgpt-dom";

type QueueRuntime = Pick<ExtensionRuntime, "sendMessage" | "onMessage">;
type QueueHold = "loading" | "empty" | "paused" | "retry-delay" | "editing" | "saving" | "reordering" |
  "review" | "sending" | "claimed" | "waiting" | "composer-missing" | "draft" | "attachments" |
  "chat-busy" | "anchor-unverified" | "identity-unverified" | "completion-pending" | "transcript-loading" | "ready";

const ROOT = "plannotator-message-queue";
const POLL_MS = 900;
const SEND_CONFIRM_MS = 15_000;
const SEND_DRAFT_WARNING = "Queue or clear the current draft before using Send now.";
const EDIT_DRAFT_WARNING = "Queue or clear the current draft before editing a queued message.";
const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const grip = icon("grip", 18, "grip");

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
  private nativeReplay = new NativeReplayGuard();
  private polling = false;
  private tickPending = false;
  private tickScheduled = false;
  private observer: MutationObserver | null = null;
  private domWaiters = new Set<() => void>();
  // Gemini prompt indices can be reused after a reload. Only this document's
  // own enqueue/ACK observation can authorize a temporary indexed anchor.
  private temporaryAnchors = new Set<string>();
  private confirmedSends = new Set<string>();
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
    this.host.dataset.queueConfirmedSends = "0";
    this.host.style.cssText = "position:fixed;z-index:2147483645;pointer-events:none;display:none";
    this.shadow.innerHTML = `<style>
      :host{color-scheme:light dark;font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:light-dark(#242424,#eee)}
      *{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:8px;padding:5px 8px;background:transparent;color:inherit}
      button:hover{background:light-dark(#e9e9e9,#3a3a3a)}button:disabled{opacity:.4;cursor:default}button:focus-visible,textarea:focus-visible{outline:2px solid #458cff;outline-offset:2px}
      section{pointer-events:auto;background:light-dark(#fafafa,#232323);border:1px solid light-dark(#dedede,#444);border-radius:16px;box-shadow:0 4px 18px #00000010;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;padding:7px 9px;min-height:42px}.title{font-weight:600;flex:1;text-align:left}.title:hover{background:transparent}.count{font-size:11px;opacity:.65;margin-left:4px}.add{background:light-dark(#222,#eee);color:light-dark(#fff,#222);font-weight:600}.add:hover{opacity:.85;background:light-dark(#222,#eee)}
      ol{padding:0;margin:0;list-style:none;max-height:240px;overflow:auto}li{position:relative;padding:9px 12px;border-top:1px solid light-dark(#e5e5e5,#3c3c3c);display:flex;gap:9px;align-items:flex-start}.order-slot{position:relative;flex:0 0 18px;width:18px;height:24px;padding:0;border-radius:4px;display:grid;place-items:center}.num{opacity:.45;font-size:11px;transition:opacity 140ms ease}.drag-handle{cursor:grab;user-select:none}.drag-handle:hover{background:transparent}.grip{position:absolute;opacity:0;transition:opacity 140ms ease;pointer-events:none}.drag-handle:active{cursor:grabbing}li:hover .drag-handle .num,.drag-handle:focus-visible .num,li.dragging .num{opacity:0}li:hover .grip,.drag-handle:focus-visible .grip,li.dragging .grip{opacity:.65}li.dragging .body{opacity:.5}li.drop-before{box-shadow:inset 0 2px #458cff}li.drop-after{box-shadow:inset 0 -2px #458cff}.body{flex:1;min-width:0}.text{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.status{font-size:11px;opacity:.7;margin-top:3px}.tools{display:flex;align-items:center;gap:1px}.tools button{padding:3px 6px}textarea{display:block;width:100%;min-height:70px;resize:vertical;border:1px solid light-dark(#bbb,#555);border-radius:8px;background:light-dark(white,#181818);color:inherit;padding:8px}.edit-tools{margin-top:6px;display:flex;gap:6px}
      .error{padding:8px 12px;color:light-dark(#9b3025,#ffb3a9);border-top:1px solid light-dark(#e5e5e5,#444)}.review{color:light-dark(#9b3025,#ffb3a9)}
      @media(max-height:650px){ol{max-height:150px}}
      .drag-handle{touch-action:none}
      .icon{display:block;flex:none;pointer-events:none}button{display:inline-flex;align-items:center;justify-content:center;gap:5px}.title{justify-content:flex-start}.count{margin-left:0}.tools button{width:28px;height:28px;padding:5px}.icon-loader{animation:queue-icon-spin 800ms linear infinite}
      @keyframes queue-icon-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.num,.grip{transition:none}.icon-loader{animation:none}}
    </style>`;
    this.panel.setAttribute("aria-label", "Message queue");
    this.shadow.append(this.panel);
    document.body.append(this.host);
    const options = { capture: true, signal: this.abort.signal };
    window.addEventListener("keydown", event => this.onKey(event), options);
    window.addEventListener("click", event => this.onNativeClick(event), options);
    window.addEventListener("submit", event => {
      if (this.nativeDispatch) { this.nativeReplay.observeInitialSubmit(event); return; }
      const replay = this.nativeReplay.submit(event as SubmitEvent);
      if (replay === "allow") { this.markDispatchAttempt(); return; }
      if (replay === "block") { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const composer = findQueueComposer();
      if (!composer || !(event.target instanceof HTMLFormElement) || !event.target.contains(composer)) return;
      if (!this.shouldQueue()) { this.captureFirstSend(); return; }
      event.preventDefault(); event.stopImmediatePropagation(); void this.enqueue();
    }, options);
    document.addEventListener("input", () => {
      // Native editors may commit after our capture listener. Read their final
      // draft at the end of the event, so cleared inputs don't look occupied.
      queueMicrotask(() => {
        if (this.abort.signal.aborted) return;
        this.render(); this.scheduleTick();
      });
    }, { signal: this.abort.signal });
    document.addEventListener("visibilitychange", () => { this.nativeReplay.check(); this.scheduleTick(); }, { signal: this.abort.signal });
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
    this.runtime.onMessage?.addListener(rawMessage => {
      if (!rawMessage || typeof rawMessage !== "object") return;
      const message = rawMessage as { type?: string; key?: string };
      if (message.type === "plannotator:queue:changed" && message.key === this.key) this.scheduleTick();
    });
    // React to native completion signals immediately; polling is only fallback.
    this.observer = new MutationObserver(records => {
      if (records.every(record => record.target === this.host || this.host.contains(record.target))) return;
      this.nativeReplay.check();
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
    this.nativeReplay.finish();
    clearInterval(this.pollTimer); this.observer?.disconnect(); this.abort.abort();
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
    if (this.tickScheduled || this.polling || this.dispatching || this.saving || this.editingBusy) return;
    this.tickScheduled = true;
    // Completion and storage events already tell us when to check. Do not put
    // that work behind a timer that browsers throttle in background tabs.
    queueMicrotask(() => {
      this.tickScheduled = false; this.tickPending = false;
      void this.tick(true);
    });
  }

  private yieldComposerCommit(): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    // Let the native editor finish its input task without a throttled timer or
    // animation frame. Close both ports on completion or extension shutdown.
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const done = () => {
        channel.port1.close(); channel.port2.close();
        this.abort.signal.removeEventListener("abort", done);
        resolve();
      };
      channel.port1.onmessage = done;
      this.abort.signal.addEventListener("abort", done, { once: true });
      channel.port2.postMessage(null);
    });
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
      this.nativeReplay.revoke();
      clearConversationAlias(true);
      if (!this.key && key?.startsWith("chatgpt:") && this.firstSend && !this.firstSend.key && Date.now() < this.firstSend.expiresAt) {
        this.firstSend.key = key;
      } else this.firstSend = null;
      this.key = key; this.state = null; this.editing = null; this.editToken = null; this.error = "";
      this.temporaryAnchors.clear();
      this.editRevision++; this.retryAfter = 0;
      this.pendingSave = null; this.signature = "";
    }
    if (this.firstSend && !this.firstSend.key && Date.now() >= this.firstSend.expiresAt) this.firstSend = null;
    if (key && this.firstSend?.key === key && registerNewConversationAlias(key, this.firstSend.text)) this.firstSend = null;
    return key;
  }

  private captureFirstSend(): void {
    // A temporary conversation identity is trusted only after observing this
    // tab send the first message from a genuinely empty new-chat page.
    if (!isEmptyNewChat()) return;
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
      const previousAnchor = this.state?.lastCompletedUserMessageId;
      const stableAnchor = previousAnchor && this.canUseAnchor(previousAnchor) && getStableUserMessageAnchor(previousAnchor);
      if (stableAnchor && stableAnchor !== previousAnchor) {
        await this.request("anchor", { userMessageId: previousAnchor, afterUserMessageId: stableAnchor }, key);
        if (key !== this.syncRoute() || editRevision !== this.editRevision || this.editingBusy) return;
      }
      for (let item of this.state?.items ?? []) {
        if (item.status === "waiting" && item.userMessageId && this.canUseAnchor(item.userMessageId)) {
          const stable = getStableUserMessageAnchor(item.userMessageId);
          if (stable && stable !== item.userMessageId) {
            const result = await this.request("anchor", { id: item.id, userMessageId: item.userMessageId, afterUserMessageId: stable }, key);
            if (key !== this.syncRoute() || editRevision !== this.editRevision || this.editingBusy) return;
            const updated = result.state.items.find(entry => entry.id === item.id);
            if (!updated) continue;
            item = updated;
          }
        }
        if (item.status === "waiting" && item.userMessageId && this.canUseAnchor(item.userMessageId) && !busy && getAssistantCompletionAfter(item.userMessageId)) {
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
    if (event.isTrusted) this.nativeReplay.trustedIntent();
    if (!this.shouldQueue()) { this.captureFirstSend(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void this.enqueue();
  }

  private onNativeClick(event: MouseEvent): void {
    if (this.nativeDispatch) { this.nativeReplay.observeInitialClick(event); return; }
    const replay = this.nativeReplay.click(event);
    if (replay === "allow") { this.markDispatchAttempt(); return; }
    if (replay === "block") { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const send = findQueueSendButton();
    if (!send || !event.composedPath().includes(send)) return;
    if (event.isTrusted) this.nativeReplay.trustedIntent();
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
      const wasEmpty = this.state?.items.length === 0;
      const previous = getVisibleUserMessages().at(-1)?.id;
      const afterUserMessageId = previous && (getStableUserMessageAnchor(previous) ?? previous);
      const result = await this.request("enqueue", { id: pending.id, text, afterUserMessageId }, key);
      // Do not let adding to an older queue grant a witness to its unknown
      // indexed anchor merely because a different repeated prompt reused it.
      if (key === this.syncRoute() && wasEmpty && afterUserMessageId && result.state.items[0]?.id === pending.id &&
          result.state.lastCompletedUserMessageId === afterUserMessageId) this.temporaryAnchors.add(afterUserMessageId);
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
    return this.dispatchHold() === "ready";
  }

  /** Explain the same guards used for dispatch; never relax them for a status. */
  private dispatchHold(composer = findQueueComposer()): QueueHold {
    if (!this.state) return "loading";
    if (!this.state.items.length) return "empty";
    if (this.state.paused) return "paused";
    if (Date.now() < this.retryAfter) return "retry-delay";
    if (this.editing || this.state.items.some(item => item.status === "editing")) return "editing";
    if (this.saving) return "saving";
    if (this.dragId || this.pointerDrag) return "reordering";
    for (const status of ["review", "sending", "claimed", "waiting"] as const) {
      if (this.state.items.some(item => item.status === status)) {
        if (status === "waiting" && composer && !readComposer(composer).trim() && !hasComposerAttachments() &&
            !isChatBusy() && getCurrentConversationReadiness() === "identity-unverified") return "identity-unverified";
        return status;
      }
    }
    if (!composer) return "composer-missing";
    if (readComposer(composer).trim()) return "draft";
    if (hasComposerAttachments()) return "attachments";
    if (isChatBusy()) return "chat-busy";
    const anchor = this.state.lastCompletedUserMessageId;
    if (anchor && !this.canUseAnchor(anchor)) return "anchor-unverified";
    if (!this.transcriptReady()) {
      if (getCurrentConversationReadiness() === "identity-unverified") return "identity-unverified";
      return anchor ? "completion-pending" : "transcript-loading";
    }
    return "ready";
  }

  private transcriptReady(): boolean {
    return this.state?.lastCompletedUserMessageId
      ? this.canUseAnchor(this.state.lastCompletedUserMessageId) && getAssistantCompletionAfter(this.state.lastCompletedUserMessageId)
      : isCurrentConversationReady();
  }

  private canUseAnchor(userId: string): boolean {
    return !userId.startsWith("gemini:user:user-query-content-") || this.temporaryAnchors.has(userId);
  }

  private markConfirmedSend(id: string): void {
    this.confirmedSends.add(id);
    this.host.dataset.queueConfirmedSends = String(this.confirmedSends.size);
  }

  private markDispatchAttempt(): void {
    this.host.dataset.queueLastDispatchVisibility = document.visibilityState;
    this.host.dataset.queueLastDispatchTime = String(Date.now());
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
      if (!isCurrentConversationReady()) {
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
          readComposer(composer).trim() || hasComposerAttachments()) {
        await this.request("release", { id: item.id }, key); return;
      }
      if (sendNow && isChatBusy()) {
        const stop = findQueueStopButton();
        if (!stop) throw new Error("The current response cannot be stopped yet. The message remains queued.");
        composer.setAttribute("data-plannotator-queued-send", item.id);
        // The native control can reuse the last Send element for Stop. This
        // explicit owned action must not be mistaken for that send's late replay.
        this.nativeDispatch = true;
        try { stop.click(); } finally { this.nativeDispatch = false; composer.removeAttribute("data-plannotator-queued-send"); }
        const deadline = Date.now() + 7000;
        while (isChatBusy() && key === this.syncRoute() && !this.abort.signal.aborted && Date.now() < deadline) {
          await this.waitForDomChange(200);
        }
        if (isChatBusy()) throw new Error("The response is still stopping. The message remains queued.");
      }
      const ready = () => sendNow ? isCurrentConversationReady() : this.transcriptReady();
      composer = findQueueComposer();
      if (key !== this.syncRoute() || !composer || readComposer(composer).trim() || isChatBusy() ||
          !ready() || hasComposerAttachments()) {
        await this.request("release", { id: item.id }, key); return;
      }
      const before = new Set(getVisibleUserMessages().map(message => message.id));
      if (!writeComposer(composer, item.text)) throw new Error("Could not fill the composer. The message remains saved.");
      // Yield for the native composer commit, then wait only while Send is not
      // ready instead of adding a fixed delay to every queued message.
      await this.yieldComposerCommit();
      const composerDeadline = Date.now() + 1000;
      while (!findQueueSendButton() && Date.now() < composerDeadline && key === this.syncRoute() &&
          !this.abort.signal.aborted && !isChatBusy() && composer.isConnected && normalize(readComposer(composer)) === normalize(item.text)) {
        await this.waitForDomChange(100);
      }
      if (this.abort.signal.aborted || key !== this.syncRoute() || isChatBusy() || !composer.isConnected ||
          normalize(readComposer(composer)) !== normalize(item.text) || hasComposerAttachments() ||
          !findQueueSendButton() || !ready()) {
        throw new Error("The conversation changed before sending. The message remains saved.");
      }
      await this.request("attempt", { id: item.id }, key);
      attempted = true;
      // A suspended document can receive an old IPC reply after another tab
      // changed the queue. Refresh ownership and pause state before acting.
      await this.request("read", {}, key);
      this.render();
      const send = findQueueSendButton();
      const committed = this.state?.items.find(entry => entry.id === item!.id);
      const deadline = (committed?.attemptedAt ?? 0) + SEND_CONFIRM_MS;
      if (this.abort.signal.aborted || !send || key !== this.syncRoute() || isChatBusy() || !composer.isConnected ||
          normalize(readComposer(composer)) !== normalize(item.text) || hasComposerAttachments() || !ready() ||
          committed?.status !== "sending" || committed.owner !== item.owner ||
          (!sendNow && this.state?.paused) || Date.now() >= deadline) {
        throw new Error("Send was interrupted. Check the conversation before retrying.");
      }
      clicked = true;
      const rawDraft = readComposer(composer);
      const expectedComposer = composer;
      const expectedItem = item;
      this.nativeReplay.begin({ composer, button: send, form: send.form, expiresAt: deadline,
        isCurrent: () => this.dispatching && !this.abort.signal.aborted &&
          key === this.key && key === getQueueKey(location.href) &&
          this.state?.items.some(entry => entry.id === expectedItem.id && entry.status === "sending" && entry.owner === expectedItem.owner) === true &&
          (sendNow || !this.state?.paused) && findQueueComposer() === expectedComposer && findQueueSendButton() === send &&
          readComposer(expectedComposer) === rawDraft && !isChatBusy() && !hasComposerAttachments() && ready(),
      });
      this.nativeDispatch = true;
      composer.setAttribute("data-plannotator-queued-send", item.id);
      this.markDispatchAttempt();
      try { send.click(); } finally {
        this.nativeDispatch = false; this.nativeReplay.finishInitial();
        composer.removeAttribute("data-plannotator-queued-send");
      }
      while (!this.abort.signal.aborted && Date.now() < deadline && key === this.syncRoute()) {
        const posted = getVisibleUserMessages().find(message => !before.has(message.id) && normalize(message.text) === normalize(item!.text));
        if (posted) {
          this.temporaryAnchors.add(posted.id);
          postedUserMessageId = getStableUserMessageAnchor(posted.id) ?? posted.id;
          await this.request("ack", { id: item.id, userMessageId: postedUserMessageId }, key);
          this.markConfirmedSend(item.id);
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
            this.markConfirmedSend(item.id);
            this.error = ""; return;
          }
        } catch {
          // Another tab may already have completed this confirmed turn while
          // the sender's acknowledgement reply was lost. Require that exact
          // durable completion anchor before clearing the transport error.
          if (attempted && postedUserMessageId) {
            try {
              const result = await this.request("read", {}, key);
              if (!result.state.items.some(entry => entry.id === item!.id) &&
                  (result.state.lastCompletedUserMessageId === postedUserMessageId ||
                    result.state.lastCompletedUserMessageId === getStableUserMessageAnchor(postedUserMessageId))) {
                this.markConfirmedSend(item.id);
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
      this.nativeReplay.finish();
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
      case "retry": if (id) await this.retryItem(id); break;
      case "resolve": if (id) await this.change("remove", { id }); break;
      case "check": this.error = ""; this.lastPoll = 0; await this.tick(); break;
    }
  }

  private async retryItem(id: string): Promise<void> {
    if (this.saving || this.dispatching || this.editing || this.editingBusy) return;
    const key = this.syncRoute();
    const item = this.state?.items.find(entry => entry.id === id);
    if (!key || item?.status !== "review") return;
    const composer = findQueueComposer();
    const text = composer ? readComposer(composer) : "";
    const matchingDraft = Boolean(composer && text === item.text && !hasComposerAttachments());
    // A failed send can leave this exact queued text in the native editor.
    // Reuse its saved ID if clearing fails or the retry response is lost.
    if (matchingDraft) this.pendingSave = { id, key, text };
    this.saving = true; this.error = ""; this.render();
    try {
      const result = await this.request("retry", { id }, key);
      if (key !== this.syncRoute()) return;
      const retried = result.state.items.find(entry => entry.id === id);
      const current = this.state?.items.find(entry => entry.id === id);
      if (retried?.status !== "queued" || retried.text !== item.text || current?.status !== "queued" || current.text !== item.text) {
        throw new Error("This message changed while retrying. Your draft was kept.");
      }
      this.error = "";
      if (matchingDraft && composer?.isConnected && findQueueComposer() === composer &&
          readComposer(composer) === text && !hasComposerAttachments()) {
        if (writeComposer(composer, "")) this.pendingSave = null;
        else this.error = "Message is queued again. Clear the composer to continue.";
      }
    } catch (error) {
      if (key === this.syncRoute()) this.error = this.describe(error);
    } finally { this.saving = false; this.render(); this.scheduleTick(); }
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
    const hold = this.dispatchHold(composer);
    // DOM-only diagnostics make a stalled queue inspectable without exposing
    // message content, conversation IDs, ownership tokens, or stored drafts.
    const routeReady = Boolean(this.key && getQueueKey(location.href) === this.key);
    const workerBusy = Boolean(this.state?.busyUntil && this.state.busyUntil > Date.now());
    const diagnostic = !routeReady ? "route-unavailable" : this.dispatching ? "dispatching" :
      hold === "ready" && workerBusy ? "response-in-another-tab" : hold;
    if (this.host.dataset.queueState !== diagnostic) {
      this.host.dataset.queueState = diagnostic;
      this.host.dataset.queueStateSince = String(Date.now());
    }
    if (!["empty", "loading", "ready", "dispatching"].includes(diagnostic)) this.host.dataset.queueLastHold = diagnostic;
    this.host.dataset.queueRouteReady = String(routeReady);
    this.host.dataset.queueHasAnchor = String(Boolean(this.state?.lastCompletedUserMessageId));
    this.host.dataset.queueWorkerBusy = String(workerBusy);
    this.host.dataset.queueVisibility = document.visibilityState;
    const showAdd = Boolean(draft && (busy || allItems.length || this.state?.paused));
    const unknownAnchor = Boolean(this.state?.lastCompletedUserMessageId && !this.canUseAnchor(this.state.lastCompletedUserMessageId)) ||
      allItems.some(item => item.status === "waiting" && item.userMessageId && !this.canUseAnchor(item.userMessageId));
    const recovery = !this.error && !this.state?.paused && !busy && !this.dispatching && !this.saving && !this.editing &&
      !draft && getQueueKey(location.href) === this.key && items.some(item => item.status === "queued") &&
      allItems.every(item => item.status === "queued" || item.status === "waiting") && unknownAnchor && isCurrentConversationReady()
      ? "This older queue needs confirmation after reopening. Use Send now on the first message to continue." : "";
    // Put useful holds beside the next queued item. Routine busy/paused state
    // stays in the native response and Pause/Resume control, without a footer.
    const waiting = this.error || recovery || this.dispatching ? "" :
      hold === "draft" ? "Queue or clear your draft to continue." :
      hold === "attachments" ? "Send or remove your attachment to continue." :
      hold === "identity-unverified" ? "Reload after the response finishes to reconnect the queue." :
      !busy && (hold === "completion-pending" || hold === "waiting")
        ? `Waiting for ${getProviderName()} to confirm this response finished.` :
      hold === "transcript-loading" ? "Waiting for this conversation to finish loading." : "";
    if (!this.key || !composer || (!items.length && !showAdd && !this.error && !this.state?.paused)) {
      this.host.style.display = "none";
      this.panel.replaceChildren(); this.signature = "";
      return;
    }
    if (!this.host.isConnected) document.body.append(this.host);
    this.host.style.display = "block";
    const signature = JSON.stringify([items, this.state?.paused, showAdd, this.saving, this.editingBusy, this.dispatching, this.expanded, this.editing, this.error, recovery, waiting]);
    if (signature !== this.signature && !this.dragId && !this.pointerDrag) {
      this.signature = signature;
      this.panel.innerHTML = `<header>
        <button class="title" data-action="expand" aria-label="${this.expanded ? "Collapse" : "Expand"} message queue" aria-expanded="${this.expanded}">${icon(this.expanded ? "chevron-down" : "chevron-right", 14)}${items.length ? `Queue <span class="count">${items.length}</span>` : "Queue next message"}</button>
        ${items.length || this.state?.paused ? `<button data-action="pause" aria-label="${this.state?.paused ? "Resume" : "Pause"} queue">${icon(this.state?.paused ? "play" : "pause", 14)}${this.state?.paused ? "Resume" : "Pause"}</button>` : ""}
        ${showAdd ? `<button class="add" data-action="enqueue" ${this.saving || this.editingBusy ? "disabled" : ""}>${icon(this.saving || this.editingBusy ? "loader" : this.editing ? "check" : "plus", 14)}${this.saving || this.editingBusy ? "Saving…" : this.editing ? "Save edit" : "Queue message"}</button>` : ""}
      </header>
      ${this.expanded && items.length ? `<ol>${items.map((item, index) => this.itemHtml(item, index, index === items.findIndex(entry => entry.status === "queued") ? waiting : "")).join("")}</ol>` : ""}
      ${this.error ? `<div class="error" role="status">${escapeHtml(this.error)} <button data-action="check">Check again</button></div>` :
        recovery ? `<div class="error" role="status">${recovery}</div>` : ""}`;
    }
    this.position();
  }

  private itemHtml(item: QueueItem, index: number, waiting = ""): string {
    const id = escapeHtml(item.id);
    if (this.editing === item.id) return `<li data-id="${id}"><span class="order-slot"><span class="num">${index + 1}</span></span><div class="body"><div class="text">${escapeHtml(item.text)}</div><div class="status">Editing in composer · position reserved</div><div class="edit-tools"><button class="add" data-action="save" ${this.editingBusy ? "disabled" : ""}>Save edit</button><button data-action="cancel-edit" ${this.editingBusy ? "disabled" : ""}>Cancel edit</button></div></div><div class="tools"><button data-action="remove" aria-label="Remove message ${index + 1}" title="Delete queued message" ${this.editingBusy ? "disabled" : ""}>${icon("trash")}</button></div></li>`;
    const pending = item.status === "queued";
    const blocked = Boolean(this.editing || this.saving || this.dispatching || this.state?.items.some(entry => ["editing", "claimed", "sending", "review"].includes(entry.status)));
    const status = item.status === "editing" ? "Editing in a composer · position reserved" : item.status === "claimed" ? "Preparing…" : item.status === "sending" ? "Confirming send…" : item.status === "review" ? "Send unconfirmed · check this chat before retrying" : waiting;
    const order = pending ? `<button class="order-slot drag-handle" draggable="true" aria-label="Reorder message ${index + 1}" title="Drag to reorder; use arrow keys when focused"><span class="num" aria-hidden="true">${index + 1}</span>${grip}</button>` : `<span class="order-slot"><span class="num">${index + 1}</span></span>`;
    return `<li data-id="${id}" data-user-message-id="${escapeHtml(item.userMessageId ?? "")}">${order}<div class="body"><div class="text">${escapeHtml(item.text)}</div>${status ? `<div class="status ${item.status === "review" ? "review" : ""}">${status}</div>` : ""}
      ${item.status === "review" ? `<div class="edit-tools"><button data-action="retry" title="Retry only after checking that it was not sent" ${this.saving || this.dispatching || this.editing || this.editingBusy ? "disabled" : ""}>Retry message</button><button data-action="resolve">Dismiss from queue</button></div>` : ""}</div>
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

const runtime = getExtensionApi()?.runtime;
if (window.top === window && runtime?.sendMessage) new MessageQueue(runtime).start();

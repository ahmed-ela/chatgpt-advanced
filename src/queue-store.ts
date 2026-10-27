import { EncryptedRecordStore } from "./encrypted-storage";
import type { ConversationAlias } from "./chatgpt-dom";

/** Persistent per-conversation queue. Changes use strictly durable encrypted compare-and-swap commits. */
export const QUEUE_MESSAGE_TYPE = "plannotator:queue";
export const QUEUE_CHANGED_TYPE = "plannotator:queue:changed";
export const QUEUE_CLAIM_MS = 10_000;
export const QUEUE_EDIT_MS = 30_000;
export const QUEUE_SEND_TIMEOUT_MS = 30_000;
export const QUEUE_BUSY_MS = 3_000;
export const QUEUE_MAX_TEXT = 200_000;
export const QUEUE_MAX_ITEMS = 100;
export const QUEUE_MAX_DRAFTS = 20;
const MAX_CONVERSATION_ALIASES = 16;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QueueStatus = "queued" | "editing" | "claimed" | "sending" | "waiting" | "review";
export interface QueueItem {
  id: string;
  text: string;
  createdAt: number;
  status: QueueStatus;
  owner?: string;
  leaseUntil?: number;
  attemptedAt?: number;
  userMessageId?: string;
  reason?: string;
  editToken?: string;
  lastEditToken?: string;
  sendNow?: boolean;
}
/** Recoverable composer text while a queued send temporarily borrows its editor. */
export interface QueueDraft {
  id: string;
  text: string;
  revision: number;
  updatedAt: number;
}
export interface QueueState {
  key: string;
  revision: number;
  paused: boolean;
  items: QueueItem[];
  busyUntil?: number;
  /** Required completed-reply anchor; may start with the currently generating turn. */
  lastCompletedUserMessageId?: string;
  /** Exact first-send identity witnesses; never inferred from a queue anchor. */
  conversationAliases?: ConversationAlias[];
  drafts?: QueueDraft[];
}
export type QueueAction = "read" | "bind-conversation" | "draft-save" | "draft-remove" | "enqueue" | "begin-edit" | "edit-heartbeat" | "cancel-edit" | "steer" | "edit" | "move" | "remove" | "pause" | "heartbeat" | "claim" | "attempt" | "ack" | "anchor" | "complete" | "release" | "review" | "retry";
export interface QueueRequest {
  type: typeof QUEUE_MESSAGE_TYPE;
  key: string;
  clientId: string;
  action: QueueAction;
  id?: string;
  text?: string;
  delta?: number;
  paused?: boolean;
  busy?: boolean;
  userMessageId?: string;
  afterUserMessageId?: string;
  reason?: string;
  editToken?: string;
  conversationAlias?: ConversationAlias;
  draftRevision?: number;
}
export type QueueResponse = { ok: true; state: QueueState; claimed?: QueueItem } | { ok: false; error: string };
interface StoredQueue extends QueueState {
  retiredIds?: string[];
  editReceipts?: Array<{ id: string; editToken: string; text: string }>;
  busyLeases?: Array<{ owner: string; until: number }>;
  legacyBusyUntil?: number;
  removedDraftRevisions?: Array<{ id: string; revision: number }>;
}
export interface QueueResult { state: QueueState; claimed?: QueueItem; changed: boolean }

export function isValidConversationAlias(value: unknown): value is ConversationAlias {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const alias = value as Partial<ConversationAlias>;
  return typeof alias.routeKey === "string" && alias.routeKey.startsWith("chatgpt:") && UUID_PATTERN.test(alias.routeKey.slice("chatgpt:".length)) &&
    typeof alias.localId === "string" && alias.localId.startsWith("local-chatgpt:") && UUID_PATTERN.test(alias.localId.slice("local-chatgpt:".length)) &&
    typeof alias.firstUserId === "string" && UUID_PATTERN.test(alias.firstUserId);
}

function conflictingConversationAlias(a: ConversationAlias, b: ConversationAlias): boolean {
  return (a.localId === b.localId && (a.routeKey !== b.routeKey || a.firstUserId !== b.firstUserId)) ||
    (a.firstUserId === b.firstUserId && a.routeKey !== b.routeKey);
}

function validateStoredConversationAliases(state: StoredQueue): void {
  if (state.conversationAliases === undefined) return;
  const aliases = state.conversationAliases;
  if (!Array.isArray(aliases) || aliases.length > MAX_CONVERSATION_ALIASES ||
      aliases.some(alias => !isValidConversationAlias(alias) || alias.routeKey !== state.key) ||
      aliases.some((alias, index) => aliases.slice(0, index).some(previous => conflictingConversationAlias(alias, previous)))) {
    throw new Error("Stored conversation identity is invalid. Existing queue data has been preserved.");
  }
}

function validDraftId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function validDraftRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validateStoredDrafts(state: StoredQueue): void {
  const drafts = state.drafts;
  const removed = state.removedDraftRevisions;
  if ((drafts !== undefined && (!Array.isArray(drafts) || drafts.length > QUEUE_MAX_DRAFTS ||
      drafts.some(draft => !draft || typeof draft !== "object" || Array.isArray(draft) ||
        !validDraftId(draft.id) || typeof draft.text !== "string" || draft.text.length > QUEUE_MAX_TEXT ||
        !validDraftRevision(draft.revision) || !Number.isSafeInteger(draft.updatedAt) || draft.updatedAt < 0) ||
      new Set(drafts.map(draft => draft.id)).size !== drafts.length)) ||
      (removed !== undefined && (!Array.isArray(removed) || removed.some(receipt => !receipt || typeof receipt !== "object" ||
        Array.isArray(receipt) || !validDraftId(receipt.id) || !validDraftRevision(receipt.revision)) ||
        new Set(removed.map(receipt => receipt.id)).size !== removed.length ||
        drafts?.some(draft => removed.some(receipt => receipt.id === draft.id && receipt.revision >= draft.revision))))) {
    throw new Error("Stored composer drafts are invalid. Existing queue data has been preserved.");
  }
}

/** New unsaved chats have no stable key. Local URLs are supported for the extension's fixtures. */
export function getQueueKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol === "https:" && parsed.hostname === "chatgpt.com") {
      const match = parsed.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)(?:\/|$)/);
      return match ? `chatgpt:${match[1]}` : null;
    }
    if (parsed.origin === "https://claude.ai") {
      const match = parsed.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,128})\/?$/);
      return match ? `claude:${match[1]}` : null;
    }
    if (parsed.origin === "https://gemini.google.com") {
      const match = parsed.pathname.match(/^\/app\/([A-Za-z0-9_-]{1,128})\/?$/);
      return match ? `gemini:${match[1]}` : null;
    }
    if (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return `fixture:${parsed.origin}${parsed.pathname}`;
    }
  } catch { /* Invalid or no longer available tab URL. */ }
  return null;
}

export class QueueStore {
  private readonly storage: EncryptedRecordStore<StoredQueue>;
  constructor(factory: IDBFactory = indexedDB, name = "plannotator-message-queue-v1") {
    this.storage = new EncryptedRecordStore(factory, name, "queues");
  }

  close(): Promise<void> { return this.storage.close(); }

  async apply(request: QueueRequest, owner: string, now = Date.now()): Promise<QueueResult> {
    validateRequest(request);
    if (!owner || owner.length > 256) throw new Error("Invalid queue client");
    return this.storage.apply(request.key,
      () => ({ key: request.key, revision: 0, paused: false, items: [], busyLeases: [] }),
      state => {
        validateStoredConversationAliases(state);
        validateStoredDrafts(state);
        const before = JSON.stringify(state);
        recover(state, now);
        const claimed = mutate(state, request, owner, now);
        const changed = JSON.stringify(state) !== before;
        if (changed) state.revision += 1;
        // Receipts and per-tab busy ownership stay private to the worker.
        const { retiredIds: _retiredIds, removedDraftRevisions: _removedDraftRevisions, editReceipts: _editReceipts,
          busyLeases: _busyLeases, legacyBusyUntil: _legacyBusyUntil, ...visible } = state;
        const result: QueueResult = { state: structuredClone(visible), changed,
          ...(claimed ? { claimed: structuredClone(claimed) } : {}) };
        return { value: state, result, changed };
      });
  }
}

function validateRequest(request: QueueRequest): void {
  if (!request || request.type !== QUEUE_MESSAGE_TYPE || typeof request.key !== "string" || request.key.length > 2_048 || !/^(chatgpt|claude|gemini|fixture):/.test(request.key)) throw new Error("Invalid queue conversation");
  if (typeof request.clientId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.clientId)) throw new Error("Invalid queue client");
  if (!["read", "bind-conversation", "draft-save", "draft-remove", "enqueue", "begin-edit", "edit-heartbeat", "cancel-edit", "steer", "edit", "move", "remove", "pause", "heartbeat", "claim", "attempt", "ack", "anchor", "complete", "release", "review", "retry"].includes(request.action)) throw new Error("Unknown queue action");
  if (request.conversationAlias !== undefined && (!isValidConversationAlias(request.conversationAlias) || request.conversationAlias.routeKey !== request.key)) throw new Error("Invalid conversation identity witness");
  if (request.action === "bind-conversation" && !request.conversationAlias) throw new Error("Missing conversation identity witness");
  if (request.id !== undefined && (typeof request.id !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.id))) throw new Error("Invalid queued message ID");
  if (request.editToken !== undefined && (typeof request.editToken !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(request.editToken))) throw new Error("Invalid queue edit token");
  if (["begin-edit", "edit-heartbeat", "cancel-edit"].includes(request.action) && !request.editToken) throw new Error("Missing queue edit token");
  if (request.afterUserMessageId !== undefined && (typeof request.afterUserMessageId !== "string" || !request.afterUserMessageId || request.afterUserMessageId.length > 256)) throw new Error("Invalid queue transcript anchor");
  if (["enqueue", "edit"].includes(request.action) && (typeof request.text !== "string" || !request.text.trim() || request.text.length > QUEUE_MAX_TEXT)) throw new Error(`Queued messages must contain 1–${QUEUE_MAX_TEXT.toLocaleString()} characters`);
  if (["draft-save", "draft-remove"].includes(request.action) && (!validDraftId(request.id) || !validDraftRevision(request.draftRevision))) throw new Error("Invalid composer draft ID or revision");
  if (request.action === "draft-save" && (typeof request.text !== "string" || request.text.length > QUEUE_MAX_TEXT)) throw new Error(`Composer drafts must contain at most ${QUEUE_MAX_TEXT.toLocaleString()} characters`);
}

function recover(state: StoredQueue, now: number): void {
  // A cleared buffer is a retired revision, not a recoverable draft. Older
  // builds could leave an empty journal entry if their final cleanup was
  // interrupted. Migrate it in this same durable CAS transaction; retaining
  // the receipt prevents an older delayed save from resurrecting its text.
  for (const draft of state.drafts ?? []) {
    if (draft.text === "") retireDraft(state, draft.id, draft.revision);
  }
  for (const item of state.items) {
    if (item.status === "editing" && (item.leaseUntil ?? 0) <= now) {
      resetToQueued(item);
      // The native-composer draft may have disappeared with its tab. Keep the
      // original queued text and require an explicit resume before sending it.
      state.paused = true;
    }
    if (item.status === "claimed" && (item.leaseUntil ?? 0) <= now) resetToQueued(item);
    if (item.status === "sending" && (item.attemptedAt ?? 0) + QUEUE_SEND_TIMEOUT_MS <= now) {
      item.status = "review";
      item.reason = "Delivery could not be confirmed. Check the chat before retrying to avoid a duplicate.";
      delete item.leaseUntil;
    }
  }
  refreshBusyUntil(state, now);
}

function retireDraft(state: StoredQueue, id: string, revision: number): void {
  state.drafts = (state.drafts ?? []).filter(draft => draft.id !== id || draft.revision > revision);
  const previous = state.removedDraftRevisions?.find(receipt => receipt.id === id);
  state.removedDraftRevisions = [...(state.removedDraftRevisions ?? []).filter(receipt => receipt.id !== id),
    { id, revision: Math.max(previous?.revision ?? 0, revision) }];
}

function refreshBusyUntil(state: StoredQueue, now: number): void {
  if (!state.busyLeases) {
    // Older documents did not identify the tab that observed generation.
    // Preserve that evidence until its original deadline; no tab may clear it.
    if ((state.busyUntil ?? 0) > now) {
      state.legacyBusyUntil = Math.max(state.legacyBusyUntil ?? 0, state.busyUntil!);
    }
    state.busyLeases = [];
  }
  state.busyLeases = state.busyLeases.filter((lease) => lease.until > now);
  if ((state.legacyBusyUntil ?? 0) <= now) delete state.legacyBusyUntil;
  const until = state.busyLeases.reduce((latest, lease) => Math.max(latest, lease.until), state.legacyBusyUntil ?? 0);
  if (until > now) state.busyUntil = until;
  else delete state.busyUntil;
}

function mutate(state: StoredQueue, request: QueueRequest, owner: string, now: number): QueueItem | undefined {
  const item = state.items.find((entry) => entry.id === request.id);
  const requireItem = (): QueueItem => {
    if (!item) throw new Error("This queued message is no longer available");
    return item;
  };
  const owned = (status: QueueStatus): QueueItem => {
    const current = requireItem();
    if (current.status !== status || current.owner !== owner) throw new Error("This queued message is being handled by another tab or has changed");
    return current;
  };
  const ownedEdit = (): QueueItem => {
    const current = owned("editing");
    if (current.editToken !== request.editToken) throw new Error("This edit session has changed; reopen the queued message");
    return current;
  };
  switch (request.action) {
    case "read": return;
    case "draft-save": {
      // An old retry must not resurrect text already recovered. Newer typing
      // may still arrive after removal and must survive that cross-tab race.
      const removed = state.removedDraftRevisions?.find(receipt => receipt.id === request.id);
      if (removed && request.draftRevision! <= removed.revision) return;
      const drafts = state.drafts ?? [];
      const current = drafts.find(draft => draft.id === request.id);
      if (current && request.draftRevision! < current.revision) return;
      if (current && request.draftRevision === current.revision) {
        if (request.text !== current.text) throw new Error("Composer draft revision conflicts with saved text");
        return;
      }
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid composer draft timestamp");
      if (request.text === "") {
        // Empty focused inputs and a buffer cleared after enqueue need no
        // recovery slot. Record retirement even when no draft existed yet,
        // and before enforcing the nonempty-draft capacity limit.
        retireDraft(state, request.id!, request.draftRevision!);
        return;
      }
      if (!current && drafts.length >= QUEUE_MAX_DRAFTS) throw new Error(`Saved composer drafts are full (${QUEUE_MAX_DRAFTS}); recover an existing draft before sending`);
      const next = { id: request.id!, text: request.text!, revision: request.draftRevision!, updatedAt: now };
      state.drafts = current ? drafts.map(draft => draft.id === current.id ? next : draft) : [...drafts, next];
      return;
    }
    case "draft-remove": {
      const current = state.drafts?.find(draft => draft.id === request.id);
      if (!current || current.revision !== request.draftRevision) return;
      retireDraft(state, current.id, current.revision);
      return;
    }
    case "bind-conversation": {
      const alias = request.conversationAlias!;
      const aliases = state.conversationAliases ?? [];
      if (aliases.some(previous => conflictingConversationAlias(previous, alias))) throw new Error("Conversation identity witness conflicts with an existing binding");
      if (aliases.some(previous => previous.routeKey === alias.routeKey && previous.localId === alias.localId && previous.firstUserId === alias.firstUserId)) return;
      state.conversationAliases = [...aliases, { routeKey: alias.routeKey, localId: alias.localId, firstUserId: alias.firstUserId }].slice(-MAX_CONVERSATION_ALIASES);
      return;
    }
    case "heartbeat": {
      // Each document clears only its own evidence as soon as its response
      // finishes; a stale idle tab cannot override another document's lease.
      if (request.busy === true || request.busy === false) {
        const previous = state.busyLeases!.find((lease) => lease.owner === owner);
        state.busyLeases = state.busyLeases!.filter((lease) => lease.owner !== owner);
        if (request.busy) state.busyLeases.push({ owner, until: Math.max(previous?.until ?? 0, now + QUEUE_BUSY_MS) });
        refreshBusyUntil(state, now);
      }
      return;
    }
    case "enqueue":
      if (!request.id) throw new Error("Missing queued message ID");
      // Idempotency survives lost responses, worker restarts, deletion, and completion.
      if (item || state.retiredIds?.includes(request.id)) return;
      if (state.items.length >= QUEUE_MAX_ITEMS) throw new Error(`Queue is full (${QUEUE_MAX_ITEMS} messages)`);
      // A new explicit batch follows the current turn selected by the user,
      // including a still-generating response that every sending tab must see finish.
      // Never reset this anchor for a retry or while any queued work remains.
      if (state.items.length === 0) {
        if (request.afterUserMessageId) state.lastCompletedUserMessageId = request.afterUserMessageId;
        else delete state.lastCompletedUserMessageId;
      }
      state.items.push({ id: request.id, text: request.text!, createdAt: now, status: "queued" });
      return;
    case "pause":
      if (typeof request.paused !== "boolean") throw new Error("Invalid queue pause state");
      state.paused = request.paused;
      // A pre-send claim can be cancelled; an attempted send remains visible.
      if (state.paused) for (const entry of state.items) if (entry.status === "claimed") resetToQueued(entry);
      return;
    case "begin-edit": {
      const current = requireItem();
      if (current.status === "editing" && current.owner === owner && current.editToken === request.editToken) {
        current.leaseUntil = now + QUEUE_EDIT_MS;
        return;
      }
      if (current.status !== "queued") throw new Error("Only queued messages can be edited");
      current.status = "editing";
      current.owner = owner;
      current.editToken = request.editToken;
      current.leaseUntil = now + QUEUE_EDIT_MS;
      return;
    }
    case "edit-heartbeat": {
      ownedEdit().leaseUntil = now + QUEUE_EDIT_MS;
      return;
    }
    case "cancel-edit": {
      resetToQueued(ownedEdit());
      return;
    }
    case "edit": {
      // A lost save response can be retried after another tab has already sent
      // or retired this item. Recognize only the exact committed text and token.
      if (!item && request.editToken && state.editReceipts?.some((receipt) =>
        receipt.id === request.id && receipt.editToken === request.editToken && receipt.text === request.text,
      )) return;
      const current = requireItem();
      if (current.status !== "editing" && request.editToken && current.lastEditToken === request.editToken && current.text === request.text) return;
      if (current.status === "editing") {
        ownedEdit();
        current.text = request.text!;
        current.lastEditToken = request.editToken;
        resetToQueued(current);
        return;
      }
      if (current.status !== "queued") throw new Error("Only queued messages can be edited");
      if (request.editToken) throw new Error("This edit session has expired or changed; reopen the queued message");
      // Preserve the original token-free edit API for simple queue clients.
      current.text = request.text!;
      delete current.lastEditToken;
      return;
    }
    case "move": {
      const current = requireItem();
      if (current.status !== "queued") throw new Error("Only queued messages can be reordered");
      if (!Number.isInteger(request.delta) || !request.delta || Math.abs(request.delta) > QUEUE_MAX_ITEMS) throw new Error("Invalid queue move");
      const index = state.items.indexOf(current);
      // Queue UI can move pending messages without moving an in-flight barrier.
      const target = Math.max(0, Math.min(state.items.length - 1, index + request.delta));
      if (state.items.slice(Math.min(index, target), Math.max(index, target) + 1).some((entry) => entry.status !== "queued")) throw new Error("Cannot move past a message that is already being sent");
      state.items.splice(index, 1);
      state.items.splice(target, 0, current);
      return;
    }
    case "remove": {
      if (!item) return;
      if (item.status === "editing") {
        if (item.owner !== owner) throw new Error("Another tab is editing this queued message");
      } else if (!["queued", "review"].includes(item.status)) throw new Error("Wait for this message's delivery status before removing it");
      retire(state, item);
      return;
    }
    case "claim": {
      // A stale same-chat tab must load the last queued reply before sending the next prompt.
      if (state.lastCompletedUserMessageId && request.afterUserMessageId !== state.lastCompletedUserMessageId) return;
      if (state.paused || (state.busyUntil ?? 0) > now || state.items.some((entry) => entry.status !== "queued")) return;
      const next = state.items[0];
      if (!next) return;
      next.status = "claimed";
      next.owner = owner;
      next.leaseUntil = now + QUEUE_CLAIM_MS;
      return next;
    }
    case "steer": {
      const current = requireItem();
      if (current.status !== "queued" || state.items.some((entry) => !["queued", "waiting"].includes(entry.status))) {
        throw new Error("Wait for the active send or edit to finish before sending this message now");
      }
      state.items.splice(state.items.indexOf(current), 1);
      const lastWaiting = state.items.reduce((index, entry, next) => entry.status === "waiting" ? next : index, -1);
      state.items.splice(lastWaiting + 1, 0, current);
      current.status = "claimed";
      current.owner = owner;
      current.leaseUntil = now + QUEUE_CLAIM_MS;
      current.sendNow = true;
      return current;
    }
    case "attempt": {
      const current = owned("claimed");
      if (current.sendNow) {
        // Explicit Send now interrupts the prior response. Its already-sent
        // queue row is retired only together with the durable new attempt.
        for (const previous of state.items.filter((entry) => entry.status === "waiting")) retire(state, previous);
        delete state.lastCompletedUserMessageId;
      } else if (state.paused || (state.busyUntil ?? 0) > now) throw new Error("ChatGPT became busy or the queue was paused");
      current.status = "sending";
      current.attemptedAt = now;
      current.leaseUntil = now + QUEUE_SEND_TIMEOUT_MS;
      return;
    }
    case "ack": {
      const current = requireItem();
      if (current.owner !== owner || !["sending", "review", "waiting"].includes(current.status)) throw new Error("This message's delivery cannot be acknowledged by this tab");
      if (typeof request.userMessageId !== "string" || !request.userMessageId || request.userMessageId.length > 256) throw new Error("Missing confirmed ChatGPT message ID");
      if (current.status === "waiting" && current.userMessageId !== request.userMessageId) throw new Error("Conflicting ChatGPT message ID");
      current.status = "waiting";
      current.userMessageId = request.userMessageId;
      delete current.leaseUntil;
      delete current.reason;
      return;
    }
    case "anchor": {
      // Only the exact indexed Gemini identity may be promoted to the server
      // turn observed around that same user bubble. A racing/newer anchor wins.
      if (!request.key.startsWith("gemini:") ||
          typeof request.userMessageId !== "string" ||
          !/^gemini:user:user-query-content-\d+:[a-z0-9]+$/.test(request.userMessageId ?? "") ||
          !/^gemini:user:[0-9a-f]{16}$/i.test(request.afterUserMessageId ?? "")) throw new Error("Invalid Gemini transcript anchor promotion");
      if (request.id) {
        if (item?.status === "waiting" && item.userMessageId === request.userMessageId) item.userMessageId = request.afterUserMessageId;
      } else if (state.lastCompletedUserMessageId === request.userMessageId) {
        state.lastCompletedUserMessageId = request.afterUserMessageId;
      }
      return;
    }
    case "complete": {
      if (!item) return;
      if (item.status !== "waiting") throw new Error("Delivery must be confirmed before completing a queued message");
      if (request.userMessageId !== undefined && request.userMessageId !== item.userMessageId) throw new Error("ChatGPT message ID does not match");
      state.lastCompletedUserMessageId = item.userMessageId;
      retire(state, item);
      return;
    }
    case "release": {
      if (!item) return;
      resetToQueued(owned("claimed"));
      return;
    }
    case "review": {
      const current = requireItem();
      if (current.owner !== owner) throw new Error("This send attempt belongs to another tab or has changed");
      // The ack may have committed even when its response was lost. An
      // automatic error handler must never turn known delivery into a retry.
      if (current.status === "waiting") return;
      if (!["sending", "review"].includes(current.status)) throw new Error("This message has not been sent yet");
      current.status = "review";
      current.reason = typeof request.reason === "string" ? request.reason.slice(0, 1_000) : "Check whether this message was delivered before retrying.";
      delete current.leaseUntil;
      return;
    }
    case "retry": {
      const current = requireItem();
      if (current.status !== "review") throw new Error("Only messages needing review can be retried");
      resetToQueued(current);
      return;
    }
  }
}

function resetToQueued(item: QueueItem): void {
  item.status = "queued";
  delete item.owner;
  delete item.leaseUntil;
  delete item.attemptedAt;
  delete item.userMessageId;
  delete item.reason;
  delete item.editToken;
  delete item.sendNow;
}

function retire(state: StoredQueue, item: QueueItem): void {
  if (item.lastEditToken) {
    state.editReceipts = [
      ...(state.editReceipts ?? []),
      { id: item.id, editToken: item.lastEditToken, text: item.text },
    ].slice(-20);
  }
  state.items.splice(state.items.indexOf(item), 1);
  state.retiredIds = [...(state.retiredIds ?? []), item.id].slice(-1_000);
}

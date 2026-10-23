import { EncryptedRecordStore } from "./encrypted-storage";
import { getQueueKey } from "./queue-store";

export const ANNOTATION_MESSAGE_TYPE = "plannotator:annotations";
export const ANNOTATION_CHANGED_TYPE = "plannotator:annotations:changed";
export const ANNOTATION_MAX_NOTES = 500;
export const ANNOTATION_MAX_TEXT = 200_000;
export const ANNOTATION_MAX_TOMBSTONES = 2_000;
const MAX_DOCUMENT_TEXT = 8_000_000;

export interface PersistedNoteItem {
  id: string;
  messageId: string;
  messageExcerpt: string;
  quote: string;
  comment: string;
  contextBefore: string;
  contextAfter: string;
  startOffset?: number;
  endOffset?: number;
  createdAt: number;
}
export interface AnnotationRequest {
  type: typeof ANNOTATION_MESSAGE_TYPE;
  key: string;
  action: "read" | "upsert" | "remove" | "import" | "consume";
  notes?: PersistedNoteItem[];
  ids?: string[];
}
export type AnnotationResponse = { ok: true; notes: PersistedNoteItem[]; revision: number } | { ok: false; error: string };
export interface AnnotationResult { notes: PersistedNoteItem[]; revision: number; changed: boolean }

/** Compare the exact transferred revision, including its selection identity. */
export function sameAnnotationNote(left: PersistedNoteItem | undefined, right: PersistedNoteItem): boolean {
  return Boolean(left && (["id", "messageId", "messageExcerpt", "quote", "comment", "contextBefore", "contextAfter", "startOffset", "endOffset", "createdAt"] as const)
    .every(field => left[field] === right[field]));
}
interface StoredAnnotations {
  key: string;
  revision: number;
  notes: PersistedNoteItem[];
  tombstones: Array<{ id: string; createdAt: number }>;
  /** Compacted deletions still prohibit an old draft or legacy copy from reappearing. */
  retiredBefore?: number;
}

/** Only saved provider conversations have durable annotation identities. */
export function getAnnotationKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    // getQueueKey preserves an older ChatGPT route contract; annotations also
    // require the exact permitted origin so an alternate port cannot share data.
    if (parsed.hostname === "chatgpt.com" && parsed.origin !== "https://chatgpt.com") return null;
    return getQueueKey(url);
  } catch { return null; }
}

/** The worker owns this database; content scripts never open provider-origin storage. */
export class AnnotationStore {
  private readonly storage: EncryptedRecordStore<StoredAnnotations>;
  constructor(factory: IDBFactory = indexedDB, name = "plannotator-annotations-v1") {
    this.storage = new EncryptedRecordStore(factory, name, "annotations");
  }

  close(): Promise<void> { return this.storage.close(); }

  async apply(request: AnnotationRequest, now = Date.now()): Promise<AnnotationResult> {
    const input = validateRequest(request);
    return this.storage.apply(input.key,
      () => ({ key: input.key, revision: 0, notes: [], tombstones: [] }),
      state => {
        const before = JSON.stringify(state);
        mutate(state, input, now);
        const changed = JSON.stringify(state) !== before;
        if (changed) {
          if (state.notes.length > ANNOTATION_MAX_NOTES || JSON.stringify(state.notes).length > MAX_DOCUMENT_TEXT) {
            throw new Error("This conversation has reached its annotation storage limit. Remove some notes and retry.");
          }
          state.revision++;
        }
        const result = { notes: structuredClone(state.notes), revision: state.revision, changed };
        return { value: state, result, changed };
      });
  }
}

function validId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(id);
}

function validateRequest(request: AnnotationRequest): AnnotationRequest {
  if (!request || request.type !== ANNOTATION_MESSAGE_TYPE || typeof request.key !== "string" || request.key.length > 2_048 || !/^(chatgpt|claude|gemini|fixture):.+$/.test(request.key)) throw new Error("Invalid annotation conversation");
  if (!["read", "upsert", "remove", "import", "consume"].includes(request.action)) throw new Error("Unknown annotation action");
  if (request.action === "read") return { type: request.type, key: request.key, action: request.action };
  if (request.action === "remove") {
    if (!Array.isArray(request.ids) || request.ids.length > ANNOTATION_MAX_NOTES || !request.ids.every(validId)) throw new Error("Invalid annotation IDs");
    return { type: request.type, key: request.key, action: request.action, ids: [...new Set(request.ids)] };
  }
  if (!Array.isArray(request.notes) || request.notes.length > ANNOTATION_MAX_NOTES) throw new Error("Invalid annotation notes");
  const notes = request.notes.map(cleanNote);
  if (new Set(notes.map(note => note.id)).size !== notes.length) throw new Error("Duplicate annotation IDs");
  if (JSON.stringify(notes).length > MAX_DOCUMENT_TEXT) throw new Error("These annotations are too large to save in one request");
  return { type: request.type, key: request.key, action: request.action, notes };
}

function cleanNote(note: PersistedNoteItem): PersistedNoteItem {
  if (!note || !validId(note.id) || typeof note.messageId !== "string" || !note.messageId || note.messageId.length > 512) throw new Error("Invalid annotation identity");
  for (const field of ["messageExcerpt", "quote", "comment", "contextBefore", "contextAfter"] as const) {
    if (typeof note[field] !== "string" || note[field].length > ANNOTATION_MAX_TEXT) throw new Error(`Annotation ${field} must contain at most ${ANNOTATION_MAX_TEXT.toLocaleString()} characters`);
  }
  if (!Number.isFinite(note.createdAt) || note.createdAt < 0) throw new Error("Invalid annotation creation time");
  for (const offset of [note.startOffset, note.endOffset]) {
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) throw new Error("Invalid annotation selection offset");
  }
  if (note.startOffset !== undefined && note.endOffset !== undefined && note.startOffset > note.endOffset) throw new Error("Invalid annotation selection range");
  // Persist only the defined text fields, never DOM objects or extra data.
  return { id: note.id, messageId: note.messageId, messageExcerpt: note.messageExcerpt,
    quote: note.quote, comment: note.comment, contextBefore: note.contextBefore, contextAfter: note.contextAfter,
    ...(note.startOffset !== undefined ? { startOffset: note.startOffset } : {}),
    ...(note.endOffset !== undefined ? { endOffset: note.endOffset } : {}), createdAt: note.createdAt };
}

function mutate(state: StoredAnnotations, request: AnnotationRequest, now: number): void {
  if (request.action === "read") return;
  if (request.action === "consume") {
    for (const expected of request.notes!) {
      const current = state.notes.find(note => note.id === expected.id);
      // Another tab's newer edit was not part of this transferred prompt.
      if (current && !sameAnnotationNote(current, expected)) continue;
      retireAnnotation(state, expected.id, expected.createdAt);
    }
    return;
  }
  if (request.action === "remove") {
    for (const id of request.ids!) {
      const note = state.notes.find(entry => entry.id === id);
      retireAnnotation(state, id, note?.createdAt ?? now);
    }
    return;
  }
  for (const note of request.notes!) {
    const index = state.notes.findIndex(entry => entry.id === note.id);
    if (request.action === "import" && (index >= 0 || state.tombstones.some(entry => entry.id === note.id))) continue;
    if (state.tombstones.some(entry => entry.id === note.id)) throw new Error("This annotation was removed in another tab. Create a new note to restore it.");
    if (index < 0 && state.retiredBefore !== undefined && note.createdAt <= state.retiredBefore) {
      // Do not silently discard an unrecognized old note during migration. The
      // caller retains its legacy copy/pending save because the transaction fails.
      throw new Error("These older annotations may have been deleted. Keep their source copy and create a new note to restore them.");
    }
    if (index < 0) state.notes.push(note);
    else state.notes[index] = note;
  }
}

function retireAnnotation(state: StoredAnnotations, id: string, createdAt: number): void {
  state.notes = state.notes.filter(entry => entry.id !== id);
  if (!state.tombstones.some(entry => entry.id === id)) state.tombstones.push({ id, createdAt });
  while (state.tombstones.length > ANNOTATION_MAX_TOMBSTONES) {
    const retired = state.tombstones.shift()!;
    state.retiredBefore = Math.max(state.retiredBefore ?? 0, retired.createdAt);
  }
}

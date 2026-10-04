import {
  findQueueComposer, readComposer, writeComposer, findQueueSendButton, isChatBusy, hasComposerAttachments,
  getAssistantMessageElements, findAssistantMessageElement, getAssistantMessageId, getProviderName,
} from "./chatgpt-dom";
import { icon } from "./icons";
import { getExtensionApi, type ExtensionRuntime } from "./browser-api";
import { ANNOTATION_MESSAGE_TYPE, ANNOTATION_CHANGED_TYPE, getAnnotationKey } from "./annotation-store";

type ComposerElement = HTMLTextAreaElement | HTMLElement;
type NoteSide = "left" | "right";
type ActionFeedbackState = "idle" | "loading" | "inserted";

declare const __PLANNOTATOR_DEV__: boolean;
declare const __PLANNOTATOR_BUILD_ID__: string;
declare const __PLANNOTATOR_DEV_ORIGIN__: string;

interface SelectionDraft {
  messageId: string;
  quote: string;
  range: StaticRange | Range;
  messageExcerpt: string;
  contextBefore: string;
  contextAfter: string;
  startOffset: number;
  endOffset: number;
  rect: DOMRect;
}

interface NoteItem {
  id: string;
  messageId: string;
  messageExcerpt: string;
  quote: string;
  comment: string;
  contextBefore: string;
  contextAfter: string;
  startOffset: number;
  endOffset: number;
  range: StaticRange | Range;
  createdAt: number;
}

interface PersistedNoteItem {
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

interface UiRefs {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  markersLayer: HTMLDivElement;
  popoverLayer: HTMLDivElement;
  actionsLayer: HTMLDivElement;
}

const ROOT_ID = "plannotator-chatgpt-root";
const STYLE_ID = "plannotator-chatgpt-page-style";
const MESSAGE_ID_ATTR = "data-plannotator-message-id";
const STORAGE_KEY_PREFIX = "plannotator-chatgpt-notes:v1:";
const HIGHLIGHT_NAME = "plannotator-notes";
const ACTIVE_HIGHLIGHT_NAME = "plannotator-note-active";
const MAX_EXCERPT = 120;
const CONTEXT_WINDOW = 48;
const POPOVER_WIDTH = 260;
const POPOVER_GAP = 14;
const SELECTION_SETTLE_MS = 140;
const NOTE_MAX_ROWS = 4;
const ACTION_SUCCESS_MS = 1400;
const PERSIST_DEBOUNCE_MS = 120;
const CONVERSATION_POLL_MS = 400;
const DEV_POLL_INTERVAL_MS = 700;
const DEV_VERSION_PATH = "/__plannotator/version";
const DEV_ENABLED = __PLANNOTATOR_DEV__;
const DEV_BUILD_ID = __PLANNOTATOR_BUILD_ID__;
const DEV_ORIGIN = __PLANNOTATOR_DEV_ORIGIN__;

const state = {
  notes: [] as NoteItem[],
  activeNoteId: null as string | null,
  selectionDraft: null as SelectionDraft | null,
  draftEditorOpen: false,
  draftText: "",
  notesMenuOpen: false,
  actionFeedback: "idle" as ActionFeedbackState,
  actionError: "",
};

type NoteMutation = { action: "upsert"; note: PersistedNoteItem } | { action: "remove"; id: string };
interface AnnotationSession {
  route: string;
  key: string | null;
  notes: Map<string, PersistedNoteItem>;
  saved: Map<string, PersistedNoteItem>;
  pending: Map<string, NoteMutation>;
  revision: number;
  loaded: boolean;
  loading: Promise<void> | null;
  flushing: Promise<void> | null;
  error: string;
  migrationError: string;
  draft: { selection: SelectionDraft; text: string } | null;
}
const annotationSessions = new Map<string, AnnotationSession>();
let annotationUi: UiRefs | null = null;

let selectionFrame = 0;
let selectionSettleTimer: ReturnType<typeof setTimeout> | null = null;
let selectionVersion = 0;
let draftFocusFrame = 0;
let draftFocusVersion = 0;
let renderFrame = 0;
let actionFeedbackTimer: number | null = null;
let persistTimer: number | null = null;
let currentConversationKey: string | null = null;
let pendingRestoreNotes: PersistedNoteItem[] = [];
let restoreFrame = 0;
let conversationPollTimer = 0;
let restoreObserver: MutationObserver | null = null;
let domRefreshObserver: MutationObserver | null = null;
let suppressActiveScrollClearUntil = 0;

if (window.top === window) {
  bootstrap();
}

function bootstrap(): void {
  if (document.getElementById(ROOT_ID)) return;

  ensurePageStyles();
  const ui = createUi();
  annotationUi = ui;
  if (__PLANNOTATOR_DEV__) startDevHotReload();
  startConversationPersistence(ui);
  startDomRefreshObserver(ui);

  document.addEventListener("selectionchange", () => {
    if (selectionFrame) return;
    selectionFrame = window.requestAnimationFrame(() => {
      selectionFrame = 0;
      syncSelectionDraft(ui);
    });
  }, true);

  // Native apps may treat the shadow host as a non-input and redirect typing
  // into their composer. Handle our editor before their document listeners.
  window.addEventListener("keydown", (event) => {
    const origin = event.composedPath()[0];
    const target = origin instanceof HTMLElement ? origin : null;
    const noteField = (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
      target.getRootNode() === ui.shadow;
    if (noteField) event.stopImmediatePropagation();
    const draftField = (
      target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    ) && noteField && target.dataset.field === "draft";

    if (event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "enter") {
        event.preventDefault();
        void insertPrompt(ui);
        return;
      }
      if (key === "i") {
        event.preventDefault();
        void insertPrompt(ui);
        return;
      }
      if (key === "c") {
        event.preventDefault();
        void navigator.clipboard.writeText(buildPrompt());
        return;
      }
      if (key === "k") {
        event.preventDefault();
        clearActionFeedback();
        clearAllNotes();
        render(ui);
        return;
      }
    }

    if (draftField && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Some editor/automation paths emit a non-composed input event. The
      // focused textarea is authoritative even if no input event escaped it.
      state.draftText = target.value;
      commitDraftNote();
      render(ui);
      return;
    }

    if (event.key !== "Escape") return;

    if (state.notesMenuOpen) {
      state.notesMenuOpen = false;
      render(ui);
      return;
    }

    if (draftField) {
      clearSelectionDraft();
      render(ui);
      return;
    }

    clearSelectionDraft();
    if (state.activeNoteId) {
      state.activeNoteId = null;
    }
    render(ui);
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (event.composedPath().includes(ui.host)) return;
    if (!state.activeNoteId && !state.selectionDraft && !state.notesMenuOpen) return;
    clearSelectionDraft();
    state.activeNoteId = null;
    state.notesMenuOpen = false;
    scheduleRender(ui);
  }, true);

  window.addEventListener("resize", () => scheduleRender(ui), { passive: true });
  window.addEventListener("scroll", () => handleViewportScroll(ui), { passive: true });
  document.addEventListener("scroll", () => handleViewportScroll(ui), {
    passive: true,
    capture: true,
  });
  window.addEventListener("wheel", () => clearActiveNoteFromUserScroll(ui), {
    passive: true,
    capture: true,
  });
  window.addEventListener("touchmove", () => clearActiveNoteFromUserScroll(ui), {
    passive: true,
    capture: true,
  });
  window.addEventListener("pagehide", () => {
    void flushPersistedConversationState();
  }, { capture: true });
  window.addEventListener("beforeunload", event => {
    if (!hasUnsavedAnnotationChanges()) return;
    event.preventDefault(); event.returnValue = "";
  });

  render(ui);
  void loadPersistedConversationState(ui);
}

function startDevHotReload(): void {
  if (!__PLANNOTATOR_DEV__ || !__PLANNOTATOR_DEV_ORIGIN__) return;

  const runtime = getExtensionApi()?.runtime;

  if (!runtime?.sendMessage) return;
  const sendMessage = runtime.sendMessage.bind(runtime);
  setDevReloadState("polling");

  let polling = false;
  let needsPageReload = false;
  let reloadTimer = 0;

  const safeToReload = (): boolean => {
    const composer = findQueueComposer();
    const noteShadow = document.getElementById(ROOT_ID)?.shadowRoot;
    const queueHost = document.getElementById("plannotator-message-queue");
    const queueShadow = queueHost?.shadowRoot;
    return Boolean(composer && !readComposer(composer).trim() && !isChatBusy() && !hasComposerAttachments() &&
      !state.draftEditorOpen && !state.draftText.trim() && !persistTimer && !hasUnsavedAnnotationChanges() && state.actionFeedback !== "loading" &&
      !noteShadow?.querySelector("textarea") && queueHost?.getAttribute("data-reload-blocked") !== "true" &&
      !queueShadow?.querySelector("textarea, button[data-action='enqueue']:disabled"));
  };

  const schedulePageReload = (delayMs = 420): void => {
    if (reloadTimer) return;
    if (!safeToReload()) { setDevReloadState("waiting-for-idle"); return; }
    setDevReloadState("page-reload-scheduled");
    reloadTimer = window.setTimeout(() => {
      reloadTimer = 0;
      // A draft, response, attachment, or editor may have appeared since the
      // worker accepted the reload. Keep this document alive until safe again.
      if (!safeToReload()) { setDevReloadState("waiting-for-idle"); return; }
      setDevReloadState("page-reloading");
      window.location.reload();
    }, delayMs);
  };

  runtime.onMessage?.addListener?.((rawMessage, _sender, respond) => {
    const message = rawMessage as { type?: string } | null;
    if (message?.type === "plannotator:dev-can-reload") {
      respond?.({ ok: true, safe: safeToReload() });
      return;
    }
    if (message?.type !== "plannotator:dev-page-reload") {
      return;
    }

    needsPageReload = true;
    setDevReloadState("page-reload-message");
    schedulePageReload();
  });

  const poll = async (): Promise<void> => {
    if (polling || reloadTimer) return;
    if (needsPageReload) { schedulePageReload(); return; }
    polling = true;
    try {
      // The extension worker owns localhost access, avoiding page CORS and
      // ChatGPT's local-network permission prompts.
      const payload = await sendMessage({ type: "plannotator:dev-version" }) as { buildId?: string; workerBuildId?: string } | undefined;
      if (!payload?.buildId || payload.buildId === "booting" ||
          (payload.buildId === DEV_BUILD_ID && payload.workerBuildId === DEV_BUILD_ID)) {
        return;
      }
      if (payload.workerBuildId === payload.buildId) {
        // Another tab already installed this build. Refresh only this stale
        // document; another runtime reload would invalidate updated tabs again.
        needsPageReload = true;
        setDevReloadState(`worker-current:${payload.buildId}`);
        schedulePageReload();
        return;
      }
      if (!safeToReload()) { setDevReloadState("waiting-for-idle"); return; }
      setDevReloadState(`build-change:${payload.buildId}`);
      const reply = await sendMessage({ type: "plannotator:dev-reload", buildId: payload.buildId }) as { ok?: boolean; scheduled?: boolean } | undefined;
      if (reply?.ok && reply.scheduled === false) { setDevReloadState("waiting-for-other-tabs"); return; }
      if (reply?.ok && reply.scheduled === true) {
        setDevReloadState(`reload-requested:${payload.buildId}`);
        // Scheduling is not proof that the global update happened: another
        // tab may become busy before the worker's final safety check. Wait for
        // its new build ID (or context invalidation) before refreshing here.
      }
    } catch (error) {
      // Another tab can reload the worker first, invalidating this old content
      // script. Its safe page refresh reconnects even though messaging is dead.
      const message = error instanceof Error ? error.message : String(error);
      if (/context invalidated/i.test(message)) {
        needsPageReload = true;
        schedulePageReload();
      }
      // An absent dev server or other transient failure does not refresh a tab.
    } finally { polling = false; }
  };

  void poll();
  window.setInterval(() => {
    void poll();
  }, DEV_POLL_INTERVAL_MS);
}

function ensurePageStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background: rgba(251, 191, 36, 0.35);
      color: inherit;
    }

    ::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
      background: rgba(245, 158, 11, 0.62);
      color: inherit;
    }
  `;
  document.head.appendChild(style);
}

function createUi(): UiRefs {
  const host = document.createElement("div");
  host.id = ROOT_ID;
  if (DEV_ENABLED) {
    host.dataset.buildId = DEV_BUILD_ID;
    host.dataset.reloadState = "booted";
  }
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .icon { display: block; flex: none; pointer-events: none; }
      button:focus-visible { outline: 2px solid #458cff; outline-offset: 3px; }

      .shell {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483646;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      }

      .selection-trigger,
      .note-popover,
      .notes-toolbar {
        pointer-events: auto;
      }

      .markers-layer,
      .popover-layer,
      .actions-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      .selection-trigger {
        position: fixed;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: #1d4ed8;
        color: white;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 12px 28px rgba(29, 78, 216, 0.35);
        cursor: pointer;
      }

      .selection-trigger:hover {
        transform: translateY(-1px);
      }

      .note-popover {
        position: fixed;
        width: 260px;
        max-width: calc(100vw - 24px);
        background: transparent;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        backdrop-filter: none;
        padding: 0;
      }

      .note-popover-shell {
        position: relative;
      }

      .input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 0;
        border: 1px solid rgba(37, 99, 235, 0.22);
        border-radius: 18px;
        padding: 10px 14px;
        font: inherit;
        font-size: 13px;
        line-height: 1.45;
        color: #0f172a;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
        resize: none;
        overflow-y: hidden;
      }

      .note-popover-shell.has-delete .input {
        padding-right: 38px;
      }

      .delete-note {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.08);
        color: #475569;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
      }

      .delete-note:hover {
        background: rgba(239, 68, 68, 0.14);
        color: #b91c1c;
      }

      .notes-toolbar {
        position: fixed;
        right: 18px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .notes-action,
      .notes-list-toggle {
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 13px;
        font-weight: 750;
        cursor: pointer;
        transition: transform 120ms ease, background 140ms ease, box-shadow 140ms ease;
      }

      .notes-action {
        background: #1d4ed8;
        color: white;
        box-shadow: 0 14px 30px rgba(29, 78, 216, 0.3);
      }

      .notes-list-toggle {
        background: rgba(255, 255, 255, 0.98);
        color: #92400e;
        border: 1px solid rgba(217, 119, 6, 0.35);
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.16);
      }

      .notes-list-toggle.active {
        background: #f59e0b;
        color: #111827;
        border-color: #f59e0b;
      }

      .notes-action:hover,
      .notes-list-toggle:hover {
        transform: translateY(-1px);
      }

      .notes-action.success {
        background: #16a34a;
        box-shadow: 0 14px 30px rgba(22, 163, 74, 0.28);
      }

      .notes-action.loading {
        background: #1e40af;
        box-shadow: 0 14px 30px rgba(30, 64, 175, 0.28);
      }

      .notes-action:disabled {
        cursor: default;
      }

      .notes-action.success:hover,
      .notes-action:disabled:hover {
        transform: none;
      }

      .notes-action svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .notes-menu {
        position: absolute;
        right: 0;
        bottom: 52px;
        width: min(340px, calc(100vw - 36px));
        max-height: min(420px, calc(100vh - 132px));
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 22px 52px rgba(15, 23, 42, 0.2);
        padding: 6px;
        box-sizing: border-box;
      }

      .notes-menu-row {
        width: 100%;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #0f172a;
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr);
        column-gap: 10px;
        align-items: start;
        padding: 9px 8px;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .notes-menu-row:hover,
      .notes-menu-row.active {
        background: rgba(251, 191, 36, 0.22);
      }
      .notes-menu-item { display: flex; align-items: center; }
      .notes-menu-item .notes-menu-row { min-width: 0; }
      .notes-menu-delete { flex: none; width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer; }
      .notes-menu-delete:hover { background: #fee2e2; color: #b91c1c; }
      .notes-help { padding: 8px; margin: 0; font-size: 11px; color: #64748b; }
      .notes-status { max-width: min(340px, calc(100vw - 150px)); padding: 8px 10px; border-radius: 8px; background: white; box-shadow: 0 4px 18px #0f172a22; font-size: 12px; }
      .notes-status.error { color: #991b1b; }
      .notes-status button { margin-left: 6px; font: inherit; cursor: pointer; }

      .notes-menu-index {
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.18);
        color: #92400e;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
      }

      .notes-menu-text {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .notes-menu-comment,
      .notes-menu-quote {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .notes-menu-comment {
        font-size: 13px;
        font-weight: 700;
        color: #0f172a;
      }

      .notes-menu-quote {
        font-size: 12px;
        color: #64748b;
      }

      .notes-action-spinner {
        animation: notes-action-spin 720ms linear infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .notes-action-spinner { animation: none; }
      }

      @keyframes notes-action-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 720px) {
        .note-popover {
          width: min(260px, calc(100vw - 20px));
        }
      }
    </style>
    <div class="shell">
      <div class="markers-layer" id="markers-layer"></div>
      <div class="popover-layer" id="popover-layer"></div>
      <div class="actions-layer" id="actions-layer"></div>
    </div>
  `;

  const markersLayer = shadow.getElementById("markers-layer") as HTMLDivElement | null;
  const popoverLayer = shadow.getElementById("popover-layer") as HTMLDivElement | null;
  const actionsLayer = shadow.getElementById("actions-layer") as HTMLDivElement | null;

  if (!markersLayer || !popoverLayer || !actionsLayer) {
    throw new Error("Threadlane extension failed to initialize its UI");
  }

  const ui: UiRefs = {
    host,
    shadow,
    markersLayer,
    popoverLayer,
    actionsLayer,
  };

  shadow.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest<HTMLElement>("[data-action='open-draft']")) {
      event.preventDefault();
      state.draftEditorOpen = true;
      state.activeNoteId = null;
      render(ui);
      return;
    }

    if (target?.closest<HTMLElement>("[data-action='insert-notes']")) {
      event.preventDefault();
      if (state.notes.length === 0 || state.actionFeedback !== "idle") return;
      void insertPrompt(ui);
      return;
    }

  });

  shadow.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-action='retry-notes']")) {
      void retryAnnotationSave();
      return;
    }

    if (target.closest("[data-action='open-draft']")) {
      if (event instanceof MouseEvent && event.detail === 0) {
        state.draftEditorOpen = true;
        state.activeNoteId = null;
        render(ui);
      }
      return;
    }

    if (target.closest("[data-action='insert-notes']")) {
      if (event instanceof MouseEvent && event.detail === 0 && state.notes.length > 0 && state.actionFeedback === "idle") void insertPrompt(ui);
      return;
    }

    if (target.closest("[data-action='toggle-notes-menu']")) {
      if (allConversationNotes().length === 0) return;
      state.notesMenuOpen = !state.notesMenuOpen;
      render(ui);
      return;
    }

    const jumpTarget = target.closest<HTMLElement>("[data-action='jump-note']");
    if (jumpTarget?.dataset.noteId) {
      jumpToNote(jumpTarget.dataset.noteId, ui);
      return;
    }

    const deleteTarget = target.closest<HTMLElement>("[data-action='delete-note']");
    if (deleteTarget) {
      const noteId = deleteTarget.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      if (!noteId) return;
      deleteNote(noteId);
      render(ui);
      return;
    }

    return;
  });

  const updateNoteField = (target: HTMLTextAreaElement | HTMLInputElement): void => {
    if (currentConversationKey !== getConversationStorageKey()) {
      if (target.dataset.field === "draft") state.draftText = target.value;
      ensureAnnotationRoute();
      return;
    }
    if (target.dataset.field === "draft") state.draftText = target.value;
    else {
      const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      if (noteId) updateNote(noteId, { comment: target.value });
    }
    autosizeNoteField(target);
  };
  // Non-composed input events never reach the window. Keep a shadow-local
  // fallback; composed events are handled and stopped by window capture.
  shadow.addEventListener("input", (event) => {
    const target = event.composedPath()[0];
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) updateNoteField(target);
  });
  for (const type of ["keypress", "keyup", "beforeinput", "input", "paste", "copy", "cut"]) {
    window.addEventListener(type, (event) => {
      const target = event.composedPath()[0];
      if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) || target.getRootNode() !== shadow) return;
      // Keep default textarea editing/paste behavior while preventing native
      // document-capture shortcuts from treating our shadow host as the page.
      event.stopImmediatePropagation();
      if (type !== "input") return;
      updateNoteField(target);
    }, true);
  }

  return ui;
}

function render(ui: UiRefs): void {
  reanchorDetachedNotes();
  renderMarkers(ui);
  renderPopover(ui);
  renderActions(ui);
  renderHighlights();
}

function reanchorDetachedNotes(): void {
  let changed = false;

  state.notes = state.notes.flatMap((note) => {
    if (getRangeRect(note.range)) {
      return [note];
    }

    const restored = restorePersistedNote(note);
    if (!restored) {
      return [note];
    }

    changed = true;
    return [restored];
  });

  // Reanchoring only changes the current DOM range; it is not a user edit.
}

function renderMarkers(ui: UiRefs): void {
  ui.markersLayer.innerHTML = "";
}

function renderActions(ui: UiRefs): void {
  const isLoading = state.actionFeedback === "loading";
  const isSuccess = state.actionFeedback === "inserted";
  const notes = allConversationNotes();
  const session = currentAnnotationSession();
  const otherUnsaved = Array.from(annotationSessions.values()).find(entry => entry !== session && (entry.pending.size > 0 || entry.draft?.text.trim() || (!entry.key && entry.notes.size)));
  const error = session.error || session.migrationError || state.actionError;
  const status = error || (session.pending.size || session.loading || session.flushing ? "Saving notes…" : "");
  if (notes.length === 0 && !isLoading && !isSuccess && !status && !otherUnsaved) {
    ui.actionsLayer.innerHTML = "";
    return;
  }

  const composer = findComposer();
  let bottom = 24;
  if (composer instanceof HTMLElement) {
    const rect = composer.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      bottom = clamp(window.innerHeight - rect.top + 18, 24, 180);
    }
  }

  const menu = state.notesMenuOpen && notes.length > 0
    ? renderNotesMenu()
    : "";
  const toggleButton = notes.length > 0
    ? `
    <button
      class="notes-list-toggle${state.notesMenuOpen ? " active" : ""}"
      data-action="toggle-notes-menu"
      type="button"
      title="Show notes"
      aria-label="Show notes"
      aria-expanded="${state.notesMenuOpen ? "true" : "false"}"
    >${notes.length}</button>
  `
    : "";

  ui.actionsLayer.innerHTML = `
    <div class="notes-toolbar" style="bottom:${bottom}px;">
      ${menu}
      ${status ? `<span class="notes-status${error ? " error" : ""}" role="${error ? "alert" : "status"}">${escapeHtml(status)}${session.error || session.migrationError ? '<button data-action="retry-notes" type="button">Retry save</button>' : ""}</span>` : ""}
      ${otherUnsaved ? `<span class="notes-status error" role="alert">Notes in another chat are not saved. <a href="${escapeHtml(otherUnsaved.route.slice(STORAGE_KEY_PREFIX.length))}">Return to save</a></span>` : ""}
      ${toggleButton}
    <button
      class="notes-action${isLoading ? " loading" : ""}${isSuccess ? " success" : ""}"
      data-action="insert-notes"
      type="button"
      title="${isLoading ? "Inserting into" : isSuccess ? "Inserted into" : "Insert notes into"} ${getProviderName()}"
      aria-label="${isLoading ? "Inserting into" : isSuccess ? "Inserted into" : "Insert notes into"} ${getProviderName()}"
      data-state="${isLoading ? "loading" : isSuccess ? "success" : "idle"}"
      ${isLoading || isSuccess || state.notes.length === 0 ? "disabled" : ""}
    >
      ${isLoading
        ? icon("loader", 16, "notes-action-spinner")
        : isSuccess
        ? icon("check")
        : icon("arrow-right")}
    </button>
    </div>
  `;
}

function renderNotesMenu(): string {
  return `
    <section class="notes-menu" aria-label="Saved notes">
      <p class="notes-help">Saved notes remain until you delete them.</p>
      ${allConversationNotes().map((note, index) => `
        <div class="notes-menu-item" data-note-id="${escapeHtml(note.id)}">
        <button
          class="notes-menu-row${note.id === state.activeNoteId ? " active" : ""}"
          data-action="jump-note"
          data-note-id="${escapeHtml(note.id)}"
          type="button"
          title="${escapeHtml(note.comment || note.quote)}"
          aria-label="Jump to note ${index + 1}"
        >
          <span class="notes-menu-index">${index + 1}</span>
          <span class="notes-menu-text">
            <span class="notes-menu-comment">${escapeHtml(truncateInline(note.comment || "Untitled note", 80))}</span>
            <span class="notes-menu-quote">${escapeHtml(truncateInline(note.quote, 90))}</span>
          </span>
        </button>
        <button class="notes-menu-delete" data-action="delete-note" type="button" aria-label="Delete note ${index + 1}" title="Delete note ${index + 1}">${icon("trash")}</button>
        </div>
      `).join("")}
    </section>
  `;
}

function renderPopover(ui: UiRefs): void {
  const draft = state.selectionDraft;

  if (!draft) {
    cancelDraftFocus();
    ui.popoverLayer.innerHTML = "";
    return;
  }

  if (!state.draftEditorOpen) {
    cancelDraftFocus();
    const side = pickSide(draft.rect);
    const triggerX = getDraftTriggerX(draft.rect, side);
    const triggerY = clamp(
      draft.rect.top + draft.rect.height / 2 - 12,
      12,
      window.innerHeight - 24 - 12,
    );

    ui.popoverLayer.innerHTML = `
      <button
        class="selection-trigger"
        data-action="open-draft"
        type="button"
        aria-label="Add note"
        title="Add note"
        style="left:${triggerX}px;top:${triggerY}px;"
      >${icon("plus")}</button>
    `;
    return;
  }

  const draftKey = getSelectionDraftKey(draft);
  const side = pickSide(draft.rect);
  const rect = draft.rect;
  let popover = ui.popoverLayer.querySelector<HTMLElement>(
    ".note-popover[data-draft-editor='true']",
  );
  let field = popover?.querySelector<HTMLTextAreaElement>("textarea[data-field='draft']") ?? null;
  let created = false;

  if (!popover || !field || popover.dataset.draftKey !== draftKey) {
    cancelDraftFocus();
    ui.popoverLayer.innerHTML = `
      <section class="note-popover" data-draft-editor="true">
        <div class="note-popover-shell">
          <textarea
            class="input"
            data-field="draft"
            placeholder="Type a note and press Enter"
            rows="1"
            autocomplete="off"
            spellcheck="true"
          ></textarea>
        </div>
      </section>
    `;

    popover = ui.popoverLayer.querySelector<HTMLElement>(".note-popover");
    field = popover?.querySelector<HTMLTextAreaElement>("textarea[data-field='draft']") ?? null;
    if (!popover || !field) return;

    popover.dataset.draftKey = draftKey;
    field.value = state.draftText;
    created = true;
  } else if (field.value !== state.draftText) {
    const wasFocused = ui.shadow.activeElement === field;
    const selectionStart = field.selectionStart;
    const selectionEnd = field.selectionEnd;
    field.value = state.draftText;

    if (wasFocused) {
      const valueLength = field.value.length;
      field.setSelectionRange(
        Math.min(selectionStart, valueLength),
        Math.min(selectionEnd, valueLength),
      );
    }
  }

  popover.dataset.side = side;
  autosizeNoteField(field);

  popover.style.left = "-9999px";
  popover.style.top = "-9999px";

  const measuredHeight = popover.offsetHeight || 52;
  const popoverLeft = getPopoverLeft(side, rect);
  const popoverTop = clamp(
    rect.top + rect.height / 2 - measuredHeight / 2,
    12,
    window.innerHeight - measuredHeight - 12,
  );

  popover.style.left = `${popoverLeft}px`;
  popover.style.top = `${popoverTop}px`;

  if (created) {
    focusDraftField(ui, draftKey, field);
  }
}

function getSelectionDraftKey(draft: SelectionDraft): string {
  return JSON.stringify([
    draft.messageId,
    draft.startOffset,
    draft.endOffset,
    draft.quote,
  ]);
}

function syncSelectionDraft(ui: UiRefs): void {
  syncAnnotationRoute(ui);
  if (isDraftInputFocused(ui)) {
    return;
  }

  const draft = getSelectionDraft();
  selectionVersion += 1;
  const version = selectionVersion;

  if (selectionSettleTimer) {
    clearTimeout(selectionSettleTimer);
    selectionSettleTimer = null;
  }

  if (!draft) {
    if (!state.draftEditorOpen || !state.selectionDraft) {
      state.selectionDraft = null;
      state.draftEditorOpen = false;
    }
    render(ui);
    return;
  }

  selectionSettleTimer = setTimeout(() => {
    if (version !== selectionVersion) return;

    const previousId = state.selectionDraft?.messageId ?? null;
    const nextId = draft.messageId;
    const changed = previousId !== nextId || state.selectionDraft?.quote !== draft.quote;

    if (changed) {
      state.draftText = "";
      state.draftEditorOpen = false;
      state.activeNoteId = null;
    }

    state.selectionDraft = draft;
    render(ui);
  }, SELECTION_SETTLE_MS);
}

function getSelectionDraft(): SelectionDraft | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!range || range.collapsed) return null;

  const startMessage = findAssistantMessage(range.startContainer);
  const endMessage = findAssistantMessage(range.endContainer);
  if (!startMessage || startMessage !== endMessage) return null;

  if (isInsideRoot(range.commonAncestorContainer)) return null;

  const quote = collapseWhitespace(selection.toString()).trim();
  if (!quote) return null;

  const rect = getSelectionTailRect(range) ?? range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;

  const messageId = ensureMessageId(startMessage);
  const offsets = getOffsetsWithin(startMessage, range);
  const fullText = getNodeText(startMessage);

  return {
    messageId,
    quote,
    range: createStableRange(range),
    messageExcerpt: collapseWhitespace(fullText).slice(0, MAX_EXCERPT),
    contextBefore: collapseWhitespace(fullText.slice(Math.max(0, offsets.start - CONTEXT_WINDOW), offsets.start)),
    contextAfter: collapseWhitespace(fullText.slice(offsets.end, offsets.end + CONTEXT_WINDOW)),
    startOffset: offsets.start,
    endOffset: offsets.end,
    rect,
  };
}

function commitDraftNote(): void {
  if (!ensureAnnotationRoute()) return;
  const draft = state.selectionDraft;
  if (!draft) return;

  const comment = state.draftText.trim();
  if (!comment) {
    clearSelectionDraft();
    return;
  }

  const note: NoteItem = {
    id: crypto.randomUUID(),
    messageId: draft.messageId,
    messageExcerpt: draft.messageExcerpt,
    quote: draft.quote,
    comment,
    contextBefore: draft.contextBefore,
    contextAfter: draft.contextAfter,
    startOffset: draft.startOffset,
    endOffset: draft.endOffset,
    range: draft.range,
    createdAt: Date.now(),
  };

  clearActionFeedback();
  state.notes.push(note);
  state.activeNoteId = null;
  clearSelectionDraft();
  queueAnnotationMutation({ action: "upsert", note: serializeNote(note) }, true);
}

function updateNote(noteId: string, updates: Partial<Pick<NoteItem, "comment">>): void {
  if (!ensureAnnotationRoute()) return;
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return;

  if (updates.comment !== undefined) {
    note.comment = updates.comment;
  }

  queueAnnotationMutation({ action: "upsert", note: serializeNote(note) });
}

function deleteNote(noteId: string): void {
  if (!ensureAnnotationRoute()) return;
  const remaining = getOrderedNotes().filter((note) => note.id !== noteId);
  state.notes = remaining;
  if (state.activeNoteId === noteId) {
    state.activeNoteId = remaining.at(-1)?.id ?? null;
  }
  pendingRestoreNotes = pendingRestoreNotes.filter(note => note.id !== noteId);
  queueAnnotationMutation({ action: "remove", id: noteId }, true);
}

function commitActiveNote(noteId: string): void {
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return;

  if (!note.comment.trim()) {
    deleteNote(noteId);
    state.activeNoteId = null;
    return;
  }

  state.activeNoteId = null;
  queueAnnotationMutation({ action: "upsert", note: serializeNote(note) }, true);
}

function clearAllNotes(): void {
  if (!ensureAnnotationRoute()) return;
  const ids = allConversationNotes().map(note => note.id);
  state.notes = [];
  state.activeNoteId = null;
  state.notesMenuOpen = false;
  pendingRestoreNotes = [];
  stopRestoreObserver();
  clearSelectionDraft();

  const cssHighlights = (CSS as unknown as { highlights?: MapLike }).highlights;
  cssHighlights?.set(HIGHLIGHT_NAME, new Highlight());
  cssHighlights?.set(ACTIVE_HIGHLIGHT_NAME, new Highlight());
  for (const id of ids) queueAnnotationMutation({ action: "remove", id });
  void flushPersistedConversationState();
}

function buildPrompt(): string {
  if (state.notes.length === 0) {
    return "Select assistant text and add at least one note.";
  }

  return getOrderedNotes()
    .map((note) => [
      `user: ${formatPromptValue(note.comment)}`,
      `responding to AI selected text: ${formatPromptValue(note.quote)}`,
    ].join("\n"))
    .join("\n\n")
    .trim();
}

async function insertPrompt(ui: UiRefs): Promise<void> {
  if (!ensureAnnotationRoute()) return;
  if (state.notes.length === 0 || state.actionFeedback === "loading") {
    return;
  }

  const composer = findComposer();
  if (!composer) {
    state.actionError = "The composer is unavailable. Your notes are still saved here.";
    render(ui);
    return;
  }
  if (getComposerText(composer).trim() || hasComposerAttachments()) {
    state.actionError = "Send or clear the current draft before inserting notes.";
    render(ui);
    return;
  }

  const route = getConversationStorageKey();
  const prompt = buildPrompt();
  state.actionError = "";
  clearActionFeedback();
  state.actionFeedback = "loading";
  render(ui);
  await nextPaint();

  if (route !== getConversationStorageKey() || !composer.isConnected || findComposer() !== composer || getComposerText(composer).trim() || hasComposerAttachments()) {
    clearActionFeedback();
    state.actionError = "The conversation or draft changed. Your notes were kept.";
    render(ui);
    return;
  }
  if (!setComposerText(composer, prompt)) {
    clearActionFeedback();
    state.actionError = "Could not insert notes. Your notes were kept.";
    render(ui);
    return;
  }
  showInsertSuccess(ui);
  render(ui);
}

function startConversationPersistence(ui: UiRefs): void {
  currentConversationKey = getConversationStorageKey();
  if (conversationPollTimer) return;
  annotationRuntime()?.onMessage?.addListener(rawMessage => {
    if (!rawMessage || typeof rawMessage !== "object") return;
    const message = rawMessage as { type?: string; key?: string };
    const session = currentAnnotationSession();
    if (message.type === ANNOTATION_CHANGED_TYPE && message.key === session.key) void refreshAnnotationSession(session);
  });
  conversationPollTimer = window.setInterval(() => syncAnnotationRoute(ui), CONVERSATION_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshAnnotationSession(currentAnnotationSession());
  });
}

function syncAnnotationRoute(ui: UiRefs): void {
  const nextKey = getConversationStorageKey();
  if (nextKey === currentConversationKey) return;
  const previous = currentAnnotationSession();
  if (state.selectionDraft && state.draftText.trim()) previous.draft = { selection: state.selectionDraft, text: state.draftText };
  // Pending writes already carry their original conversation. Never retarget
  // them or replace a new page with an old request's eventual callback.
  stopRestoreObserver();
  pendingRestoreNotes = [];
  clearActionFeedback();
  clearSelectionDraft(false);
  state.notes = []; state.activeNoteId = null; state.notesMenuOpen = false; state.actionError = "";
  currentConversationKey = nextKey;
  const next = currentAnnotationSession();
  if (next.draft) {
    state.selectionDraft = next.draft.selection; state.draftText = next.draft.text; state.draftEditorOpen = true;
  }
  applyAnnotationSession(next);
  render(ui);
  void loadPersistedConversationState(ui);
}

function ensureAnnotationRoute(): boolean {
  if (!currentConversationKey) { currentConversationKey = getConversationStorageKey(); return true; }
  if (currentConversationKey === getConversationStorageKey()) return true;
  if (annotationUi) syncAnnotationRoute(annotationUi);
  return false;
}

function startDomRefreshObserver(ui: UiRefs): void {
  if (domRefreshObserver || !document.body) return;

  domRefreshObserver = new MutationObserver(() => {
    if (pendingRestoreNotes.length > 0) {
      scheduleRestorePendingNotes(ui);
    }
    if (state.notes.length > 0) {
      scheduleRender(ui);
    }
  });

  domRefreshObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

async function loadPersistedConversationState(ui: UiRefs): Promise<void> {
  annotationUi = ui;
  currentConversationKey ??= getConversationStorageKey();
  const session = currentAnnotationSession();
  await loadAnnotationSession(session);
  if (session.pending.size) await flushAnnotationSession(session);
}

function schedulePersistedConversationState(): void {
  if (persistTimer) clearTimeout(persistTimer);
  const session = currentAnnotationSession();
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void flushAnnotationSession(session);
  }, PERSIST_DEBOUNCE_MS);
}

async function flushPersistedConversationState(): Promise<void> {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  await flushAnnotationSession(currentAnnotationSession());
}

function annotationRuntime(): ExtensionRuntime | undefined {
  return getExtensionApi()?.runtime;
}

function currentAnnotationSession(): AnnotationSession {
  const route = currentConversationKey ?? getConversationStorageKey();
  let session = annotationSessions.get(route);
  if (!session) {
    session = { route, key: getAnnotationKey(route.slice(STORAGE_KEY_PREFIX.length)), notes: new Map(), saved: new Map(), pending: new Map(), revision: -1, loaded: false, loading: null, flushing: null, error: "", migrationError: "", draft: null };
    annotationSessions.set(route, session);
  }
  return session;
}

function allConversationNotes(): PersistedNoteItem[] {
  const notes = new Map(currentAnnotationSession().notes);
  for (const note of pendingRestoreNotes) if (!notes.has(note.id)) notes.set(note.id, note);
  for (const note of state.notes) notes.set(note.id, serializeNote(note));
  return Array.from(notes.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function hasUnsavedAnnotationChanges(): boolean {
  return Boolean(state.draftText.trim() || Array.from(annotationSessions.values()).some(session => session.pending.size || session.draft?.text.trim() || (!session.key && session.notes.size)));
}

function applyAnnotationSession(session: AnnotationSession): void {
  if (session.route !== currentConversationKey || session.route !== getConversationStorageKey()) return;
  const old = new Map(state.notes.map(note => [note.id, note]));
  state.notes = []; pendingRestoreNotes = [];
  for (const note of session.notes.values()) {
    const restored = restorePersistedNote(note);
    const previous = old.get(note.id);
    if (restored) state.notes.push(restored);
    else if (previous) state.notes.push({ ...previous, comment: note.comment });
    else pendingRestoreNotes.push(note);
  }
  if (annotationUi) {
    if (pendingRestoreNotes.length) scheduleRestorePendingNotes(annotationUi);
    render(annotationUi);
  }
}

function acceptAnnotationSnapshot(session: AnnotationSession, reply: { notes: PersistedNoteItem[]; revision: number }): void {
  if (reply.revision >= session.revision) {
    session.revision = reply.revision;
    session.saved = new Map(reply.notes.map(note => [note.id, note]));
  }
  session.notes = new Map(session.saved);
  for (const [id, mutation] of session.pending) {
    if (mutation.action === "remove") session.notes.delete(id);
    else session.notes.set(id, mutation.note);
  }
  applyAnnotationSession(session);
}

async function annotationRequest(session: AnnotationSession, action: string, extra: Record<string, unknown> = {}): Promise<{ notes: PersistedNoteItem[]; revision: number }> {
  if (!session.key) throw new Error("Open a saved conversation to save these notes.");
  const runtime = annotationRuntime();
  if (!runtime?.sendMessage) throw new Error("Extension storage is unavailable. Keep this tab open and retry saving.");
  const reply = await runtime.sendMessage({ type: ANNOTATION_MESSAGE_TYPE, key: session.key, action, ...extra }) as { ok?: boolean; notes?: PersistedNoteItem[]; revision?: number; error?: string };
  if (!reply?.ok || !Array.isArray(reply.notes) || typeof reply.revision !== "number") throw new Error(reply?.error || "The save was not confirmed. Keep this tab open and retry saving.");
  return { notes: reply.notes, revision: reply.revision };
}

function annotationFailure(session: AnnotationSession, error: unknown): void {
  session.error = `Notes not saved: ${error instanceof Error ? error.message : String(error)}`;
  applyAnnotationSession(session);
}

async function loadAnnotationSession(session: AnnotationSession): Promise<void> {
  // Home, temporary and optimistic conversation URLs have no durable key.
  // Merely opening one is not a failed save. Keep actual local work protected
  // without sending an invalid read or pretending it reached storage.
  if (!session.key) {
    let raw: string | null = null;
    session.migrationError = "";
    try {
      raw = window.localStorage.getItem(session.route);
      if (raw) {
        const legacy: unknown = JSON.parse(raw);
        if (!Array.isArray(legacy) || !legacy.every(isPersistedNoteItem)) throw new Error("The original notes could not be read.");
        for (const note of legacy) {
          if (!session.notes.has(note.id) && !session.pending.has(note.id)) session.notes.set(note.id, note);
        }
      }
    } catch {
      // A nonempty legacy payload is real work even if its format is unknown.
      // Keep that source intact; an inaccessible empty page is not a failed save.
      if (raw) session.migrationError = "Existing notes could not be read. Their original copy has been kept.";
    }
    session.error = session.notes.size || session.pending.size
      ? "This chat is not saved. These notes are not saved in extension storage; keep this tab open."
      : "";
    applyAnnotationSession(session);
    return;
  }
  if (session.loading) return session.loading;
  session.loading = Promise.resolve().then(async () => {
    try {
      let raw: string | null = null;
      let legacy: PersistedNoteItem[] = [];
      session.migrationError = "";
      try {
        raw = window.localStorage.getItem(session.route);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed) || !parsed.every(isPersistedNoteItem)) throw new Error("The original notes could not be read.");
          legacy = parsed;
          for (const note of legacy) if (!session.notes.has(note.id)) session.notes.set(note.id, note);
          applyAnnotationSession(session);
        }
      } catch (error) {
        raw = null;
        session.migrationError = `Legacy notes were kept but could not be imported: ${error instanceof Error ? error.message : String(error)}`;
      }
      const reply = await annotationRequest(session, raw ? "import" : "read", raw ? { notes: legacy } : {});
      acceptAnnotationSnapshot(session, reply);
      // Do not delete a legacy copy changed while the import was in flight.
      if (raw && window.localStorage.getItem(session.route) === raw) window.localStorage.removeItem(session.route);
      session.loaded = true; session.error = "";
    } catch (error) { annotationFailure(session, error); }
  }).finally(() => { session.loading = null; applyAnnotationSession(session); });
  return session.loading;
}

async function refreshAnnotationSession(session: AnnotationSession): Promise<void> {
  if (!session.loaded) { await loadAnnotationSession(session); return; }
  try { acceptAnnotationSnapshot(session, await annotationRequest(session, "read")); }
  catch (error) { annotationFailure(session, error); }
}

function queueAnnotationMutation(mutation: NoteMutation, immediate = false): void {
  const session = currentAnnotationSession();
  const id = mutation.action === "remove" ? mutation.id : mutation.note.id;
  session.pending.set(id, mutation);
  if (mutation.action === "remove") session.notes.delete(id);
  else session.notes.set(id, mutation.note);
  session.error = "";
  if (immediate) void flushAnnotationSession(session);
  else schedulePersistedConversationState();
}

async function flushAnnotationSession(session: AnnotationSession): Promise<void> {
  if (session.flushing) return session.flushing;
  session.flushing = (async () => {
    if (!session.loaded) await loadAnnotationSession(session);
    if (!session.loaded) return;
    try {
      while (session.pending.size) {
        const action = session.pending.values().next().value!.action;
        const batch = Array.from(session.pending.entries()).filter(([, mutation]) => mutation.action === action);
        const extra = action === "remove" ? { ids: batch.map(([id]) => id) } : { notes: batch.map(([, mutation]) => (mutation as Extract<NoteMutation, { action: "upsert" }>).note) };
        const reply = await annotationRequest(session, action, extra);
        for (const [id, mutation] of batch) if (session.pending.get(id) === mutation) session.pending.delete(id);
        acceptAnnotationSnapshot(session, reply);
        session.error = "";
      }
    } catch (error) { annotationFailure(session, error); }
  })().finally(() => { session.flushing = null; applyAnnotationSession(session); });
  return session.flushing;
}

async function retryAnnotationSave(): Promise<void> {
  if (!ensureAnnotationRoute()) return;
  const session = currentAnnotationSession();
  session.error = "";
  await loadAnnotationSession(session);
  await flushAnnotationSession(session);
  applyAnnotationSession(session);
}

function hasNativeSendButtonInPath(path: Array<EventTarget | undefined>): boolean {
  return path.some((entry) => entry instanceof Element && isNativeSendButton(entry));
}

function canComposerSend(): boolean {
  if (isChatBusy()) return false;
  const composer = findComposer();
  const composerText = composer ? normalizePromptMatch(getComposerText(composer)) : "";
  return Boolean(composerText || findQueueSendButton());
}

function isNativeSendButton(target: Element): boolean {
  const button = findQueueSendButton();
  return Boolean(button && (button === target || button.contains(target)));
}

function isNativeComposerSendKey(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) {
    return false;
  }

  const origin = event.composedPath()[0];
  const target = origin instanceof Element ? origin : null;
  if (!target || isInsideRoot(target)) {
    return false;
  }

  const composer = findComposer();
  if (!composer) return false;

  return target === composer || composer.contains(target);
}


function findComposer(): ComposerElement | null {
  return findQueueComposer();
}

function getComposerText(element: ComposerElement): string {
  return readComposer(element);
}

function setComposerText(element: ComposerElement, value: string): boolean {
  const inserted = writeComposer(element, value);
  if (inserted) element.focus();
  return inserted;
}

function jumpToNote(noteId: string, ui: UiRefs): void {
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return;

  state.activeNoteId = noteId;
  state.notesMenuOpen = false;
  suppressActiveScrollClearUntil = Date.now() + 900;
  render(ui);
  scrollNoteIntoView(note);
}

function scrollNoteIntoView(note: NoteItem): void {
  const range = toLiveRange(note.range);
  if (!range) return;

  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height) {
    const targetY = rect.top - window.innerHeight * 0.35;
    window.scrollBy({
      top: targetY,
      behavior: "smooth",
    });
    return;
  }

  const container = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  container?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function handleViewportScroll(ui: UiRefs): void {
  if (state.activeNoteId && Date.now() > suppressActiveScrollClearUntil) {
    state.activeNoteId = null;
  }
  scheduleRender(ui);
}

function clearActiveNoteFromUserScroll(ui: UiRefs): void {
  if (!state.activeNoteId) return;
  state.activeNoteId = null;
  suppressActiveScrollClearUntil = 0;
  scheduleRender(ui);
}

function renderHighlights(): void {
  const cssHighlights = (CSS as unknown as { highlights?: MapLike }).highlights;
  if (!cssHighlights) return;

  const activeNote = state.notes.find((note) => note.id === state.activeNoteId);
  const baseRanges = state.notes
    .filter((note) => note.id !== activeNote?.id)
    .map((note) => note.range);

  cssHighlights.set(HIGHLIGHT_NAME, new Highlight(...baseRanges));
  cssHighlights.set(
    ACTIVE_HIGHLIGHT_NAME,
    activeNote ? new Highlight(activeNote.range) : new Highlight(),
  );
}

function pickSide(rect: DOMRect): NoteSide {
  const spaceLeft = rect.left;
  const spaceRight = window.innerWidth - rect.right;
  return spaceRight >= spaceLeft ? "right" : "left";
}

function getPopoverLeft(side: NoteSide, rect: DOMRect): number {
  if (side === "right") {
    return clamp(rect.right + POPOVER_GAP, 12, window.innerWidth - POPOVER_WIDTH - 12);
  }

  return clamp(
    rect.left - POPOVER_WIDTH - POPOVER_GAP,
    12,
    window.innerWidth - POPOVER_WIDTH - 12,
  );
}

function getDraftTriggerX(rect: DOMRect, side: NoteSide): number {
  if (side === "right") {
    return clamp(rect.right + POPOVER_GAP, 12, window.innerWidth - 24 - 12);
  }

  return clamp(rect.left - 24 - POPOVER_GAP, 12, window.innerWidth - 24 - 12);
}

function getRangeRect(rangeLike: StaticRange | Range): DOMRect | null {
  const range = toLiveRange(rangeLike);
  if (!range) return null;

  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return rect;
}

function getSelectionTailRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
  return rects.at(-1) ?? null;
}

function toLiveRange(rangeLike: StaticRange | Range): Range | null {
  if (rangeLike instanceof Range) {
    return rangeLike.cloneRange();
  }

  try {
    const range = document.createRange();
    range.setStart(rangeLike.startContainer, rangeLike.startOffset);
    range.setEnd(rangeLike.endContainer, rangeLike.endOffset);
    return range;
  } catch {
    return null;
  }
}

function focusActiveField(ui: UiRefs): void {
  if (!state.activeNoteId) return;

  window.requestAnimationFrame(() => {
    const input = ui.shadow.querySelector("textarea[data-field='comment']") as HTMLTextAreaElement | null;
    autosizeNoteField(input);
    input?.focus();
    input?.select();
  });
}

function cancelDraftFocus(): void {
  draftFocusVersion += 1;
  if (!draftFocusFrame) return;

  window.cancelAnimationFrame(draftFocusFrame);
  draftFocusFrame = 0;
}

function focusDraftField(
  ui: UiRefs,
  draftKey: string,
  field: HTMLTextAreaElement,
): void {
  cancelDraftFocus();
  const version = draftFocusVersion;

  draftFocusFrame = window.requestAnimationFrame(() => {
    draftFocusFrame = 0;
    if (version !== draftFocusVersion) return;

    const draft = state.selectionDraft;
    if (
      !draft ||
      !state.draftEditorOpen ||
      getSelectionDraftKey(draft) !== draftKey
    ) {
      return;
    }

    const currentField = ui.popoverLayer.querySelector<HTMLTextAreaElement>(
      "textarea[data-field='draft']",
    );
    if (currentField !== field || !field.isConnected) return;

    autosizeNoteField(field);
    field.focus({ preventScroll: true });
    const caret = field.value.length;
    field.setSelectionRange(caret, caret);
  });
}

function autosizeNoteField(field: HTMLTextAreaElement | HTMLInputElement | null): void {
  if (!(field instanceof HTMLTextAreaElement)) return;

  const computed = window.getComputedStyle(field);
  const lineHeight = parseFloat(computed.lineHeight) || 18;
  const padding = parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);
  const border = parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
  const maxHeight = lineHeight * NOTE_MAX_ROWS + padding + border;

  field.style.height = "0px";
  const nextHeight = Math.min(field.scrollHeight, maxHeight);
  field.style.height = `${nextHeight}px`;
  field.style.overflowY = field.scrollHeight > maxHeight ? "auto" : "hidden";
}

function scheduleRender(ui: UiRefs): void {
  if (renderFrame) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    render(ui);
  });
}

function clearSelectionDraft(forgetStored = true): void {
  if (forgetStored) currentAnnotationSession().draft = null;
  cancelDraftFocus();
  selectionVersion += 1;
  if (selectionSettleTimer) {
    clearTimeout(selectionSettleTimer);
    selectionSettleTimer = null;
  }
  state.selectionDraft = null;
  state.draftEditorOpen = false;
  state.draftText = "";
  const selection = document.getSelection();
  selection?.removeAllRanges();
}

function getOrderedNotes(): NoteItem[] {
  return [...state.notes].sort((a, b) => a.createdAt - b.createdAt);
}

function findAssistantMessage(node: Node | null): HTMLElement | null {
  return findAssistantMessageElement(node);
}

function ensureMessageId(message: HTMLElement): string {
  let id = message.getAttribute(MESSAGE_ID_ATTR);
  if (!id) {
    id = buildStableMessageId(message);
    message.setAttribute(MESSAGE_ID_ATTR, id);
  }
  return id;
}

function buildStableMessageId(message: HTMLElement): string {
  const provided = getAssistantMessageId(message);
  if (provided) return provided;

  const assistantMessages = getAssistantMessages();
  const index = assistantMessages.indexOf(message);
  const excerpt = collapseWhitespace(getNodeText(message)).slice(0, 96);
  return `assistant-${index}-${hashText(excerpt)}`;
}

function getAssistantMessages(): HTMLElement[] {
  return getAssistantMessageElements();
}

function isInsideRoot(node: Node | null): boolean {
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  if (!element) return false;
  return Boolean(element.closest(`#${ROOT_ID}`));
}

function createStableRange(range: Range): StaticRange | Range {
  try {
    return new StaticRange({
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset,
    });
  } catch {
    return range.cloneRange();
  }
}

function getOffsetsWithin(container: HTMLElement, range: Range): { start: number; end: number } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let start = 0;
  let end = 0;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const textLength = textNode.textContent?.length ?? 0;

    if (textNode === range.startContainer) {
      start = offset + range.startOffset;
    }
    if (textNode === range.endContainer) {
      end = offset + range.endOffset;
      break;
    }

    offset += textLength;
  }

  if (end < start) {
    end = start + range.toString().length;
  }

  return { start, end };
}

function getNodeText(container: HTMLElement): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text = "";
  while (walker.nextNode()) {
    text += walker.currentNode.textContent ?? "";
  }
  return text;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInline(value: string, maxLength: number): string {
  const trimmed = collapseWhitespace(value);
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectContent(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isDraftInputFocused(ui: UiRefs): boolean {
  const active = ui.shadow.activeElement;
  return (
    active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement
  ) && active.dataset.field === "draft";
}

function getConversationStorageKey(): string {
  return `${STORAGE_KEY_PREFIX}${window.location.origin}${window.location.pathname}`;
}

function readPersistedConversationState(storageKey: string): PersistedNoteItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      if (!isPersistedNoteItem(entry)) {
        return [];
      }
      return [entry];
    });
  } catch {
    return [];
  }
}

function isPersistedNoteItem(value: unknown): value is PersistedNoteItem {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<PersistedNoteItem>;
  return typeof candidate.id === "string" &&
    typeof candidate.messageId === "string" &&
    typeof candidate.messageExcerpt === "string" &&
    typeof candidate.quote === "string" &&
    typeof candidate.comment === "string" &&
    typeof candidate.contextBefore === "string" &&
    typeof candidate.contextAfter === "string" &&
    (candidate.startOffset === undefined || typeof candidate.startOffset === "number") &&
    (candidate.endOffset === undefined || typeof candidate.endOffset === "number") &&
    typeof candidate.createdAt === "number";
}

function serializePersistedNotes(): PersistedNoteItem[] {
  return getOrderedNotes().map(serializeNote);
}

function serializeNote(note: NoteItem): PersistedNoteItem {
  return {
    id: note.id,
    messageId: note.messageId,
    messageExcerpt: note.messageExcerpt,
    quote: note.quote,
    comment: note.comment,
    contextBefore: note.contextBefore,
    contextAfter: note.contextAfter,
    startOffset: note.startOffset,
    endOffset: note.endOffset,
    createdAt: note.createdAt,
  };
}

function scheduleRestorePendingNotes(ui: UiRefs): void {
  if (restoreFrame) return;

  restoreFrame = window.requestAnimationFrame(() => {
    restoreFrame = 0;
    restorePendingNotes(ui);
  });
}

function restorePendingNotes(ui: UiRefs): void {
  if (pendingRestoreNotes.length === 0) {
    stopRestoreObserver();
    render(ui);
    return;
  }

  const nextNotes = new Map(state.notes.map((note) => [note.id, note]));
  const unresolved: PersistedNoteItem[] = [];
  let upgradedPersistedState = false;

  for (const persisted of pendingRestoreNotes) {
    if (nextNotes.has(persisted.id)) continue;

    const restored = restorePersistedNote(persisted);
    if (!restored) {
      unresolved.push(persisted);
      continue;
    }

    nextNotes.set(restored.id, restored);
    if (!hasStoredOffsets(persisted) || restored.quote !== persisted.quote) {
      upgradedPersistedState = true;
    }
  }

  state.notes = Array.from(nextNotes.values()).sort((a, b) => a.createdAt - b.createdAt);
  pendingRestoreNotes = unresolved;
  render(ui);

  // Restoring ranges is not a note edit. Preserve the durable record until an
  // explicit mutation instead of rewriting snapshots that omit unloaded notes.

  if (pendingRestoreNotes.length > 0) {
    ensureRestoreObserver(ui);
  } else {
    stopRestoreObserver();
  }
}

function ensureRestoreObserver(ui: UiRefs): void {
  if (restoreObserver || !document.body) return;

  restoreObserver = new MutationObserver(() => {
    scheduleRestorePendingNotes(ui);
  });
  restoreObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function stopRestoreObserver(): void {
  if (restoreFrame) {
    window.cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
  }

  restoreObserver?.disconnect();
  restoreObserver = null;
}

function restorePersistedNote(persisted: PersistedNoteItem): NoteItem | null {
  const message = findMessageForPersistedNote(persisted);
  if (!message) return null;

  const restored = findPersistedSelectionInMessage(message, persisted);
  if (!restored) return null;

  return {
    ...persisted,
    messageId: ensureMessageId(message),
    quote: restored.quote,
    startOffset: restored.startOffset,
    endOffset: restored.endOffset,
    range: createStableRange(restored.range),
  };
}

function findMessageForPersistedNote(note: PersistedNoteItem): HTMLElement | null {
  const direct = findAssistantMessageById(note.messageId);
  if (direct) return direct;

  const noteExcerpt = collapseWhitespace(note.messageExcerpt);
  let bestMatch: HTMLElement | null = null;
  let bestScore = -1;

  for (const message of getAssistantMessages()) {
    const text = collapseWhitespace(getNodeText(message));

    let score = 0;
    if (noteExcerpt && text.includes(noteExcerpt)) score += noteExcerpt.length * 2;
    if (note.quote && text.includes(collapseWhitespace(note.quote))) {
      score += Math.min(collapseWhitespace(note.quote).length, 240);
    }
    if (note.contextBefore && text.includes(collapseWhitespace(note.contextBefore))) {
      score += note.contextBefore.length;
    }
    if (note.contextAfter && text.includes(collapseWhitespace(note.contextAfter))) {
      score += note.contextAfter.length;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = message;
    }
  }

  return bestMatch;
}

function findAssistantMessageById(messageId: string): HTMLElement | null {
  // Resolve IDs through recognized assistant bodies: the new ID attribute
  // sits on an outer wrapper and also appears on user messages.
  for (const message of getAssistantMessages()) {
    if (ensureMessageId(message) === messageId) {
      return message;
    }
  }

  return null;
}

function findPersistedSelectionInMessage(
  message: HTMLElement,
  note: PersistedNoteItem,
): { range: Range; quote: string; startOffset: number; endOffset: number } | null {
  const text = getNodeText(message);
  if (!text) return null;

  if (hasStoredOffsets(note)) {
    const range = createRangeFromOffsets(message, note.startOffset, note.endOffset);
    if (range && isRecoveredRangeMatch(range, note.quote)) {
      return {
        range,
        quote: collapseWhitespace(range.toString()) || note.quote,
        startOffset: note.startOffset,
        endOffset: note.endOffset,
      };
    }
  }

  const offsets = findPersistedOffsets(text, note);
  if (!offsets) return null;

  const range = createRangeFromOffsets(message, offsets.start, offsets.end);
  if (!range) return null;

  return {
    range,
    quote: collapseWhitespace(range.toString()) || note.quote,
    startOffset: offsets.start,
    endOffset: offsets.end,
  };
}

function isRecoveredRangeMatch(range: Range, quote: string): boolean {
  const recovered = stripWhitespace(range.toString());
  const expected = stripWhitespace(quote);
  return Boolean(recovered) && recovered === expected;
}

function findPersistedOffsets(
  rawText: string,
  note: Pick<PersistedNoteItem, "quote" | "contextBefore" | "contextAfter">,
): { start: number; end: number } | null {
  const normalizedQuote = collapseWhitespace(note.quote);
  if (!normalizedQuote) return null;
  const normalizedTokens = normalizedQuote.split(" ").filter(Boolean);

  const index = buildNormalizedTextIndex(rawText);
  if (!index.text) return null;

  const collapsedNote = {
    contextBefore: collapseWhitespace(note.contextBefore),
    contextAfter: collapseWhitespace(note.contextAfter),
  };
  const collapsedBest = findBestPersistedOffsetCandidate(
    index.text,
    normalizedQuote,
    normalizedTokens,
    collapsedNote,
    " ",
  );
  if (collapsedBest) {
    return toRawOffsets(index, rawText.length, collapsedBest.start, collapsedBest.end);
  }

  const compactIndex = buildWhitespaceFreeTextIndex(rawText);
  const compactQuote = stripWhitespace(note.quote);
  if (!compactIndex.text || !compactQuote) return null;

  const compactBest = findBestPersistedOffsetCandidate(
    compactIndex.text,
    compactQuote,
    normalizedTokens,
    {
      contextBefore: stripWhitespace(note.contextBefore),
      contextAfter: stripWhitespace(note.contextAfter),
    },
    "",
  );
  if (!compactBest) return null;

  return toRawOffsets(compactIndex, rawText.length, compactBest.start, compactBest.end);
}

function findBestPersistedOffsetCandidate(
  normalizedText: string,
  normalizedQuote: string,
  quoteTokens: string[],
  note: Pick<PersistedNoteItem, "contextBefore" | "contextAfter">,
  fragmentJoiner: string,
): { start: number; end: number; score: number } | null {
  let best: { start: number; end: number; score: number } | null = null;
  let searchFrom = 0;

  while (searchFrom < normalizedText.length) {
    const start = normalizedText.indexOf(normalizedQuote, searchFrom);
    if (start === -1) break;

    const end = start + normalizedQuote.length;
    const score = scorePersistedOffsetCandidate(normalizedText, start, end, note);
    if (!best || score > best.score) {
      best = { start, end, score };
    }

    searchFrom = start + Math.max(1, normalizedQuote.length);
  }

  if (best) return best;

  return findPersistedOffsetsFromQuoteFragments(normalizedText, quoteTokens, note, fragmentJoiner);
}

function scorePersistedOffsetCandidate(
  normalizedText: string,
  start: number,
  end: number,
  note: Pick<PersistedNoteItem, "contextBefore" | "contextAfter">,
): number {
  const before = collapseWhitespace(note.contextBefore);
  const after = collapseWhitespace(note.contextAfter);
  const beforeWindow = normalizedText.slice(Math.max(0, start - before.length), start);
  const afterWindow = normalizedText.slice(end, end + after.length);

  return countMatchingSuffix(beforeWindow, before) * 2 + countMatchingPrefix(afterWindow, after) * 2;
}

function findPersistedOffsetsFromQuoteFragments(
  normalizedText: string,
  quoteTokens: string[],
  note: Pick<PersistedNoteItem, "contextBefore" | "contextAfter">,
  joiner: string,
): { start: number; end: number; score: number } | null {
  if (quoteTokens.length === 0) return null;

  const maxWindow = Math.min(quoteTokens.length, 14);
  const minWindow = Math.min(maxWindow, 3);
  let best: { start: number; end: number; score: number } | null = null;

  for (let windowSize = maxWindow; windowSize >= minWindow; windowSize -= 1) {
    for (let tokenStart = 0; tokenStart + windowSize <= quoteTokens.length; tokenStart += 1) {
      const fragment = quoteTokens.slice(tokenStart, tokenStart + windowSize).join(joiner);
      let searchFrom = 0;

      while (searchFrom < normalizedText.length) {
        const start = normalizedText.indexOf(fragment, searchFrom);
        if (start === -1) break;

        const end = start + fragment.length;
        const score = scorePersistedOffsetCandidate(normalizedText, start, end, note) +
          fragment.length * 4 -
          tokenStart;

        if (!best || score > best.score) {
          best = { start, end, score };
        }

        searchFrom = start + Math.max(1, fragment.length);
      }
    }

    if (best) {
      return best;
    }
  }

  return null;
}

function countMatchingSuffix(actual: string, expected: string): number {
  let matched = 0;
  let actualIndex = actual.length - 1;
  let expectedIndex = expected.length - 1;

  while (actualIndex >= 0 && expectedIndex >= 0) {
    if (actual[actualIndex] !== expected[expectedIndex]) break;
    matched += 1;
    actualIndex -= 1;
    expectedIndex -= 1;
  }

  return matched;
}

function countMatchingPrefix(actual: string, expected: string): number {
  let matched = 0;
  const length = Math.min(actual.length, expected.length);
  while (matched < length) {
    if (actual[matched] !== expected[matched]) break;
    matched += 1;
  }

  return matched;
}

function buildNormalizedTextIndex(rawText: string): { text: string; rawByNormalized: number[] } {
  let text = "";
  const rawByNormalized: number[] = [];
  let wroteNonWhitespace = false;
  let previousWasWhitespace = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];
    if (/\s/.test(character)) {
      if (!wroteNonWhitespace || previousWasWhitespace) continue;
      text += " ";
      rawByNormalized.push(index);
      previousWasWhitespace = true;
      continue;
    }

    text += character;
    rawByNormalized.push(index);
    wroteNonWhitespace = true;
    previousWasWhitespace = false;
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    rawByNormalized.pop();
  }

  return { text, rawByNormalized };
}

function buildWhitespaceFreeTextIndex(rawText: string): { text: string; rawByNormalized: number[] } {
  let text = "";
  const rawByNormalized: number[] = [];

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];
    if (/\s/.test(character)) {
      continue;
    }

    text += character;
    rawByNormalized.push(index);
  }

  return { text, rawByNormalized };
}

function toRawOffsets(
  index: { rawByNormalized: number[] },
  rawTextLength: number,
  normalizedStart: number,
  normalizedEnd: number,
): { start: number; end: number } | null {
  const rawStart = index.rawByNormalized[normalizedStart];
  const rawEnd = normalizedEnd < index.rawByNormalized.length
    ? index.rawByNormalized[normalizedEnd]
    : rawTextLength;

  if (typeof rawStart !== "number") return null;
  return {
    start: rawStart,
    end: Math.max(rawStart + 1, rawEnd),
  };
}

function createRangeFromOffsets(container: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let totalOffset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const length = node.textContent?.length ?? 0;
    const nextOffset = totalOffset + length;
    lastTextNode = node;

    if (!startNode && start <= nextOffset) {
      startNode = node;
      startOffset = clamp(start - totalOffset, 0, length);
    }

    if (!endNode && end <= nextOffset) {
      endNode = node;
      endOffset = clamp(end - totalOffset, 0, length);
      break;
    }

    totalOffset = nextOffset;
  }

  if (!startNode) return null;

  if (!endNode) {
    if (!lastTextNode) return null;
    endNode = lastTextNode;
    endOffset = lastTextNode.textContent?.length ?? 0;
  }

  if (startNode === endNode && endOffset <= startOffset) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range.collapsed ? null : range;
}

function hasStoredOffsets(note: PersistedNoteItem): note is PersistedNoteItem & {
  startOffset: number;
  endOffset: number;
} {
  return typeof note.startOffset === "number" &&
    typeof note.endOffset === "number" &&
    note.endOffset > note.startOffset;
}

function looksLikePlannotatorPrompt(value: string): boolean {
  if (state.notes.length === 0) return false;

  const normalizedComposer = normalizePromptMatch(value);
  const normalizedPrompt = normalizePromptMatch(buildPrompt());
  if (!normalizedComposer || !normalizedPrompt) return false;

  return normalizedComposer.includes(normalizedPrompt);
}

function formatPromptValue(value: string): string {
  return JSON.stringify(collapseWhitespace(value));
}

function normalizePromptMatch(value: string): string {
  return value.replace(/\s+/g, "");
}

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash).toString(36);
}

interface MapLike {
  set(name: string, highlight: Highlight): void;
}

function setDevReloadState(value: string): void {
  if (!__PLANNOTATOR_DEV__) return;
  const host = document.getElementById(ROOT_ID);
  if (host) {
    host.dataset.reloadState = value;
  }
}

function clearActionFeedback(): void {
  state.actionFeedback = "idle";
  if (actionFeedbackTimer) {
    clearTimeout(actionFeedbackTimer);
    actionFeedbackTimer = null;
  }
}

function showInsertSuccess(ui: UiRefs): void {
  clearActionFeedback();
  state.actionFeedback = "inserted";
  actionFeedbackTimer = window.setTimeout(() => {
    state.actionFeedback = "idle";
    actionFeedbackTimer = null;
    render(ui);
  }, ACTION_SUCCESS_MS);
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

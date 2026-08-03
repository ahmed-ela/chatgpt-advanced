type ComposerElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;
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
};

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
let sendClearTimer: number | null = null;
let suppressActiveScrollClearUntil = 0;

if (window.top === window) {
  bootstrap();
}

function bootstrap(): void {
  if (document.getElementById(ROOT_ID)) return;

  ensurePageStyles();
  const ui = createUi();
  startDevHotReload();
  startConversationPersistence(ui);
  startDomRefreshObserver(ui);

  document.addEventListener("selectionchange", () => {
    if (selectionFrame) return;
    selectionFrame = window.requestAnimationFrame(() => {
      selectionFrame = 0;
      syncSelectionDraft(ui);
    });
  }, true);

  document.addEventListener("keydown", (event) => {
    const origin = event.composedPath()[0];
    const target = origin instanceof HTMLElement ? origin : null;
    const draftField = (
      target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    ) && target.dataset.field === "draft";

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
  document.addEventListener("submit", () => {
    queueNativeSendClear(ui, "submit");
  }, true);
  document.addEventListener("click", (event) => {
    if (!hasNativeSendButtonInPath(event.composedPath())) return;
    queueNativeSendClear(ui, "button");
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!isNativeComposerSendKey(event)) return;
    queueNativeSendClear(ui, "enter");
  }, true);
  window.addEventListener("pagehide", () => {
    flushPersistedConversationState({ preserveExistingOnEmpty: true });
  }, { capture: true });

  render(ui);
  void loadPersistedConversationState(ui);
}

function startDevHotReload(): void {
  if (!DEV_ENABLED || !DEV_ORIGIN) return;

  const runtime = (
    globalThis as typeof globalThis & {
      chrome?: {
        runtime?: {
          onMessage?: {
            addListener?: (callback: (message: { type?: string; buildId?: string }) => void) => void;
          };
          sendMessage?: (message: unknown) => Promise<unknown> | void;
        };
      };
    }
  ).chrome?.runtime;

  if (!runtime?.sendMessage) return;
  const sendMessage = runtime.sendMessage.bind(runtime);
  setDevReloadState("polling");

  let pendingReload = false;
  let reloadTimer = 0;

  const schedulePageReload = (delayMs = 220): void => {
    if (reloadTimer) return;
    setDevReloadState("page-reload-scheduled");
    reloadTimer = window.setTimeout(() => {
      setDevReloadState("page-reloading");
      window.location.reload();
    }, delayMs);
  };

  runtime.onMessage?.addListener?.((message) => {
    if (message?.type !== "plannotator:dev-page-reload") {
      return;
    }

    pendingReload = true;
    setDevReloadState("page-reload-message");
    schedulePageReload();
  });

  const poll = async (): Promise<void> => {
    if (pendingReload) return;

    try {
      const response = await fetch(`${DEV_ORIGIN}${DEV_VERSION_PATH}?t=${Date.now()}`, {
        cache: "no-store",
      });

      if (!response.ok) return;

      const payload = await response.json() as { buildId?: string };
      if (!payload.buildId || payload.buildId === DEV_BUILD_ID) {
        return;
      }

      pendingReload = true;
      setDevReloadState(`build-change:${payload.buildId}`);
      try {
        void Promise.resolve(sendMessage({
          type: "plannotator:dev-reload",
          buildId: payload.buildId,
        })).catch(() => {
          pendingReload = false;
          setDevReloadState("reload-request-failed");
        });
        setDevReloadState(`reload-requested:${payload.buildId}`);
        schedulePageReload(runtime.onMessage?.addListener ? 420 : 260);
      } catch {
        pendingReload = false;
        setDevReloadState("reload-request-threw");
      }
    } catch {
      // Dev server is optional; keep the production path silent.
    }
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
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: white;
        box-sizing: border-box;
        animation: notes-action-spin 720ms linear infinite;
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
    throw new Error("Plannotator extension failed to initialize its UI");
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

    if (target.closest("[data-action='open-draft']")) {
      return;
    }

    if (target.closest("[data-action='insert-notes']")) {
      return;
    }

    if (target.closest("[data-action='toggle-notes-menu']")) {
      if (state.notes.length === 0) return;
      state.notesMenuOpen = !state.notesMenuOpen;
      render(ui);
      return;
    }

    const jumpTarget = target.closest<HTMLElement>("[data-action='jump-note']");
    if (jumpTarget?.dataset.noteId) {
      jumpToNote(jumpTarget.dataset.noteId, ui);
      return;
    }

    if (target.dataset.action === "delete-note") {
      const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      if (!noteId) return;
      deleteNote(noteId);
      render(ui);
      return;
    }

    return;
  });

  shadow.addEventListener("input", (event) => {
    const target = event.target as HTMLTextAreaElement | HTMLInputElement | null;
    if (!target) return;

    if (target.dataset.field === "draft") {
      state.draftText = target.value;
      autosizeNoteField(target);
      return;
    }

    const noteId = target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
    if (!noteId) return;
    updateNote(noteId, { comment: target.value });
    autosizeNoteField(target);
  });

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

  if (changed) {
    schedulePersistedConversationState();
  }
}

function renderMarkers(ui: UiRefs): void {
  ui.markersLayer.innerHTML = "";
}

function renderActions(ui: UiRefs): void {
  const isLoading = state.actionFeedback === "loading";
  const isSuccess = state.actionFeedback === "inserted";
  if (state.notes.length === 0 && !isLoading && !isSuccess) {
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

  const menu = state.notesMenuOpen && state.notes.length > 0
    ? renderNotesMenu()
    : "";
  const toggleButton = state.notes.length > 0
    ? `
    <button
      class="notes-list-toggle${state.notesMenuOpen ? " active" : ""}"
      data-action="toggle-notes-menu"
      type="button"
      title="Show notes"
      aria-label="Show notes"
      aria-expanded="${state.notesMenuOpen ? "true" : "false"}"
    >${state.notes.length}</button>
  `
    : "";

  ui.actionsLayer.innerHTML = `
    <div class="notes-toolbar" style="bottom:${bottom}px;">
      ${menu}
      ${toggleButton}
    <button
      class="notes-action${isLoading ? " loading" : ""}${isSuccess ? " success" : ""}"
      data-action="insert-notes"
      type="button"
      title="${isLoading ? "Inserting into ChatGPT" : isSuccess ? "Inserted into ChatGPT" : "Insert notes into ChatGPT"}"
      aria-label="${isLoading ? "Inserting into ChatGPT" : isSuccess ? "Inserted into ChatGPT" : "Insert notes into ChatGPT"}"
      data-state="${isLoading ? "loading" : isSuccess ? "success" : "idle"}"
      ${isLoading || isSuccess ? "disabled" : ""}
    >
      ${isLoading
        ? `<span class="notes-action-spinner" aria-hidden="true"></span>`
        : isSuccess
        ? `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6.55 11.64 2.91 8l1.06-1.06 2.58 2.58 5.48-5.48L13.09 5.1z"/>
      </svg>`
        : `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M2 8.75h7.19L6.47 11.47 7.53 12.53 12.06 8 7.53 3.47 6.47 4.53 9.19 7.25H2z"/>
      </svg>`}
    </button>
    </div>
  `;
}

function renderNotesMenu(): string {
  return `
    <section class="notes-menu" aria-label="Saved notes">
      ${getOrderedNotes().map((note, index) => `
        <button
          class="notes-menu-row${note.id === state.activeNoteId ? " active" : ""}"
          data-action="jump-note"
          data-note-id="${note.id}"
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
      >+</button>
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
  schedulePersistedConversationState();
}

function updateNote(noteId: string, updates: Partial<Pick<NoteItem, "comment">>): void {
  const note = state.notes.find((entry) => entry.id === noteId);
  if (!note) return;

  if (updates.comment !== undefined) {
    note.comment = updates.comment;
  }

  schedulePersistedConversationState();
}

function deleteNote(noteId: string): void {
  const remaining = getOrderedNotes().filter((note) => note.id !== noteId);
  state.notes = remaining;
  if (state.activeNoteId === noteId) {
    state.activeNoteId = remaining.at(-1)?.id ?? null;
  }
  schedulePersistedConversationState();
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
  schedulePersistedConversationState();
}

function clearAllNotes(): void {
  state.notes = [];
  state.activeNoteId = null;
  state.notesMenuOpen = false;
  pendingRestoreNotes = [];
  stopRestoreObserver();
  clearSelectionDraft();

  const cssHighlights = (CSS as unknown as { highlights?: MapLike }).highlights;
  cssHighlights?.set(HIGHLIGHT_NAME, new Highlight());
  cssHighlights?.set(ACTIVE_HIGHLIGHT_NAME, new Highlight());
  schedulePersistedConversationState();
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
  if (state.notes.length === 0 || state.actionFeedback === "loading") {
    return;
  }

  const composer = findComposer();
  if (!composer) {
    console.warn("[Plannotator] Composer not found.");
    return;
  }

  clearActionFeedback();
  state.actionFeedback = "loading";
  render(ui);
  await nextPaint();

  const prompt = buildPrompt();
  clearAllNotes();
  flushPersistedConversationState();
  setComposerText(composer, prompt);
  showInsertSuccess(ui);
  render(ui);
}

function startConversationPersistence(ui: UiRefs): void {
  currentConversationKey = getConversationStorageKey();
  if (conversationPollTimer) return;

  conversationPollTimer = window.setInterval(() => {
    const nextKey = getConversationStorageKey();
    if (nextKey === currentConversationKey) return;

    flushPersistedConversationState({ preserveExistingOnEmpty: true });
    stopRestoreObserver();
    pendingRestoreNotes = [];
    clearActionFeedback();
    clearSelectionDraft();
    state.notes = [];
    state.activeNoteId = null;
    state.notesMenuOpen = false;
    currentConversationKey = nextKey;
    render(ui);
    void loadPersistedConversationState(ui);
  }, CONVERSATION_POLL_MS);
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
  currentConversationKey = getConversationStorageKey();
  pendingRestoreNotes = readPersistedConversationState(currentConversationKey);
  state.notes = [];
  state.activeNoteId = null;
  state.notesMenuOpen = false;

  if (pendingRestoreNotes.length === 0) {
    stopRestoreObserver();
    render(ui);
    return;
  }

  scheduleRestorePendingNotes(ui);
}

function schedulePersistedConversationState(): void {
  currentConversationKey ??= getConversationStorageKey();
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    flushPersistedConversationState();
  }, PERSIST_DEBOUNCE_MS);
}

function flushPersistedConversationState(options: { preserveExistingOnEmpty?: boolean } = {}): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  currentConversationKey ??= getConversationStorageKey();
  if (!currentConversationKey) return;

  try {
    const payload = serializePersistedNotes();
    if (payload.length === 0) {
      if (!options.preserveExistingOnEmpty) {
        window.localStorage.removeItem(currentConversationKey);
      }
      return;
    }

    window.localStorage.setItem(currentConversationKey, JSON.stringify(payload));
  } catch {
    // Ignore storage failures to keep note-taking fast.
  }
}

function queueNativeSendClear(ui: UiRefs, trigger: "button" | "enter" | "submit"): void {
  if (state.notes.length === 0) return;

  if (trigger === "enter" && !canComposerSend()) {
    return;
  }

  if (sendClearTimer) {
    clearTimeout(sendClearTimer);
  }

  sendClearTimer = window.setTimeout(() => {
    sendClearTimer = null;
    clearActionFeedback();
    clearAllNotes();
    flushPersistedConversationState();
    render(ui);
  }, trigger === "button" ? 0 : 90);
}

function hasNativeSendButtonInPath(path: Array<EventTarget | undefined>): boolean {
  return path.some((entry) => entry instanceof Element && isNativeSendButton(entry));
}

function canComposerSend(): boolean {
  const composer = findComposer();
  const composerText = composer ? normalizePromptMatch(getComposerText(composer)) : "";
  if (composerText) {
    return true;
  }

  const sendButton = document.querySelector<HTMLElement>([
    "#composer-submit-button",
    "#send-button",
    "[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']",
    "button[aria-label='Send']",
  ].join(","));

  if (!sendButton) {
    return false;
  }

  const ariaDisabled = sendButton.getAttribute("aria-disabled");
  const isDisabled = sendButton instanceof HTMLButtonElement ? sendButton.disabled : false;
  return !isDisabled && ariaDisabled !== "true";
}

function isNativeSendButton(target: Element): boolean {
  return Boolean(target.closest([
    "#composer-submit-button",
    "#send-button",
    "[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']",
    "button[aria-label='Send']",
    "button[class*='send']",
  ].join(",")));
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

  if (target === composer) return true;
  if (composer instanceof HTMLElement && composer.contains(target)) {
    return true;
  }

  return Boolean(target.closest([
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "form[data-type='unified-composer']",
    "form.group\\/composer",
  ].join(",")));
}


function findComposer(): ComposerElement | null {
  const selectors = [
    "form[data-type='unified-composer'] #prompt-textarea",
    "form.group\\/composer #prompt-textarea",
    "[data-composer-surface='true'] #prompt-textarea",
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "div[contenteditable='true'][id='prompt-textarea']",
    "div[contenteditable='true'][data-testid='prompt-textarea']",
    "form[data-type='unified-composer'] textarea",
    "form.group\\/composer textarea",
    "form[data-type='unified-composer'] div[contenteditable='true']",
    "form.group\\/composer div[contenteditable='true']",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element;
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      return element;
    }
  }

  return null;
}

function getComposerText(element: ComposerElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  return element.textContent ?? "";
}

function setComposerText(element: ComposerElement, value: string): void {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = Object.getPrototypeOf(element) as { value?: PropertyDescriptor };
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.focus();
    return;
  }

  element.focus();
  selectContent(element);
  const inserted = document.execCommand("insertText", false, value);
  if (!inserted) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: value,
      inputType: "insertText",
    }));
  }
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

function clearSelectionDraft(): void {
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
  const element = node instanceof HTMLElement
    ? node
    : node?.parentElement ?? null;
  if (!element) return null;

  const direct = element.closest<HTMLElement>("[data-message-author-role='assistant']");
  if (direct) return direct;

  return element.closest<HTMLElement>("article[data-message-author-role='assistant']");
}

function ensureMessageId(message: HTMLElement): string {
  let id = message.getAttribute(MESSAGE_ID_ATTR);
  if (!id) {
    id = message.getAttribute("data-message-id") ?? buildStableMessageId(message);
    message.setAttribute(MESSAGE_ID_ATTR, id);
  }
  return id;
}

function buildStableMessageId(message: HTMLElement): string {
  const provided = message.getAttribute("data-message-id");
  if (provided) return provided;

  const assistantMessages = getAssistantMessages();
  const index = assistantMessages.indexOf(message);
  const excerpt = collapseWhitespace(getNodeText(message)).slice(0, 96);
  return `assistant-${index}-${hashText(excerpt)}`;
}

function getAssistantMessages(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-message-author-role='assistant'], article[data-message-author-role='assistant']",
    ),
  );
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
  return getOrderedNotes().map((note) => ({
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
  }));
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

  if (upgradedPersistedState) {
    schedulePersistedConversationState();
  }

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
  const escaped = escapeSelectorValue(messageId);

  const direct = document.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`) ??
    document.querySelector<HTMLElement>(`[${MESSAGE_ID_ATTR}="${escaped}"]`);
  if (direct) {
    direct.setAttribute(MESSAGE_ID_ATTR, messageId);
    return direct;
  }

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

function escapeSelectorValue(value: string): string {
  const cssApi = CSS as typeof CSS & { escape?: (text: string) => string };
  return cssApi.escape ? cssApi.escape(value) : value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
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
  if (!DEV_ENABLED) return;
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

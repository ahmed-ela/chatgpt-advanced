# Plannotator ChatGPT Notes

A Manifest V3 Chrome extension for annotating assistant responses and queuing follow-ups on ChatGPT (`chatgpt.com`), Claude (`claude.ai`), and Gemini (`gemini.google.com`). The installed extension name remains **Plannotator ChatGPT Notes**.

## What It Does

- Select assistant text and add inline notes
- Collapse saved notes into side pills beside the selected span
- Insert the generated revision prompt into the chat's native composer
- Queue text messages while the assistant is responding, using Enter or **Queue message**
- Hover a queued message to fade its number into a six-dot drag handle, then drag it to reorder; edit/remove messages and pause/resume sending
- Share one durable queue per conversation across tabs in the same Chrome profile
- Hot-reload during development without manually reloading the extension each edit

## Message queue

Open an existing ChatGPT, Claude, or Gemini conversation. While the native send control shows **Stop**, type a message and press Enter (Shift+Enter still inserts a line break), or click **Queue message** above the composer. The queue saves each message before clearing the draft. The native Stop control continues to stop generation.

Messages send in order as soon as the assistant's completed response and native composer are ready, with no fixed cooldown. Completion is detected from page changes; polling is a fallback. A tab showing that conversation must be visible with an empty composer. Typing a new draft holds automatic sending in that tab; another visible tab with an empty composer can still send. Queue or clear the draft to continue in that tab, or use Pause to hold the shared queue. A message disappears from the stack and count as soon as its send is confirmed. The extension still tracks that response internally and waits for it to finish before automatically sending the next message. Pause prevents the next automatic send. Queues are separate for each chat; a brand-new chat gets a queue after the site assigns it a stable conversation URL: `/c/<id>` on ChatGPT, `/chat/<id>` on Claude, or `/app/<id>` on Gemini. Home and new-chat pages have no durable queue yet. Matching IDs on different sites stay in separate queues; existing ChatGPT queue data is preserved.

Each queued message has **Send now**, **Edit** (pencil), and **Delete** (trash) controls. Send now stops the current response, if necessary, and sends the selected message once; other messages keep their relative order, and the queue keeps its pause/resume preference. It requires an empty composer. The pencil loads the saved text into the native composer while reserving that same queue slot across tabs. Press Enter, native Send, or **Save edit** to save the revision back into its original position. **Cancel edit** restores the original saved text and clears that edit from the composer. Existing composer drafts are never overwritten. If an editing tab disappears, the original saved message stays in the queue and the queue pauses when its editing reservation expires.

The extension stores queues in its own IndexedDB database with strict transaction durability. Queued messages, order, saved edits, and pause state survive page reloads, tab closures, worker restarts, and browser restarts in the same profile. Edits in an open queue editor are not persisted until you press Enter, click native Send, or click Save edit. Reopen the conversation to continue; the extension cannot send while Chrome or every tab for that conversation is closed. This is local persistence, not sync between devices or Chrome profiles. Removing the extension or clearing its storage removes queues.

Multiple tabs coordinate through atomic claims in the background worker. A message is marked as attempted **before** clicking the native send control. It is acknowledged only after a new user message with the expected text and a stable message ID appears. If delivery is uncertain, the stack stops on **Send unconfirmed** and retains the text. Check the chat, then retry or dismiss that item. Automatic retries are intentionally limited to claims that never reached the send-attempt stage.

The queue shows **Preparing…** while reserving and filling a message, then **Confirming send…** until its posted user message is observed and durably acknowledged. Page changes wake confirmation immediately; fallback polling handles missed events. A lost acknowledgement reply cannot turn an already-confirmed send into a retryable failure. Gemini's display-only line padding is removed when matching posted text, preserving blank lines and code indentation. Draft warnings disappear when the input is cleared.

The queue currently supports text. Composer attachments remain in place and block enqueueing or automatic dispatch, so files are not silently dropped. The chat's selected model and tools at dispatch time apply to the queued message.

## Commands

```bash
bun install
bun run build
bun run dev
bun run test:dom
bun run test:queue
bun test test/chatgpt-dom.test.ts test/queue-ui.test.ts
bun run e2e
bun run e2e:dev-reload
```

## Load In Chrome

1. Build the extension with `bun run build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Load unpacked from `dist/`

## One-command development reload

Run `bun run reload` to rebuild the extension and start a detached local watcher if one is not already running. It listens only on `127.0.0.1:19445` (or `PLANNOTATOR_EXTENSION_DEV_PORT`) and keeps rebuilding future source edits. Logs from a watcher started by this command go to `.local/plannotator-dev.log`.

One-time setup: after the first run, click **Reload** for Plannotator ChatGPT Notes in `chrome://extensions`, then refresh your supported chat pages to activate the development reload hook. Subsequent rebuilds check all connected extension pages before reloading, and defer while any page has a draft, active response, edit, or queue operation. The worker rechecks before the global reload; each page refreshes only after observing the installed worker build or its old context becoming invalid, and only when its own draft is safe. The command reports the verified build ID, not a verified browser reload.

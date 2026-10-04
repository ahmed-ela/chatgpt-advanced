# Threadlane

A Manifest V3 extension for Chrome and Firefox desktop, for annotating assistant responses and queuing follow-ups on ChatGPT (`chatgpt.com`), Claude (`claude.ai`), and Gemini (`gemini.google.com`). The extension is named **Threadlane** (formerly Plannotator ChatGPT Notes). Existing internal storage identifiers are retained so renaming an existing installation preserves its saved data. Firefox requires version 140 or later; see [Firefox packaging and testing](store/FIREFOX.md).

## What It Does

- Select assistant text and add inline notes
- Collapse saved notes into side pills beside the selected span
- Insert the generated revision prompt into the chat's native composer
- Queue text messages while the assistant is responding, using Enter or **Queue message**
- Hover a queued message to fade its number into a six-dot drag handle, then drag it to reorder; edit/remove messages and pause/resume sending
- Share one durable queue per conversation across tabs in the same browser profile
- Hot-reload Chrome during development without manually reloading the extension each edit

Interface icons use [Lucide](https://lucide.dev/), bundled locally with consistent SVG strokes. Its license notices are included in `dist/THIRD_PARTY_NOTICES.txt`.

## Saved notes and privacy

Saved annotations live in the extension's own IndexedDB database and remain until you explicitly delete them. Note and queue records are encrypted with AES-256-GCM using keys stored locally in the extension; the privacy policy describes the protection and recovery limits. Inserting a revision prompt or sending a native/queued message keeps your notes. Insertion requires an empty composer without attachments. Notes saved by older versions in the supported site's local storage are imported into extension storage; the old copy is removed only after a successful import. A failed save/import keeps the source and shows a retryable error.

Notes and queues stay in the current browser profile and work across its tabs. There is no publisher cloud storage, analytics, device sync, or built-in export. Chrome and Firefox installations keep separate databases. Queued messages are submitted through the chosen provider's normal composer. Removing the extension or clearing its storage removes its databases. See [PRIVACY.md](PRIVACY.md) for data categories, legacy storage, provider submissions, and the queue's bounded edited-message recovery records. The extension's Options link opens a packaged offline copy of the policy.

## Message queue

Open an existing ChatGPT, Claude, or Gemini conversation. While the native send control shows **Stop**, type a message and press Enter (Shift+Enter still inserts a line break), or click **Queue message** above the composer. The queue saves each message before clearing the draft. The native Stop control continues to stop generation.

Messages send in order as soon as the assistant's completed response and native composer are ready, with no fixed cooldown. Completion is detected from page changes; polling is a fallback. A tab showing that conversation must be visible with an empty composer. Typing a new draft holds automatic sending in that tab; another visible tab with an empty composer can still send. Queue or clear the draft to continue in that tab, or use Pause to hold the shared queue. A message disappears from the stack and count as soon as its send is confirmed. The extension still tracks that response internally and waits for it to finish before automatically sending the next message. Pause prevents the next automatic send. Queues are separate for each chat; a brand-new chat gets a queue after the site assigns it a stable conversation URL: `/c/<id>` on ChatGPT, `/chat/<id>` on Claude, or `/app/<id>` on Gemini. Home and new-chat pages have no durable queue yet. Matching IDs on different sites stay in separate queues; existing ChatGPT queue data is preserved.

Each queued message has **Send now**, **Edit** (pencil), and **Delete** (trash) controls. Send now stops the current response, if necessary, and sends the selected message once; other messages keep their relative order, and the queue keeps its pause/resume preference. It requires an empty composer. The pencil loads the saved text into the native composer while reserving that same queue slot across tabs. Press Enter, native Send, or **Save edit** to save the revision back into its original position. **Cancel edit** restores the original saved text and clears that edit from the composer. Existing composer drafts are never overwritten. If an editing tab disappears, the original saved message stays in the queue and the queue pauses when its editing reservation expires.

The extension stores queues in its own IndexedDB database with strict transaction durability. Queued messages, order, saved edits, and pause state survive page reloads, tab closures, background restarts, and browser restarts in the same profile and installation. Edits in an open queue editor are not persisted until you press Enter, click native Send, or click Save edit. Reopen the conversation to continue; the extension cannot send while the browser or every tab for that conversation is closed. This is local persistence, not sync between browsers, devices, or profiles. Removing the extension or clearing its storage removes queues. Firefox temporary add-ons are removed when Firefox exits; a signed installation is required for normal use across browser restarts.

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
bun run package:release
bun run build:firefox
bun run lint:firefox
bun run package:firefox
```

## Load In Chrome

1. Build the extension with `bun run build`
2. Open `chrome://extensions`
3. Enable Developer Mode
4. Load unpacked from `dist/`

## Load in Firefox for development

1. Run `bun run build:firefox`.
2. In Firefox 140 or later, open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select `dist-firefox/manifest.json`.
4. Open a supported conversation. If Firefox asks for site access, allow it for that provider.

Temporary installation lasts until Firefox exits. The production Firefox ZIP must be signed by Mozilla before ordinary users can install it persistently. The Firefox build does not run in private browsing windows. See [store/FIREFOX.md](store/FIREFOX.md) for packaging, validation, and release requirements.

## Versioning and releases

We use [Semantic Versioning](https://semver.org/): **major.minor.patch**. Versioning starts with the **0.1.0** development baseline; **1.0.0** is reserved for the first stable release. Compatibility means the documented annotation/queue workflows and existing saved data continue to work.

- **Patch** (`0.1.0` → `0.1.1`): compatible bug fixes and visual polish.
- **Minor** (`0.1.1` → `0.2.0`): new compatible features. During the 0.x development series, breaking changes also require a minor bump and an explicit changelog entry.
- **Major** (`1.4.2` → `2.0.0`): incompatible changes after 1.0.0. Always document migration steps; a version bump does not replace a data migration.

`package.json` is the single version source. The root `manifest.json` is a build template; the build inserts the version into the output manifest. Load only a built output directory in Chrome. Builds validate the version against Chrome's numeric limits and the latest dated changelog entry before writing output. Development builds display `<version> (development)` through `version_name`; their reload build IDs remain separate from release versions. We currently use numeric versions only, without `-beta` or `-rc` suffixes.

For each release:

1. Record the changes under `[Unreleased]` in `CHANGELOG.md`.
2. Preview the appropriate bump, then apply it:

   ```bash
   bun run version:patch --dry-run
   bun run version:patch
   # Or: bun run version:minor / bun run version:major
   ```

3. Run `bun run version:check`, `bunx tsc --noEmit`, and `bun test`. Create an isolated production candidate with `bun run package:release` and verify all affected providers live using that candidate. For local development, use `bun run reload` instead; its watcher also picks up version and changelog edits.
4. Review and commit the release, then tag that exact commit as `vX.Y.Z` when ready. Push or publish only when explicitly requested. Once released, keep that version immutable; ship subsequent changes under a new version.

The bump command resets lower components, moves the Unreleased notes into a dated entry, and leaves a fresh Unreleased section. It refuses invalid versions or empty notes. It does not build, commit, tag, push, or publish. Bump once per release, not on every development rebuild.

### Production upload candidate

`bun run package:release` builds into `.local/release/<version>/extension/` and writes a versioned ZIP plus SHA-256 file beside it. It leaves the installed development `dist/` untouched. The ZIP contains only the runtime scripts, manifest, extension icons, privacy page, and required third-party license notices; source maps, fixtures, store artwork, localhost permissions, and development reload hooks are excluded. Its content scripts match only ChatGPT, Claude, and Gemini over HTTPS. Development builds retain localhost fixture support.

Packaging requires Bun and the local `zip` command; the release tests also use `unzip`.

Packaging refuses to overwrite an existing candidate for the same version. To make another local candidate, use `bun run package:release --outdir <release-root>` or explicitly remove an obsolete candidate first. `bun run build --outdir <directory>` is also available for an isolated unpacked production build. Neither command uploads or publishes anything.

Chrome store materials are in [store/LISTING.md](store/LISTING.md), [store/PRIVACY_FIELDS.md](store/PRIVACY_FIELDS.md), and [store/RELEASE_CHECKLIST.md](store/RELEASE_CHECKLIST.md). Chrome 0.2.5 replaced 0.2.3 in public review on 2026-10-04 with automatic publication after approval; see [the recorded submission status](store/SUBMISSION_STATUS.md). Submission is not evidence of approval or public availability.

The selected beta channels are a separate **Threadlane BETA** Chrome Web Store item with **Unlisted** visibility, and a **Mozilla-signed, self-distributed Firefox package** with its own HTTPS update feed. Version 0.3.2 is the next beta candidate. The separate Chrome item preserves the pending public 0.2.5 submission. Unlisted means anyone with the link can install after publication; it is not invitation-only and still requires Google's review. Normal Windows/macOS Chrome installations need the Web Store for this update path; Firefox permits signed self-distribution. See [beta distribution and release gates](store/BETA_DISTRIBUTION.md) for the decision, first-install migration, and update process, and [Firefox submission status](store/FIREFOX_SUBMISSION_STATUS.md) for current signing blockers. A source-code push alone does not publish an extension update.

The support contact is threadlane.support@gmail.com. The [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) covers both browser builds; Firefox's self-hosted update channel also needs the update-host disclosure described in the beta release gates. Review the packaged policy and dashboard certifications against each final candidate. A store installation with a different extension ID does not inherit extension-owned data from an unpacked development installation; there is no database export/import tool. Preserve any installation that still holds needed notes or queues, and do not run duplicate queue extensions in the same chat.

## One-command development reload

Run `bun run reload` to rebuild the extension and start a detached local watcher if one is not already running. It listens only on `127.0.0.1:19445` (or `PLANNOTATOR_EXTENSION_DEV_PORT`) and keeps rebuilding future source edits. Logs from a watcher started by this command go to `.local/plannotator-dev.log`.

One-time setup: after the first run, click **Reload** for Threadlane in `chrome://extensions`, then refresh your supported chat pages to activate the development reload hook. Subsequent rebuilds check all connected extension pages before reloading, and defer while any page has a draft, active response, edit, or queue operation. The worker rechecks before the global reload; each page refreshes only after observing the installed worker build or its old context becoming invalid, and only when its own draft is safe. The command reports the verified build ID, not a verified browser reload.

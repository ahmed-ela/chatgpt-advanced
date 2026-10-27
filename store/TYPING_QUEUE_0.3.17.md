# Typing while the queue sends — 0.3.17

Date: October 25, 2026 (America/Los_Angeles).

**Superseded after native verification failure. Do not publish or deploy 0.3.17.** After the user reloaded it, the real ChatGPT test submitted the synthetic unsent draft instead of a queued message. The native editor retained stale internal state when the buffer immediately took focus. Earlier fixture successes below did not model that DOM/model separation. The test queue was paused. See the 0.3.18 follow-up report for the correction and current qualification.

## Reproduced cause

The previous controller intentionally returned a `draft` hold whenever the native composer contained text. It repeated that condition after claiming a queued message. This protected drafts from the whole-editor replacement used for sending, but also blocked automatic dispatch indefinitely while someone wrote their next message. It affected all three provider adapters and both visible and hidden tabs.

The new visible/hidden preservation regressions failed against the original controller: no message was sent. A real Chrome fixture running the original controller also remained idle with the queued item present after response completion. Clearing its draft immediately released the send.

## Change

The queue preserves a plain-text draft in a separate temporary editable input while the native composer sends its queued payload. The initial draft is durably backed up before replacement in the same encrypted extension-owned queue database. Ongoing typing, caret selection, focus, and explicit Enter enqueues are preserved. Native send replay stays limited to the original owned payload.

Restoration requires the original conversation, original composer, and an empty/owned native input. Conflicting content, attachments, navigation, persistence errors, and uncertain delivery retain recovery text. Draft revisions prevent stale saves or deletes from losing newer input. If navigation prevents the latest save, an editable recovery card keeps that text available without intercepting the new conversation's input.

Native ProseMirror trailing placeholder BRs are excluded from composer text/caret mapping; genuine newlines remain intact. Attachments, unsupported rich content, and active IME composition retain protective holds. Manual Send now and editing continue to require clearing an existing native draft.

## Validation

- Complete automated suite: **789 tests passed, 0 failed, 3,651 assertions across 17 files**.
- TypeScript: passed. Chrome and Firefox production builds: passed.
- Firefox lint: 0 errors, 0 notices, 4 existing warning categories/occurrences (Android minimum-version consent compatibility and dynamic HTML checks).
- Regression coverage includes continued typing during claim/attempt/backup/cleanup IPC, native and buffered Enter, lost enqueue replies, delayed Pro replay, duplicate prevention, focused/hidden tabs, competing tabs, exact draft/caret preservation, structural empty editor placeholders, failed saves, uncertain sends, attachment changes, navigation/remounts, IME, and Claude/Gemini sequential queues.
- Real Chrome browser fixture: two queued messages sent exactly once, in order, with the unfinished draft intact; observed dispatch delays were 23 ms and 22 ms in that fixture. A third send with an explicit 2-second simulated native replay preserved text typed during the delay and submitted only the queued payload once.
- A final browser fixture dispatched a preserved-draft message in 17 ms. Its DOM reported `visible`, so this run is **not** evidence of live background-tab qualification. Hidden-tab coverage above is automated.
- Native ChatGPT attempts in an isolated conversation returned **“This response couldn’t load.”** Full native-provider qualification is therefore not claimed. The Chrome fixture uses the real queue controller and encrypted store with simulated provider behavior; it is not an installed-extension transport test.

## Local activation and release status

The final 0.3.17 production files have been copied into the existing unpacked Chrome installation, with all 10 files checked for SHA-256 parity. A reload was requested; activation has not yet been confirmed. Do not infer an active browser version from the copied files.

Final Chrome candidate: `.local/release/0.3.17/threadlane-0.3.17.zip`.

SHA-256: `ab6b7df6c89f18b8c38651957daf3476a037b1ef43376f7cf7344677350b5b7e`.

An earlier candidate was preserved under the untracked test outputs as superseded. Use only the final candidate/hash above. No commit, push, PR, Store submission, or Firefox signing/update-feed change was performed for this patch. The prior Chrome Store submission remains unchanged.

Local evidence is under `outputs/typing-queue-2026-10-25/`: baseline regression log and browser screenshot, placeholder before/after logs, final full suite, Firefox lint, browser after/delayed-replay screenshots, and installed-file parity record. Evidence and backups are untracked and must not be included in release packages.

# Native editor commit ordering — 0.3.18

Date: October 25, 2026 (America/Los_Angeles).

## Native failure and root cause

After the user activated the local 0.3.17 candidate, an isolated native ChatGPT test at Extra High effort posted the synthetic unfinished draft instead of queued payload B. The queue correctly retained B as unconfirmed and did not retry it automatically. The test queue was paused. This was a real wrong-payload failure, not merely a delayed acknowledgement. Do not publish 0.3.17.

The original tests treated the visible contenteditable text as the provider's send state. ProseMirror keeps a separate internal document. Its blur handler stops and restarts the DOM observer; stopping with pending mutation records schedules their reconciliation 20 ms later. Returning focus to the draft buffer immediately after writing the queued text could trigger that delay. MessageChannel plus fast storage replies could then reach Send while the visible DOM contained B but the native model still contained the unfinished draft.

Primary source: [ProseMirror input handlers](https://github.com/ProseMirror/prosemirror-view/blob/master/src/input.ts) and [DOM observer](https://github.com/ProseMirror/prosemirror-view/blob/master/src/domobserver.ts). The source mechanism was independently reproduced with the actual ProseMirror library, not only a simulated observer.

## Correction

After an owned native write, user-input protection resumes immediately, while native focus stays in place through the existing commit task boundary. Only then does the buffer reclaim focus. The same ordering applies to draft restoration and failed-send cleanup. Restoration rechecks the conversation, composer, text, draft revision, explicit Enter, and composition after that boundary; new typing is preserved, and unrelated new focus is respected.

There is no added fixed delay. The queue still requires durable ownership, verified conversation identity/completion, and the exact newly posted user message before acknowledging delivery. Attachments, unsupported rich drafts, and IME protection remain in place.

## Verification

- **799 tests pass, 0 failures, 3,689 assertions across 17 files.**
- TypeScript and diff checks pass; Chrome/Firefox production builds pass.
- Firefox lint: 0 errors, 0 notices, four existing warnings (Android consent minimum-version compatibility and dynamic HTML checks).
- Seven added controller regressions model native editor state separately from DOM and cover send, restoration, typing, Enter, navigation, and IME across the commit boundary. The previous code submitted the wrong synthetic draft in this regression; corrected code passes.
- Actual ProseMirror browser fixture uses pinned official packages: view 1.42.8, state 1.4.4, model 1.25.12, and schema-basic 1.2.5. Its send callback reads `EditorView.state.doc.textContent`; it logs that value and the DOM at click time.
- Chrome baseline fixture reproduced `modelPayload: UNSENT_USER_DRAFT_BASELINE`, `domAtClick: QUEUED_PAYLOAD_BASELINE`, `mismatch: true`.
- Corrected Chrome fixture sent `QUEUED_PAYLOAD_FIXED_A` and `QUEUED_PAYLOAD_FIXED_B` exactly once, in order, with both mismatches false. `UNSENT_USER_DRAFT_FIXED` remained in both the native model and the input.
- Corrected Firefox fixture likewise sent `FIREFOX_QUEUED_A` and `FIREFOX_QUEUED_B` once with both mismatches false, preserving `UNSENT_FIREFOX_DRAFT` in model and input.
- These browser fixtures use real editor/queue/storage code but simulated provider responses and extension message transport. They do not prove installed Firefox add-on or native ChatGPT behavior.

## Activation and release gate

The user reloaded 0.3.18. A fresh native ChatGPT test at Extra High sent `TL0318_QUEUE_A` and `TL0318_QUEUE_B` exactly once, in order, and removed both rows. `UNSENT_TL0318_DRAFT` was never posted. ChatGPT displayed "This response couldn’t load" for all three assistant responses, so this verifies submission and queue handling, not successful answer generation.

The draft remained intact in the saved recovery card instead of returning to the native input. This exposed a separate restoration guard defect: response-generation markers make the general conversation-readiness check false after a successful send. Regressions reproduce that case, as well as acknowledgement preceding native input clearing. The follow-up correction is tracked in `TYPING_QUEUE_0.3.19.md`; 0.3.18 is not the final candidate for this task.

Native test: https://chatgpt.com/c/6adef992-4370-832f-9f83-4d32c7b7283e. The visible diagnostic counter reached two confirmed sends and empty queue, with the original draft in its recovery card. The installed ten files were byte-identical to the immutable 0.3.18 ZIP at activation.

Final Chrome candidate: `.local/release/0.3.18/threadlane-0.3.18.zip`.

SHA-256: `e824c6612a9a0656cca94db5bccff6d8e96123ee8e7b5fad18ede93b5edadb73`.

No commit, push, PR, Store upload, Firefox signing, or update-feed publication has been performed for this patch. The prior Store submission is unchanged. A DO_NOT_PUBLISH marker accompanies the local 0.3.17 candidate without modifying its historical ZIP.

## Local evidence

Untracked evidence lives in `outputs/typing-queue-2026-10-25/`: native ChatGPT failure screenshot, native-commit before/after regression logs, full-suite-0.3.18.txt, firefox-lint-0.3.18.txt, package-0.3.18.txt, and installed-file-parity-0.3.18.json.

`prosemirror-live/` contains the pinned isolated fixture, README/reproduction instructions, baseline and patched AX evidence, Chrome baseline/patched screenshots, and Firefox patched screenshot. Dependencies and evidence are local test artifacts and excluded from production packages.

# Completed historical clarification blocks Send — 0.3.20

Date: October 26, 2026 (America/Los_Angeles).

## Live reproduction

Reported conversation: https://chatgpt.com/c/6adfd6de-9234-8325-a2a7-773f6e56810d

The page had no visible Stop control, no streaming/aria-busy markers, and all visible turn wrappers were marked complete. Its current answer had normal completed response actions. Nevertheless, Threadlane reported `queueWorkerBusy=true`.

An older clarification response contained an ID-less assistant-style body with `data-markdown-text-tone="tertiary"` and text “Clarified visual intent.” It belonged to its own explicitly completed turn. The following generated-image turn and the latest ordinary text turn were separate completed turns. The general unfinished-body check treated the historical clarification as live generation because it had no message ID.

Clicking native Send once on the existing “hi” draft reproduced the user report: the text was safely saved in Queue 1, then remained held with `queueState=chat-busy`, `queueCompletionReason=busy`, and zero confirmed sends. No duplicate retry was attempted.

## Patch

Reconcile only the observed auxiliary shape: an ID-less tertiary assistant status inside a completed historical turn with a preceding user. The current verified conversation must also contain a later user outside that turn and a committed assistant answer with the existing positive completion evidence. The status text and generated CSS class names are not used as selectors.

Current or unverified ID-less responses, incomplete turn states, animations, active streaming, conflicting identity, and missing completion evidence still block sending. This does not change pause, draft preservation, ownership, acknowledgement, or duplicate-send guards.

## Verification

- Before the patch, isolated controller tests reproduced both intercepted native Enter and automatic queue dispatch remaining blocked.
- **850 tests pass, zero failures, 3,834 assertions across 17 files**, including 17 new adapter cases and nine new controller cases.
- TypeScript, diff checks, Chrome/Firefox production builds pass.
- Firefox package lint: zero errors, zero notices, four pre-existing warnings.
- The user confirmed reloading 0.3.20. After refreshing the reported chat, the same completed ID-less clarification remained visible, but `queueWorkerBusy` changed from true to false. The false busy-state defect is verified corrected in the actual affected conversation.
- The user confirmed manually removing the queued “hi” before reloading. That accounts for the empty queue and absent transcript bubble after reconnection; no delivery was expected. No retry or replacement message was sent. The actual chat verifies corrected busy detection; exact-once dispatch for this historical-status case is covered by the regression tests.

Candidate: `.local/release/0.3.20/threadlane-0.3.20.zip`.

SHA-256: `95acdd31ceb97800644de98b84914098734cf46ce9f865ab17bf8b672d4f1e62`.

Local evidence: `outputs/auxiliary-status-2026-10-26/` contains the original live snapshot, screenshot, `native-after-reload.json` and screenshot, regression logs, full-suite output, lint and package records. All ten files are byte-identical across the ZIP, release directory, current build, and installed build; all manifests report 0.3.20. No commit, push, Store upload, or Firefox update-feed publication has been performed for this patch.

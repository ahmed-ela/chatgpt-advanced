# ChatGPT queue identity patch 0.3.7 — October 6, 2026

## Observed failure

In the user conversation `6ac4f758-610c-83ea-b7de-9ae017dca1f1`, the loaded Chrome build was `muvjngd6-tkkhq9` (0.3.6). The previous answer was complete, its Copy/Rate toolbar was visible at ancestor depth 6, the composer was empty, there were no Stop/loading/animated response nodes, and the worker was idle. The next text remained queued with `completion-pending` and zero confirmed sends.

The transcript still used `local-chatgpt:f42bf34e-108f-4f34-a1c2-1fa5a31b37c9`, while the URL used the saved conversation ID. Replaying the captured semantic markup fails readiness and completion without the first-send identity binding; registering that exact binding makes both checks pass. The generic completion warning concealed an identity rejection. All five users remained mounted, so this captured failure is not explained by first-message virtualization or a missing toolbar.

A safe refresh after checking empty draft, no active generation and no prior copy of the queued text loaded the saved conversation identity. The persisted `same with the stack?` message then sent automatically exactly once, was acknowledged, and disappeared from the queue. The refresh recovered the chat using 0.3.6; it is not evidence of 0.3.7 activation.

## Controlled reproduction

A separate live Extra High chat `6ac4fb2d-c358-83e9-94b0-f1b7836dfad7` reproduced the same hold on 0.3.6. Developer instrumentation inserted a cached assistant element under `aria-hidden=true` that retained a layout rectangle. A normal first message and queued follow-up were entered through the native composer. After the first response ended, the queued message remained unsent, with `completion-pending`, worker idle and no Stop control.

The first-send guard used raw rectangles and counted that hidden cached answer as an existing conversation, so it never captured the identity witness. The regular DOM adapter correctly ignored the same element. The fixture was removed and the completed isolated chat was refreshed to recover its persisted queue. This is a reproduced mechanism, not proof of the historical event that first lost the binding in the user's tab.

## Changes

- Use the same semantic visibility checks when recognizing an empty new chat and when reading its transcript.
- Observe a first send through the native form-submit path as well as Enter and Send.
- Retain a bounded set of previously verified route/local-ID/first-user bindings in the current document, and restore only an exact matching tuple on a cached-chat return. Loading, mismatched routes, different local IDs, mixed markers and different first-user IDs still block sending.
- Distinguish unverified conversation identity from pending answer completion, with a specific safe-refresh recovery message for completed conversations.

The patch does not invent an identity from URL or matching prompt text, and does not use absence of Stop as completion proof. A browser restart or extension reinjection has no retained document witness; normal saved-conversation loading or safe refresh is still needed if ChatGPT presents only an unverified temporary identity.

## Verification and distribution

The complete suite passes: 561 tests across 16 files, zero failures, 2,530 assertions. TypeScript and diff checks also pass. Independent review reran the 145 DOM/UI tests and checked a first response exceeding 121 seconds, including delayed identity markers. Chrome and Firefox 0.3.7 candidate packages were built successfully.

The incremental patch was transferred into the watched qualification checkout while preserving its prior 0.3.6 changes. The development watcher built `muwqjx8p-7ni9aw` into the installed extension directory. Browser activation remains pending: a separate user new-chat tab contains an unsent draft and pasted attachment, so the existing global reload safety guard correctly returns `waiting-for-other-tabs`. A completed isolated test-tab refresh still loads the cached 0.3.6 extension build. No forced reload, draft clearing, or draft send was attempted. Single-tab candidate instrumentation was considered, but the browser tool does not support the required preload method; no candidate replacement was performed.

Thus the original chat recovery and controlled live reproduction are verified, while live background dispatch on the new 0.3.7 runtime remains unverified until safe activation. The watcher remains running and can activate once all extension pages are safe. Both the original and isolated test messages were acknowledged exactly once and removed from their queues after safe page refreshes on 0.3.6. The hidden cached-answer fixture was removed.

Chrome Web Store public revision 00003 remains version 0.3.6 Pending review. This local patch does not imply store approval, upload, Firefox signing, or automatic feed distribution. No 0.3.7 store upload, Firefox signing, or automatic feed promotion has been performed. Source commit and merge are separate from these release actions.

Evidence: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/autosend-diagnosis-2026-10-06/`.

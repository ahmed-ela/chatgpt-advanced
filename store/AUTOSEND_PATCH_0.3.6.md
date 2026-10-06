# Auto-send patch 0.3.6 — October 5, 2026

## What changed

The ChatGPT adapter previously treated every visible ID-less `data-markdown-animated` element as an active response. A completed turn can retain a separate thinking animation. That element then held the queue indefinitely even when the assistant reply had a committed ID and native completion controls.

The adapter now ignores only earlier non-message animation with positive completion proof in its own bounded turn, while also requiring the latest turn to be complete. Stop controls, loading/streaming state, new unfinished assistant bodies, newer unanswered users, mismatched conversations, and unrelated toolbars still block automatic sends. The exact trigger in the user's original Chrome conversation remains unconfirmed; this is the concrete reproduced stall addressed by the patch.

The queue explains draft, attachment, and unconfirmed-completion holds beside the next item. Document-local DOM attributes expose the current/last hold, dispatch visibility/time, and durable acknowledgement count without exposing prompts or ownership tokens. Nothing new is uploaded or persisted for diagnostics.

Development watchers identify their source and output directories. Reload refuses another checkout's or a legacy watcher's build, and `PLANNOTATOR_EXTENSION_DEV_OUTDIR` lets the qualified checkout update the existing installed directory without changing extension identity/storage.

## Verification

- Full suite: **545 tests passed, 0 failed, 2,401 assertions**, across 16 files.
- TypeScript and diff checks passed.
- Firefox build lint: zero errors/notices, four existing warnings.
- Before/after DOM fixtures reproduce the retained-animation hold in the old adapter and recover in the patched adapter, including hidden documents and successive queue draining.
- Independent runtime review found no blocking defect. A future regeneration layout retaining old completion controls beside new generic animation remains a limitation to watch; native Stop/loading/streaming signals remain authoritative.

### Live Chrome

The installed development directory is `/Users/ahmedelamin/repos/projects/plannotator-chatgpt-notes/dist`, built from this qualified checkout. The loaded test page positively reported build `muvjngd6-tkkhq9` (0.3.6 source).

Isolated conversation: https://chatgpt.com/c/6ac3df8d-45c4-83e8-bcc6-67051231f724

A retained ID-less thinking animation was injected into an earlier completed test turn through developer instrumentation. A real **Extra High** response was started and two normal follow-ups were queued through the native composer. Focus emulation was disabled and another tab was selected. While the test document remained hidden and the retained animation remained present:

- Follow-up G dispatched 114 ms after completion DOM appeared, received `PATCH-G-OK`, and was acknowledged once.
- Follow-up H dispatched 88 ms after the next completion DOM appeared, received `PATCH-H-OK`, and was acknowledged once.
- The queue emptied and each follow-up appeared exactly once.

The simulated animation and diagnostic listeners were removed by reloading only the completed test tab. Messages and the empty queue survived. The user conversation was not edited or forcibly reloaded.

### Firefox boundary

The unsigned temporary candidate is built at `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/autosend-patch-0.3.6/firefox`. It contains the background dispatch change and the new completion patch. Live verification is pending because the computer-use tool cannot read Firefox's macOS temporary-addon file picker. The user was asked to load its `manifest.json`; signature enforcement was not changed and the signed add-on was not uninstalled.

A paused test message remains in isolated Firefox conversation https://chatgpt.com/c/6ac3e1e4-54d0-8325-90ec-98dda5920b3e for checking state retention after temporary loading. This is test data, not a user's existing draft/queue.

## Release boundary

The patch task initially left Chrome's pending public submission at 0.2.5 and both Firefox channels unchanged. In the subsequent authorized store-update task, Chrome 0.3.6 replaced 0.2.5 on the same public item. The dashboard confirmed **Pending review** at 2026-10-05 18:03:41 UTC, revision `00003`, with Public distribution and automatic publication after approval. The description was synced to [LISTING.md](LISTING.md). Submission is not approval or publication; see [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md) for the exact archive, checksum, uncommitted source attribution, and evidence.

The Firefox update feed remains 0.3.2, and public AMO 0.3.5 remains Awaiting Review using that earlier tested runtime. The 0.3.6 patch is locally activated for Chrome and built as an unsigned Firefox candidate; Firefox publication/signing still requires live qualification. Neither Firefox store submission nor automatic feed was updated by the Chrome release task.

Detailed evidence is under `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/autosend-patch-0.3.6/`.

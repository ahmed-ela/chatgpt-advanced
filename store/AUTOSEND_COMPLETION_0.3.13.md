# Completion recovery and regression qualification — 0.3.13

Verified locally on October 11, 2026. This record does not imply a Store submission or publication.

## Reproduced problem

The affected Chrome conversation showed native `Response complete`, an empty composer, an unpaused queue, and a verified conversation ID. One follow-up remained held as `completion-pending`.

ChatGPT's committed assistant toolbar used visible Copy, Share, Read aloud, Regenerate response, and More actions controls, without the legacy testids or Rate response control. Its bounded turn wrapper carried `data-talvt-turn-state="complete"` six ancestors above the answer. The old completion detector did not recognize this combination.

## Fix and error handling

- Accept the current toolbar only together with the explicit complete state in the bounded container containing the exact committed assistant and user turn. Neither signal alone authorizes sending.
- Retain conversation identity, loading, active Stop, streaming, hidden-control, duplicate-message, and uncommitted-answer guards. Generation checks remain separate from conversation readiness so explicit Send now can safely stop an active response.
- Observe `data-talvt-turn-state` directly so attribute-only completion wakes the queue without relying on a background polling timer.
- Expose a content-free `data-queue-completion-reason` and distinguish unsupported completion, missing user anchor, missing answer, and conversation loading. Preserve saved messages and explain checked Send now recovery instead of implying that an idle answer is still finishing.
- Keep completion-storage failures idempotent: preserve known delivery, never offer a duplicate native-send retry, and recover only the next queued item after storage confirmation.
- Skip completion transcript extraction for empty queues and reuse the synchronous diagnostic result during rendering. Send authorization still obtains fresh completion evidence.

## Automated qualification

`bun test`: **647 passed, 0 failed**, 2,960 assertions across 16 files, 13.18 seconds. The previous suite contained 602 cases; this patch adds 45 cases.

`bun x tsc --noEmit`, `bun run version:check`, and `git diff --check` passed. Production Chrome and Firefox builds succeeded at version 0.3.13, omit localhost host permissions, and contain identical queue runtime bytes.

New coverage includes:

- A sanitized fixture matching the live six-wrapper toolbar, including hidden documents, legacy controls, and replacement documents.
- Complete state alone, toolbar alone, hidden/cached controls, missing identity or anchor, mixed or duplicate turns, active Stop, conflicting streaming, and unfinished answer bodies.
- Two queued follow-ups draining exactly once after successive attribute-only completions, in visible and hidden documents with the polling interval disabled; each transition completes within the test's 500 ms bound.
- Unsupported or missing transcript data preserving saved text, and explicit recovery retaining order.
- Completion transaction failure before commit and a lost reply after commit, without resending the delivered message.
- Older ChatGPT anchors remaining conservatively held after an out-of-band newer turn; explicit checked recovery remains available. Claude and Gemini's existing completion contract is preserved.

Regression proof used isolated temporary copies, without reverting the working source. The old 0.3.12 adapter fails all four exact-layout cases. A test-only wrapper maps its existing boolean result to the new diagnostic string so failures test actual detection, rather than a missing export. Removing only the new observer attribute from the patched queue causes both no-polling completion cases to fail.

## Live Chrome qualification

Build `mv45e5fq-szw5xc` activated through the existing draft-safe reload hook after the full suite passed. The original affected conversation now contains its queued prompt once and has no queued rows. Delivery began while old content scripts were still active, so that send is not attributed to this patch.

In a fresh isolated ChatGPT chat on the verified patched build, a native initial prompt and two queued follow-ups produced READY, SECOND, and THIRD. Both queued follow-ups auto-sent after successive responses, each user prompt appeared once with a distinct committed message ID, the diagnostic recorded two confirmed sends, and the final queue state was empty with zero rows and three complete turns. No manual Send now or queue refresh was used.

The live test reported visible document dispatch. Hidden-document behavior is covered by controlled regression tests; a new live background Chrome run and native Firefox qualification were not performed in this patch.

## Evidence and release boundary

Local evidence directory:

`/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-completion-2026-10-11/`

It contains the full suite log, old-adapter failure log, observer-removal failure log, blocked-queue screenshot, queued-follow-up screenshot, drained-queue screenshot, and `live-proof.json` with the harmless test prompts, exact message IDs, build identity, and queue diagnostics.

Version 0.3.13 is active in the local Chrome development installation. No 0.3.13 Store upload, PR, remote push, Firefox installation, or Firefox feed update was performed during this qualification.

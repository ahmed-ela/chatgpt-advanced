# Empty recovery input — 0.3.21

Date: October 27, 2026 (America/Los_Angeles).

## Observed user state

The affected native ChatGPT conversation was inspected directly.

The live queue was empty, route identity was verified, and the worker was not busy. A blank, read-only “Saved unsent draft” textarea had focus above the empty native composer. The saved textarea's DOM value and text were both exactly empty. This was an unusable recovery input, not evidence of a pending queued send. Current DOM state cannot establish which earlier interruption left that record behind.

Using the existing Restore control removed the empty record. Typing a temporary unsent probe into the native composer then displayed its normal Send button. The probe was cleared without submission. No message was sent in the user's conversation.

## Reproduced cause and fix

Draft preservation also starts when the native composer is focused but empty. Earlier builds saved this empty checkpoint as a recoverable draft. Final removal was best-effort; an interrupted document or failed cleanup could leave it durable. New tabs rendered every saved record as a read-only recovery input. An existing storage test explicitly expected empty text to survive, so the old suite encoded the defect as acceptable behavior.

Version 0.3.21 makes an exact-empty save retire that draft revision in the same encrypted compare-and-swap transaction. Its retirement receipt rejects stale writes, while newer typing remains recoverable. Normal reads and heartbeats migrate existing empty records through the same transaction. Empty checkpoints do not consume recovery capacity. Whitespace-only and nonempty drafts remain untouched.

The UI accepts the absent record only after a successful empty-save response. Verification for nonempty text remains unchanged. It also omits empty recovery cards returned by an older worker. The content script and worker must both activate together; refresh existing tabs after the extension reload.

## Verification

- Controller baseline: two failures reproduced blank recovery inputs after restart-before-cleanup and after confirmed-send cleanup failure; three protection cases passed.
- Patched controller: all five focused cases pass, including typing after an empty checkpoint and real/whitespace draft restoration.
- Storage: eight added regression cases cover retirement, migration, restart, delayed writes, concurrent typing, capacity, and failed durable commits. All 103 storage tests pass.
- Full suite: **863 tests pass, 0 failures, 3,914 assertions across 17 files.** TypeScript and `git diff --check` pass.
- Chrome and Firefox production builds pass. Firefox lint reports zero errors, zero notices, and four existing warnings. No installed Firefox live claim is made for this patch.
- Independent review found no blocking issue in draft retirement or concurrent-write handling.

## Live Chrome activation

The user reloaded 0.3.21, then the affected chat was refreshed with an empty composer. It has no recovery card, an empty queue, verified provider identity, and no busy hold.

A separate native ChatGPT conversation was used for isolated verification.

Extra High was visibly selected. `TL0321_QUEUE_A: Reply with exactly EMPTY_CHECKPOINT_OK.` was queued while the setup response ran, leaving the native input focused and empty. The queue automatically posted that prompt once, reported one confirmed send and `queueDraftRestore=restored`, then removed the row. No recovery draft remained. After refreshing, the transcript still contained that prompt exactly once and the queue/recovery UI stayed empty.

ChatGPT briefly exposed an incomplete empty response and subsequently showed “This response couldn’t load.” This test confirms delivery and empty-draft handling, not successful generation of the requested answer. A stale accessibility index briefly opened the sent message's edit panel; it was canceled without changes or submission.

## Artifacts and release state

Immutable Chrome candidate: `.local/release/0.3.21/threadlane-0.3.21.zip`.

SHA-256: `094a283c69182f73f5b9227503015d370a98d167a3743aa2f134200cd612f057`.

All ten files match across the ZIP, immutable extension directory, checkout dist, and installed unpacked Chrome directory. Local evidence is under `outputs/empty-draft-2026-10-27/`, including failing/passing regressions, full-suite results, screenshots, DOM diagnostics, package parity, and the previous installed-build backup.

No commit, push, PR, Chrome Store submission, Firefox signing, or update-feed publication was performed for this patch. Earlier uncommitted 0.3.17–0.3.20 changes remain in this branch.

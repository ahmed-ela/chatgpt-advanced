# Verified conversation continuity — 0.3.16

Qualification date: October 25, 2026, America/Los_Angeles.

## Live reproduction

The installed 0.3.15 runtime had one pending message after one confirmed queued send. Its first-send witness was `verified`, but its current identity source and completion reason were `unverified` / `identity-unverified`. All mounted conversation markers still carried the same original temporary ChatGPT ID. The mounted user turns began at turn 3 instead of turn 0.

With the queue briefly paused, scrolling upward remounted turn 0 and restored `native-first-send` identity without reloading. Scrolling downward removed the original turn again and reproduced the identity warning. The queue was returned to its original resumed state. This isolates the first-mounted-user equality check as the cause; it does not establish when ChatGPT introduced transcript virtualization.

## Change

Separate initial identity establishment/restoration from continuity within an already verified document. Retain at most 32 recently witnessed user-message IDs. When the original first turn is unmounted, an exact matching route and temporary conversation ID may continue only if at least one previously witnessed user ID remains mounted. Update that bounded set only after successful validation.

Route and document transitions clear continuity. Durable restoration still requires the original first user. Missing or foreign markers, an entirely unknown transcript, a conflicting prepended first user, and mismatched routes remain blocked. Identity verification does not establish response completion or send acknowledgement; those existing checks remain independent.

Deliberate limit: after a content-script restart or navigation, a still-temporary transcript whose first turn is absent may need the original turn mounted once before its persisted witness can be restored. This release does not introduce a durable rolling-witness format.

## Validation

- The new DOM regression failed against the old source with `identity-unverified` where the established chat should remain ready.
- The new visible and hidden queue integration cases also failed against the old source. With the patch, both queued follow-ups send exactly once and disappear, while wrong-route and changed-temporary-ID cases remain blocked.
- Full suite: **701 passed, 0 failed**, 3,182 assertions across 16 files. Ten new cases cover the reproduced transition and its safety boundaries.
- TypeScript, version consistency, and whitespace checks passed.
- Chrome and Firefox production packages passed validation. Firefox lint: 0 errors, 0 notices, four existing warnings (Android minimum-version compatibility and three dynamic-innerHTML warnings).

## Local activation and live limits

The validated Chrome candidate was copied into the existing unpacked installation directory, preserving its identity and storage. All ten files match the candidate. Icons, privacy page, and notices match the prior installed 0.3.15 build. The user reloaded Threadlane; the affected tab was then refreshed after verifying its composer was empty and had no attachments.

The original pending message was observed as one user message and removed from the queue, with one confirmed send and zero remaining rows. ChatGPT subsequently displayed `This response couldn’t load`; successful queue delivery is not a successful generated answer.

A separate live Extra High test captured a new temporary-ID witness and dispatched six queued follow-ups. ChatGPT displayed response-loading errors for the test replies, including its first native submission and ordinary math prompts. This run verifies delivery but does **not** qualify the complete live long-transcript virtualization scenario. The positive virtualization/completion evidence for the patch is the automated integration suite; the pre-patch live scroll reproduction is independently confirmed.

Local evidence: `outputs/identity-virtualization-2026-10-25/` contains the screenshots, test logs, package parity record, and the previous installed build backup. No store submission or remote Git operation was performed for 0.3.16 during this qualification.

## Packages

| Candidate | SHA-256 |
| --- | --- |
| Chrome 0.3.16 | `89f5f1b6b3b55e3c4e76de0f2490f7736e139b73224b9b5437daa3b8c9b74983` |
| Firefox 0.3.16 | `2e5121f929345651d9cd5b1a5b437ddb082ba33210022d8615c6037c97dd5448` |

Candidates are under `.local/release/`. Firefox was packaged and linted, not installed or tested live in this run.

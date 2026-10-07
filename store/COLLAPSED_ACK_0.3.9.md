# Collapsed plain-text acknowledgement — 0.3.9

## Root cause

Read-only inspection of the reported Chrome chat on October 7, 2026 found one unconfirmed queue item, an empty composer, and no active response. The corresponding native user bubble contained the complete plain-text prompt plus a hidden display ellipsis. Its semantic text exactly matched the normalized queued text (1,434 characters), but Threadlane 0.3.8 extracted 1,436 characters: the prompt followed by a newline and U+2026.

Version 0.3.8 excluded these decorations only when a rich-text root was present. This bubble used the plain-text rendering path, so the comparison still failed. Expanding or refreshing changes rendering; it is not the acknowledgement fix. The original conversation and queued entry were not resent, dismissed, or otherwise modified during diagnosis.

## Patch

Remove descendants explicitly marked `aria-hidden="true"`, `hidden`, or `data-markdown-copy="exclude"` from the cloned ChatGPT user body before selecting rich or plain extraction. The source bubble and composer remain unchanged. A visible ellipsis submitted as part of the prompt is retained. Exact normalized text matching and fresh message IDs still govern acknowledgement; no historical review reconciliation, timeout extension, or automatic resend was added.

## Regression evidence

- Eight new regressions: five positive failures on the previous reader; all eight pass with the patch. Three mismatch/stale-ID guards pass before and after.
- Coverage includes collapsed and expanded plain text, nested copy/hidden decorations, genuine final ellipses, preserving source/composer content, and visible/hidden Send now followed by automatic continuation.
- Full suite: **577 tests, zero failures, 2,623 assertions** across 16 files. TypeScript, version consistency, and diff checks pass.
- Independent review: no blocking findings; all 161 DOM/UI tests pass with 870 assertions.

## Native live verification

An isolated benign Extra High ChatGPT conversation reproduced the failure on 0.3.8 build `muxz8c8s-uundhe`. A 31-line, 1,725-character prompt naturally produced a collapsed plain-text bubble with the hidden ellipsis. Send now submitted it exactly once, the response completed, and its row became Send unconfirmed after the confirmation deadline. No DOM rendering simulation or test hooks were used.

After safely activating 0.3.9 build `muxzhs1t-ttvj7r`, a corresponding long prompt sent exactly once and its row disappeared. The native bubble remained collapsed with the hidden decoration still present. Its complete semantic text matched the submitted prompt exactly, including a genuine trailing ellipsis. No expansion or page refresh occurred between this send and its successful acknowledgement.

A queued follow-up then dispatched automatically with tab visibility `hidden`, appeared once, and left the queue empty. Focus emulation was the only temporary browser setting used for background testing; a Resume control click used the developer driver after native browser input timed out. Provider content and rendering were not altered.

In a further native run, a long plain-text prompt and a following item were queued while another response was running, then the tab was hidden before that response completed. Both auto-dispatched while hidden, including the long prompt whose native bubble remained collapsed with its decoration present. Final diagnostics showed four confirmed queued sends in total, one appearance of each prompt, zero queue rows, no error, and no running response. Focus emulation was restored after verification.

Local evidence in the originating workspace is under `outputs/collapsed-prompt-ack-2026-10-07/`: content-free original mismatch metadata, before/after regression logs, full test output, native live result metadata, and screenshots. Only benign test prompts were sent; no original conversation content appears in the regression fixtures or report.

## Deployment limits

Chrome and Firefox production packages were created for 0.3.9. Firefox package lint has zero errors, zero notices, and four existing manifest/innerHTML warnings. Firefox website behavior was not retested live for this patch; shared adapter behavior is covered by visible/hidden automated fixtures.

The local Chrome development runtime was observed active on the patched build. This task does not update Chrome Web Store review submissions, obtain Mozilla signing, or change Firefox's update feed. Existing unconfirmed entries remain available for explicit review rather than being automatically retried.

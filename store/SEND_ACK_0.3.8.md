# Rich user-message acknowledgement — 0.3.8

## Failure and root cause

Observed in Chrome on October 7, 2026 with Threadlane 0.3.7 build `muwqjx8p-7ni9aw`: a native send had occurred, but its queued row remained in `review` (Send unconfirmed). An unrelated following item remained queued. The original conversation was inspected read-only; no queued content was resent or removed.

ChatGPT's user bubble contained a rich-text root marked `data-markdown-text-tone="user-message"`, with adjacent paragraphs representing blank lines and `<br>` representing single line breaks. A hidden display character lived outside that root. The adapter's generic text walker used a single newline between paragraph blocks and included the hidden character. For the observed item, normalized queued text had 729 characters and the extracted text had 726. Reading the rich root with exact paragraph separators reconstructed the full queued text exactly. No original conversation text is included in this report or the test fixtures.

The acknowledgement check correctly rejected that mismatched extraction. After its 15-second confirmation deadline, the item became `review`; it was not safe to automatically send it again.

## Change

Only ChatGPT's rich user-message text extraction changes. It reads the semantic rich root, preserves two-newline paragraph separators and single `<br>` breaks, and excludes hidden/copy-only decorations from the cloned content. Composer, legacy preformatted text, assistant text, and the Claude/Gemini adapters retain their existing handling. The fresh user-message ID requirement and exact normalized text comparison remain unchanged.

Existing unconfirmed items are not automatically acknowledged, removed, or retried by this patch. Their recovery controls remain available for explicit review.

## Verification

- The identical new rich-text fixtures fail against the old reader: 5 positive failures; 3 safety cases still pass. With the patch, all 8 focused regressions pass.
- Full suite: **569 tests, 0 failures, 2,578 assertions** across 16 files. TypeScript, version consistency, and diff checks pass.
- Regression coverage includes Send now removal, automatic continuation, hidden tabs, empty rich paragraphs, excluded decorations, legacy/composer preservation, changed spacing or blank lines, and rejection of an older identical message ID.
- An independent source review found no blocking issue and confirmed that only cloned nodes are modified.

Chrome live reproduction used an isolated benign Extra High conversation, native queue controls, actual provider sends, and a temporary synchronous renderer that recreated the rich user DOM structure observed in the original chat. Ordinary plaintext prompts continued to work before the patch. The controlled rich-text send on 0.3.7 appeared once in the conversation but remained Send unconfirmed after the deadline.

The same rendering fixture on activated 0.3.8 build `muxz0m48-eukf4b` acknowledged the Send now item and immediately removed its row. A following rich item sent automatically after resume. Two further items then auto-sent while `document.visibilityState` was `hidden`, including a rich-text prompt followed by a legacy plaintext prompt. Each of the four patched queued messages appeared exactly once. Final diagnostics reported four confirmed sends, no queue rows, no error, no running response, and last dispatch visibility `hidden`. Temporary rendering hooks were removed after the test.

Live evidence is local to the originating workspace: `outputs/send-now-ack-2026-10-07/` contains before/after regression logs, full test output, content-free original mismatch metadata, benign live reproduction metadata, and before/after screenshots. The live test's DOM instrumentation models the observed rendering; it is not a claim that a new ordinary plaintext prompt naturally switches to rich rendering.

## Build and release limits

Production packages were built for Chrome and Firefox, with no development localhost permissions or reload hooks. Firefox package lint returned zero errors, zero notices, and four existing manifest/innerHTML warnings. Firefox website behavior was not retested live for 0.3.8; the shared ChatGPT adapter is covered by the automated visible/hidden fixtures.

The local Chrome development installation was safely reloaded and observed running the patched build. This task does not upload a new Chrome Web Store submission, obtain Mozilla signing, or change the Firefox update feed. Repository merge, package creation, local activation, and store distribution remain separate outcomes.

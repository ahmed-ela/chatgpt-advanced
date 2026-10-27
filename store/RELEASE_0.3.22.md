# Threadlane 0.3.22 release qualification

Date: October 27, 2026 (America/Los_Angeles).

This release includes the accumulated 0.3.17–0.3.21 draft-preservation, historical-completion, and empty-recovery fixes plus a final navigation guard. Queued messages can send while a plain-text draft remains editable and recoverable. Native editor model reconciliation precedes focus restoration and Send. Completed historical clarification statuses no longer hold the whole chat busy, and empty checkpoints retire atomically instead of becoming unusable recovery inputs.

## Final review correction

A recovery-only queue can retain its Restore card until the next poll after SPA navigation. The earlier Restore handler captured its saved entry before synchronizing the route, so a stale card could insert the prior conversation's draft into the new chat's native composer. The regression reproduced that write after real mutation microtasks and before the next poll.

Restore now checks the original queue key against the synchronized route before reading a saved entry. A changed route hides the stale card and refreshes state; the old backup remains saved and the new composer stays untouched. Baseline: one failure and two existing restoration passes. Patched: three passes, including nonempty and whitespace recovery.

## Validation and artifacts

- Full suite: **864 pass, 0 fail, 3,920 assertions, 17 files**. TypeScript, version consistency, and whitespace checks pass.
- Chrome immutable ZIP: `.local/release/0.3.22/threadlane-0.3.22.zip`.
- SHA-256: `fd20e336fa4266c008e65e13ec595bc631ce7e6610c7ae9141da97d0151693c8`.
- Prior installed Chrome live evidence is documented in `TYPING_QUEUE_0.3.19.md`, `HISTORICAL_STATUS_0.3.20.md`, and `EMPTY_DRAFT_RECOVERY_0.3.21.md`. The 0.3.21 queued prompt posted once with a focused empty input and stayed retired after refresh; its generated answer showed a provider loading error.
- The final 0.3.22 route guard is regression-tested. Those earlier live results are not a claim of fresh 0.3.22 installed qualification across all providers or Firefox.
- The separately hosted public privacy policy was updated and anonymously read back with byte parity to `PRIVACY.md`. Gist revision: `67a27f18b765adf06c9ac034a9d1247d09f83725`; content SHA-256: `b6b0c8b93ab2a853c27f53d090db0cad3c3cd5b6cd85aaebb8e2c430ad8e0a68`.

Local evidence is in `outputs/release-0.3.22/`; screenshots, raw diagnostics, and test dependencies are not committed. Earlier candidate archives remain immutable and are not promoted by this report. Store upload, review, and public availability are recorded separately in `SUBMISSION_STATUS.md`; Firefox channels are separate in `FIREFOX_SUBMISSION_STATUS.md`.

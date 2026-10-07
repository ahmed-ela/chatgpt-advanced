# Queue header hover — 0.3.10

## Change

The queue title inherited the generic button hover background, producing a highlight over the header. Version 0.3.10 adds `.title:hover{background:transparent}` after the title's existing rule. This removes that highlight in light and dark themes, with the queue expanded or collapsed. The title still toggles the queue, and its keyboard focus outline remains available.

This is the only runtime source change from 0.3.9. Queue sending, acknowledgement, persistence, pause/resume, row numbers, reorder handles, and action-button hover feedback retain their existing behavior. The release also includes 0.3.7–0.3.9's identity and acknowledgement fixes because it updates the same public item currently serving 0.3.6.

## Verification

- Full suite: **577 tests passed, zero failures, 2,623 assertions** across 16 files. TypeScript, version consistency, and diff checks passed.
- Actual browser pointer hover was confirmed through CDP. Before the patch, the title's hovered background was `rgb(233, 233, 233)` in light mode and `rgb(58, 58, 58)` in dark mode. With the patch, it was transparent (`rgba(0, 0, 0, 0)`) in both themes and both expanded/collapsed states.
- An idle row retained number opacity `0.45` and grip opacity `0`. Hovering row 1 faded its number to `0` and its grip to `0.65`; row 2 remained unchanged.
- A live pointer drag reordered two rows while the queue was paused. No provider AI requests were sent for this UI check.
- Independent package review confirmed that, compared with the 0.3.9 production ZIP, only `manifest.json` and `queue-ui.js` changed. Removing the single hover rule makes the queue UI bundle identical to 0.3.9. `content.js`, `queue-worker.js`, icons, privacy page, and license notices are identical.
- Production release validation passed for all ten files. The archive matches the validated extension directory, uses only the three supported HTTPS provider matches, and contains no development reload hooks, source maps, or unexpected permissions.

The originating worktree's `.local/hover-test-results.txt` retains the full test output. UI evidence is in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/chrome-web-store-0.3.10/`: `hover-measurements.json`, `grip-hover.json`, and `queue-hover-dark.png`.

## Chrome Store update

The exact public item `fgajmfkookghcacddnmhfkamefndgfei` accepted the upload and submission of **0.3.10**. At **2026-10-07 at 12:35:57.226 UTC**, the dashboard confirmed **Pending review**, revision `00004`, Public distribution, all regions, free of charge, and automatic publication after approval. The published version remained **0.3.6**. Upload and submission do not establish approval or availability of 0.3.10.

Submitted archive: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/work/queue-hover-highlight/.local/release/0.3.10/threadlane-0.3.10.zip`.

SHA-256: `f4655b32987f0467d99cbece042143b0b262e87e0057e9db4e5a7fa722276dfe`.

Submission evidence is preserved alongside the UI evidence: `submission.json`, `pending-package-ax.txt`, `pending-status-ax.txt`, `pending-package-0.3.10.png`, `pending-0.3.10.png`, and `submitted-success.png`. See [submission status](SUBMISSION_STATUS.md) for current and historical channel records.

## Deployment limits

Local development deployment remains pending merge and the guarded reload at the time of this report. The production upload does not activate the development installation. Firefox signing, public review, and the self-hosted update feed were not changed by this Chrome update.

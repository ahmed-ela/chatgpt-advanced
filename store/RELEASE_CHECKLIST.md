# Threadlane public release checklist

Unchecked items are release gates, not claims that checks have passed. Record the tested commit, version, ZIP hash, browser version, provider, date, and observed result when completing them. Public distribution is authorized and still requires store review. [Chrome distribution guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/).

Latest public listing check: **0.3.16 is published**, updated October 26 and verified October 27, 2026 (America/Los_Angeles). **0.3.22 was submitted October 27 at 15:42 PDT and is Pending review, revision 00010, with automatic publication after approval enabled.** [RELEASE_0.3.22.md](RELEASE_0.3.22.md) records qualification scope, including 864 passing tests and the distinction between prior installed Chrome evidence and Firefox/other-provider fixtures. [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md) tracks the separate review/publication gates. The reusable checks below do not claim every operation was repeated for this patch.

## Recorded 0.3.22 release and submission

- [x] Source [PR #13](https://github.com/ahmed-ela/chatgpt-advanced/pull/13) squash-merged as `31d583100508423c010509047d14ea0182538988`; 864 tests passed, with TypeScript, version consistency, and package validation checks.
- [x] Exact Chrome candidate submitted: SHA-256 `fd20e336fa4266c008e65e13ec595bc631ce7e6610c7ae9141da97d0151693c8`; hosted privacy disclosure updated and read back.
- [x] Correct Threadlane Support publisher account and existing public item confirmed. Listing description updated; icons and three provider screenshots retained. Public/free/all-regions distribution retained.
- [x] Successful submission and Pending review read back for draft 0.3.22/revision 00010 at `2026-10-27T22:42:35.155Z`; automatic publication checkbox was selected. Published version remains 0.3.16.
- [ ] Verify 0.3.22 approval and public installation availability after review.
- [ ] Verify the installed public 0.3.22 build on the supported providers. Prior installed Chrome results and Firefox fixtures are not fresh exact-candidate qualification.

Firefox 0.3.22 remains locally prepared; this Chrome submission did not sign, submit, or distribute either Firefox channel. Local receipt and UI evidence are under `outputs/release-0.3.22/`; see [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md).

## Recorded 0.3.15 qualification

- [x] Full suite passed: 691 tests, 3,120 assertions across 16 files; TypeScript, version consistency, package validation, and independent production-script byte parity checks passed.
- [x] Exact ten-file production candidate installed under the existing local extension identity, preserving storage; user completed manual Reload, and fresh provider tabs showed no development attributes.
- [x] ChatGPT, Claude, and Gemini transferred and cleared a reply batch, kept it cleared after refresh, and inserted a later batch containing only new replies. Claude's existing-draft guard preserved the draft and note. ChatGPT native Send received `BATCH_THREE_OK`; no Claude or Gemini message was sent. Test-generated drafts were cleared.
- [x] Hosted privacy policy updated and read back with exact content parity.
- [x] Verified Chrome ZIP submitted successfully: SHA-256 `1aa14a7cdcfb8c48fa36ef185b197476cba520a092417f83fa0985b4a8f59dcb`. Dashboard confirms Pending review, draft 0.3.15, revision 00008, published 0.3.12; Public/free/all-regions distribution and automatic publication after approval were verified.
- [x] Firefox archive built and validated; no Mozilla publication requested or performed.
- [ ] Verify 0.3.15 approval and public availability after review.
- [ ] Install the publicly available 0.3.15 from the real listing in a clean profile and verify its behavior.

## Local candidate

- [ ] Review the complete diff and confirm the intended version/changelog. Run `bun run version:check`, `bunx tsc --noEmit`, and `bun test`.
- [ ] Run `bun run package:release`. The command creates `.local/release/<version>/extension/`, `threadlane-<version>.zip`, and its SHA-256 file. It does not overwrite the installed development `dist/`, upload, or publish. A candidate directory is immutable; choose a new `--outdir <release-root>` for a fresh candidate or remove an obsolete local candidate explicitly.
- [ ] Confirm the ZIP has `manifest.json` at its root, the expected version, only the three supported HTTPS content-script matches, no extra permissions, no development hooks, no source maps, all four icon sizes, the privacy page, and Lucide license notices. [Chrome ZIP requirements](https://developer.chrome.com/docs/webstore/prepare/).
- [ ] Confirm the source policy and packaged privacy page match the final storage and sending behavior. Use threadlane.support@gmail.com for support and the [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf).

## Installed production build

Use a separate test profile with a production candidate, and harmless sample conversations. Do not replace or disturb an active development chat or draft. Fixtures and unit tests are useful evidence but do not replace these provider checks.

For **each of ChatGPT, Claude, and Gemini**:

- [ ] Create an annotation, edit it, reload and reopen the conversation; verify the highlight/note returns. Delete it in one tab and verify it does not reappear in another or after reload.
- [ ] Insert the annotation prompt, confirm existing drafts/attachments are protected, and confirm successful insertion clears only the transferred reply batch. Verify failed insertion retains notes and newer local or remote edits survive.
- [ ] Queue two distinguishable prompts during a response. Verify order, prompt send after positive completion, immediate removal of the acknowledged row, no duplicate sends, and waiting for the first queued reply before sending the second.
- [ ] Pause an empty/nonempty queue; enqueue while paused; close/reopen tabs/browser; verify saved order, saved edits, and pause state persist.
- [ ] Reorder with the drag handle and keyboard, edit a middle item without changing its slot, cancel an edit, delete an item, and use Send now without disturbing the order of remaining items.
- [ ] Open the same conversation in two tabs; verify no duplicate delivery. Test a stale transcript, navigation during a pending send, and a nonempty composer.
- [ ] Exercise uncertain delivery and verify the queue holds for review rather than retrying automatically after an attempted send. Check attachments and unsupported/new-chat routes fail safely.

Migration and isolation:

- [ ] Seed legacy notes in a disposable supported-site test profile. Confirm successful import into extension storage before the source copy disappears. Simulate a failed import and confirm the original remains and Retry is visible.
- [ ] Verify an unrelated website receives no content script. Confirm the production build makes no localhost reload/version requests and exposes no development reload handler.
- [ ] Verify the privacy page opens from the extension's Options link without network access.
- [ ] Remember that a Chrome Web Store installation normally has a different extension ID from an unpacked development installation. Extension-owned queues/notes do not automatically move between different IDs. There is no export/import feature for those databases in this release; document this for beta testers and do not promise migration.

## Store draft and approval

- [ ] Verify the confirmed threadlane.support@gmail.com publisher account and existing public item before updating it. Registration is complete; check the current dashboard for any new account or security requirements.
- [ ] Enter the already hosted and verified [privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) in the dashboard, with threadlane.support@gmail.com as the support contact.
- [ ] Review [LISTING.md](LISTING.md) and [PRIVACY_FIELDS.md](PRIVACY_FIELDS.md) against the actual dashboard and final ZIP. No placeholder may remain in a submitted field.
- [ ] Add the 128px store icon, the supplied 440×280 small promotional tile, and actual screenshots showing annotations and the queue with sample text. Verify current dashboard dimensions and upload requirements before submission; keep source/promo files outside the extension ZIP.
- [ ] Provide clear reviewer instructions: open one of the three supported sites, use a normal account and an existing conversation, select assistant text to annotate, then enqueue text while a response is running. No test credentials are embedded in the package or repository.
- [ ] Select **Public** and review the final listing, privacy declarations, permissions, version, and ZIP hash with the account owner.
- [ ] Public submission is authorized. Confirm the correct publisher/item and record the real dashboard state afterward; an uploaded draft, submitted review, approved item, and published item are distinct outcomes.
- [ ] After approval/publication, install from the real listing in a clean profile and verify the production flows again. Record the listing URL, published version, and result; do not mark this complete from local tests alone.

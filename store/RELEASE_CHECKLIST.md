# Threadlane public release checklist

Unchecked items are release gates, not claims that checks have passed. Record the tested commit, version, ZIP hash, browser version, provider, date, and observed result when completing them. Public distribution is authorized and still requires store review. [Chrome distribution guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/).

Last recorded distribution state: public Chrome 0.2.5 is pending review with automatic publication after approval; Firefox's signed update feed advertises 0.3.2. Candidate 0.3.4 has not been uploaded to Chrome or published to the Firefox feed. Its live Chrome background check passed on ChatGPT and Claude, while Gemini retained an unfinished native response animation when hidden. Firefox 0.3.4 live verification is pending because computer use could not complete the temporary-add-on file picker. Use [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md), [FIREFOX_SUBMISSION_STATUS.md](FIREFOX_SUBMISSION_STATUS.md), and [BACKGROUND_QUEUE_VERIFICATION.md](BACKGROUND_QUEUE_VERIFICATION.md) for dated evidence; refresh these records after the next actual submission or test.

## Local candidate

- [ ] Review the complete diff and confirm the intended version/changelog. Run `bun run version:check`, `bunx tsc --noEmit`, and `bun test`.
- [ ] Run `bun run package:release`. The command creates `.local/release/<version>/extension/`, `threadlane-<version>.zip`, and its SHA-256 file. It does not overwrite the installed development `dist/`, upload, or publish. A candidate directory is immutable; choose a new `--outdir <release-root>` for a fresh candidate or remove an obsolete local candidate explicitly.
- [ ] Confirm the ZIP has `manifest.json` at its root, the expected version, only the three supported HTTPS content-script matches, no extra permissions, no development hooks, no source maps, all four icon sizes, the privacy page, and Lucide license notices. [Chrome ZIP requirements](https://developer.chrome.com/docs/webstore/prepare/).
- [ ] Confirm the source policy and packaged privacy page match the final storage and sending behavior. Use threadlane.support@gmail.com for support and the [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf).

## Installed production build

Use a separate test profile with a production candidate, and harmless sample conversations. Do not replace or disturb an active development chat or draft. Fixtures and unit tests are useful evidence but do not replace these provider checks.

For **each of ChatGPT, Claude, and Gemini**:

- [ ] Create an annotation, edit it, reload and reopen the conversation; verify the highlight/note returns. Delete it in one tab and verify it does not reappear in another or after reload.
- [ ] Insert the annotation prompt, confirm existing drafts/attachments are protected, and confirm saved notes remain after insertion and send.
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

- [ ] Verify the confirmed threadlane.support@gmail.com publisher account and existing public item before updating it. Registration is complete and the last recorded 0.2.5 submission is pending review; check the current dashboard for any new account or security requirements.
- [ ] Enter the already hosted and verified [privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) in the dashboard, with threadlane.support@gmail.com as the support contact.
- [ ] Review [LISTING.md](LISTING.md) and [PRIVACY_FIELDS.md](PRIVACY_FIELDS.md) against the actual dashboard and final ZIP. No placeholder may remain in a submitted field.
- [ ] Add the 128px store icon, the supplied 440×280 small promotional tile, and actual screenshots showing annotations and the queue with sample text. Verify current dashboard dimensions and upload requirements before submission; keep source/promo files outside the extension ZIP.
- [ ] Provide clear reviewer instructions: open one of the three supported sites, use a normal account and an existing conversation, select assistant text to annotate, then enqueue text while a response is running. No test credentials are embedded in the package or repository.
- [ ] Select **Public** and review the final listing, privacy declarations, permissions, version, and ZIP hash with the account owner.
- [ ] Public submission is authorized. Confirm the correct publisher/item and record the real dashboard state afterward; an uploaded draft, submitted review, approved item, and published item are distinct outcomes.
- [ ] After approval/publication, install from the real listing in a clean profile and verify the production flows again. Record the listing URL, published version, and result; do not mark this complete from local tests alone.

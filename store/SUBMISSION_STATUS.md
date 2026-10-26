# Chrome Web Store submission status

Latest public-listing verification: **October 25, 2026, America/Los_Angeles**.

**Version 0.3.15 is publicly available.** The [Threadlane Store listing](https://chromewebstore.google.com/detail/threadlane/fgajmfkookghcacddnmhfkamefndgfei) shows version **0.3.15**, updated **October 23, 2026**. This supersedes the older pending-review observation below.

**Version 0.3.16 was successfully submitted and is Pending review**, confirmed in the publisher dashboard on **October 25, 2026 at 22:23 PDT (October 26 at 05:23 UTC)**. Automatic publication after approval is enabled; 0.3.15 remains the published version. [PR #10](https://github.com/ahmed-ela/chatgpt-advanced/pull/10) merged as `8384fe662fe6d438608b2ec12011d7523fe83819`. See [the qualification report](QUEUE_VIRTUALIZATION_0.3.16.md), including the incomplete live long-transcript verification. The production Chrome archive has SHA-256 `89f5f1b6b3b55e3c4e76de0f2490f7736e139b73224b9b5437daa3b8c9b74983`.

[LISTING.md](LISTING.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) distinguish local builds, store submission, review, and public availability.

The submitted **0.3.15 production package** clears successfully transferred reply batches, preserving failed insertions and notes outside the transferred snapshot. It also includes the 0.3.13 completion-detection and 0.3.14 later-native-turn queue recovery changes. See [the reply release report](REPLY_BATCH_0.3.15.md) for guards, automated evidence, and live ChatGPT, Claude, and Gemini checks. Source commits and local builds do not change the live Store version.

The earlier public-listing check confirmed 0.3.6 was available on October 7; that historical evidence is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-publication-check-2026-10-07/public-listing-ax.txt`. The authorized publication email was confirmed sent on **2026-10-07 at 12:37:49.851 UTC**, and the completed daily publication automation was deleted. The separate notification record is `outputs/threadlane-publication-monitor.json` in the originating workspace.

## Current public update submission 0.3.16

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Existing public item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00009`; pending package version: **0.3.16**.
- Status: **Pending review**; published version: **0.3.15**.
- Automatic publication after approval: enabled; the submission checkbox was checked before confirmation.
- Existing listing, distribution settings, privacy disclosures, icons, and three provider screenshots were retained.

The verified `/Users/ahmedelamin/Downloads/threadlane-0.3.16.zip` was selected in Chrome's native file picker. Its SHA-256 is `89f5f1b6b3b55e3c4e76de0f2490f7736e139b73224b9b5437daa3b8c9b74983`. The package page showed draft version 0.3.16 before submission. Google's success dialog confirmed submission, and the package page then showed Pending review, revision 00009, draft 0.3.16, and published 0.3.15.

Source [PR #10](https://github.com/ahmed-ela/chatgpt-advanced/pull/10) was squash-merged as `8384fe662fe6d438608b2ec12011d7523fe83819`. All 701 tests passed in the qualification run; see [QUEUE_VIRTUALIZATION_0.3.16.md](QUEUE_VIRTUALIZATION_0.3.16.md) for the live-testing limitation. No runtime changes or new tests were added during submission. No Firefox publication or update-feed promotion was performed by this Chrome release workflow.

Evidence is preserved locally in `outputs/identity-virtualization-2026-10-25/` in the release worktree: `submission-result-ax.txt`, `submission-success-0.3.16.png`, `pending-package-0.3.16-ax.txt`, and `pending-package-0.3.16.png`. This confirms submission, not approval or public availability of 0.3.16.

## Historical submission of the now-public 0.3.15 update

The following records the publisher-dashboard observation on **2026-10-23 at 04:42 UTC (October 22 at 21:42 PDT)**. Its pending status and then-published 0.3.12 version are historical; the public listing was subsequently verified as 0.3.15 above.

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00008`; draft package version: **0.3.15**.
- Update status: **Pending review**; published version remains **0.3.12**.
- Distribution: existing Public, all-regions, free channel verified.
- Automatic publication after approval: enabled; checkbox `Value: 1` confirmed before final submission.
- Successful-submission confirmation: **2026-10-23 at 04:42 UTC (October 22 at 21:42 PDT)**.

Submitted package: `/Users/ahmedelamin/Documents/Codex/2026-10-22/thi/outputs/threadlane-reply-fix/release/0.3.15/threadlane-0.3.15.zip`.

SHA-256: `1aa14a7cdcfb8c48fa36ef185b197476cba520a092417f83fa0985b4a8f59dcb`.

The exact ten-file production candidate was installed under the existing local extension identity and activated by the user's manual Reload. Reply batches cleared after successful insertion on ChatGPT, Claude, and Gemini and remained cleared after refresh. Subsequent batches contained only new replies; ChatGPT's native Send received `BATCH_THREE_OK`. Claude's existing-draft guard preserved its draft and note. No Claude or Gemini message was sent, and test-generated drafts were cleared.

All **691 tests** passed, with **3,120 assertions across 16 files**. TypeScript, version consistency, package validation, and independent production-script byte parity checks passed. The hosted privacy policy was updated and read back with exact content parity. Firefox's archive was built and validated; no Mozilla publication was requested or performed.

Evidence is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-22/thi/outputs/threadlane-reply-fix/`: `submission-result-ax.txt`, `submission-success.png`, `pending-package-ax.txt`, and `pending-package.png`, alongside provider live-check records and package hashes. The success dialog confirms submission; the package dashboard separately confirms Pending review, draft 0.3.15/revision 00008, and published 0.3.12. Approval and public availability of 0.3.15 require later verification.

## Historical public submission 0.3.12

The following records the October 11 submission, before the dashboard confirmed 0.3.12 published on October 22. Its pending status and then-published 0.3.11 version are historical.

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00007`.
- Update status: **Pending review**; published version remains **0.3.11**.
- Distribution: existing Public, all-regions, free channel retained.
- Automatic publication after approval: enabled; the checked submission dialog was captured before final submission.
- Confirmation: **2026-10-11 at 17:40:30.400 UTC**.

Submitted package: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-identity-2026-10-11/release-final/0.3.12/threadlane-0.3.12.zip`. The identical copy at `/Users/ahmedelamin/Downloads/threadlane-0.3.12.zip` was selected for upload.

SHA-256: `96c1ceee3765fa7ff46fe03abdbf05be185eb7ae896db4c5ee89b27e1a7da998`.

The verified archive was uploaded to the existing public item and successfully submitted for review. Source [PR #7](https://github.com/ahmed-ela/chatgpt-advanced/pull/7) was squash-merged as `d24226ea5ff8bdc6feef1b8172412063f5a9a101`. All 602 tests, TypeScript, version consistency, production package validation, and independent package review passed. Firefox's package was built and validated, but this Chrome workflow did not perform Firefox live qualification, Mozilla submission, or update-feed promotion.

Evidence is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-identity-2026-10-11/`: `pending-package-0.3.12-ax.txt`, `submitted-distribution-ax.txt`, `automatic-publication-0.3.12.png`, `distribution-0.3.12.png`, and `pending-review-0.3.12.png`. The package accessibility capture showed pending draft version 0.3.12, revision 00007, and published version 0.3.11; the distribution captures confirmed Pending review and the retained public channel.

## Historical public submission 0.3.11

The following records the October 7 submission, before the dashboard confirmed 0.3.11 published on October 11. Its pending status and then-published 0.3.6 version are historical.

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00006`.
- Update status: **Pending review**; published version remains **0.3.6**.
- Distribution: existing Public, all-regions, free channel retained.
- Automatic publication after approval: enabled; the checked submission dialog was captured before final submission.
- Confirmation: **2026-10-07 at 13:16:53.511 UTC**.

Submitted package: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/chrome-web-store-0.3.11/release/0.3.11/threadlane-0.3.11.zip`.

SHA-256: `06b21bfc332187acfff75eaf28b16875b8183d90815f574211c8aa2427ac2153`.

The previous 0.3.10 review was canceled, the verified 0.3.11 archive uploaded, the separate Store icon and promotional tile replaced after user confirmation, and the listing saved and successfully resubmitted. All three provider screenshots remain present. Only the four icon PNGs and manifest version differ from the 0.3.10 production archive; runtime scripts and permissions are byte-identical or unchanged. All 577 tests, TypeScript, version consistency, production package validation, and independent asset review passed.

Evidence is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/chrome-web-store-0.3.11/`: `preparation.json`, `submission.json`, `automatic-publication.jpg`, `submitted-success.jpg`, `pending-listing-ax.txt`, `pending-flame-icon.jpg`, `pending-package-ax.txt`, and `pending-package-0.3.11.jpg`. The package page showed pending draft version 0.3.11, revision 00006, and published version 0.3.6. Shared source icons apply to future Firefox builds; no Firefox signing, Mozilla submission, or update-feed promotion was performed by this Chrome workflow.

## Historical public submission 0.3.10

The following records the October 7 submission that was subsequently canceled and replaced by the 0.3.11 icon release above. Its pending status is historical.

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00005`.
- Update status: **Pending review**; published version remains **0.3.6**.
- Distribution: Public, all regions, free of charge.
- Automatic publication after approval: enabled.
- Confirmation: **2026-10-07 at 13:00:04.533 UTC**.

Submitted package: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/work/queue-hover-highlight/.local/release/0.3.10/threadlane-0.3.10.zip`.

SHA-256: `f4655b32987f0467d99cbece042143b0b262e87e0057e9db4e5a7fa722276dfe`.

The exact archive passed production release validation. Relative to the verified 0.3.9 package, only the manifest version and the queue UI hover rule differ; all remaining production files are identical. Firefox signing, its public submission, and its update feed were not changed by this Chrome upload.

The initial 0.3.10 submission was confirmed at **12:35:57.226 UTC** as revision `00004`. To add the requested provider screenshots, that pending review was canceled, the listing was saved with three images, and the same package was successfully resubmitted. Revision `00005` was then confirmed pending review, with the existing published 0.3.6 still available. No runtime package changes or new permissions were introduced by the screenshot update.

The ordered images, capture provenance, dimensions, and hashes are committed under [assets/screenshots](assets/screenshots/README.md). New Claude and Gemini captures show real, isolated herb conversations with the same paused basil and thyme follow-ups as the original ChatGPT image. They were captured on installed development runtime 0.3.9 while 0.3.10 activation was deferred to protect other-tab activity; this is a listing asset change, not new runtime qualification.

Evidence for the renewed submission is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/provider-demos-2026-10-07/`: `submission.json`, `submitted-success.jpg`, `pending-listing-ax.txt`, `pending-three-screenshot-gallery.jpg`, `pending-package-ax.txt`, `pending-package-0.3.10.jpg`, and `pending-status-ax.txt`. The gallery showed Screenshot 1, Screenshot 2, and Screenshot 3; the package page showed draft version 0.3.10, revision 00005, and published version 0.3.6. Initial revision 00004 evidence remains in `outputs/chrome-web-store-0.3.10/` in the originating workspace.

## Separate unlisted beta

**Decision recorded on 2026-10-04: preserve the public release pending review and create a separate unlisted Chrome beta listing.** The beta is named **Threadlane BETA**; it must have its own Web Store item ID and **Unlisted** visibility. Do not cancel or replace the public submission, change its visibility, or upload the beta package to the public item as part of beta setup.

The 0.3.2 beta package and listing materials are prepared, but beta item creation/upload was not confirmed after the file-picker failure. There is no verified beta installation link yet. Resume the separate-item workflow in [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md), then record the beta item ID, version, visibility, and observed review/publication status. The beta also needs its own Google review.

## Historical public submission 0.3.6

The details below record the **2026-10-05 at 18:03:41 UTC** submission, before 0.3.6 was verified published on October 7. Its then-pending status does not describe the current published version or the newer update.

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00003`.
- Distribution: Public, all regions, free of charge.
- Automatic publication after approval: enabled.
- The pending 0.2.5 review was cancelled, the verified 0.3.6 archive was uploaded, and the dashboard confirmed successful resubmission and **Pending review** for 0.3.6.
- The description now matches [LISTING.md](LISTING.md), including background sending on ChatGPT and Claude and Gemini's remaining native-rendering limitation.

Submitted package: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/chrome-web-store-0.3.6/0.3.6/threadlane-0.3.6.zip`.

SHA-256: `1bcbefec65d70f1f1d1a72110b086d8fe18683bf67b0a5fef8a3ae4388d395df`.

Source attribution: the qualified checkout `/Users/ahmedelamin/repos/projects/threadlane-firefox-qualification`, based on commit `d6baa5687cb7f748d6dc30a5cfc60b2541efd6fb`, with uncommitted 0.3.6 changes. The packaging-time working-tree patch has SHA-256 `f9395db8ded00e455a1566611d0a717497d24762b8bebca960af4d7f9e4529f4`; untracked-file hashes are recorded separately. This is not a claim that 0.3.6 has been committed or pushed. `preparation.json` records all ten production file hashes, exact fresh-build byte parity, and source-map parity with the installed live-tested development build `muvjngd6-tkkhq9`. The installed development directory and tracked historical `dist/` were not overwritten by packaging.

Evidence is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/chrome-web-store-0.3.6/`: `preparation.json`, `working-tree.patch`, `submission.json`, `pending-0.3.6.png`, `submitted-success.png`, and the distribution/automatic-publication screenshots. Firefox's public 0.3.5 review and signed 0.3.2 feed were not changed.

At that submission, approval, public availability, and installation required separate verification. The October 7 public-listing check above subsequently confirmed availability of 0.3.6; installation verification is a separate check.

## Historical public submission 0.2.5

On 2026-10-04 at 16:54 UTC, revision `00002` was verified as **Pending review** after 0.2.5 replaced the pending 0.2.3 review. The submitted `threadlane-0.2.5.zip` has SHA-256 `a9df1983b7f5df568217bc9e6cb771d17cbcdba67181e88ad0f1d837fc57f093`. Source and production files are recorded in commit `d820d1adda713139e05da7bd1b6fcf85d57b7aa4`; its committed `dist/` matches all ten files in that historical archive byte for byte. That `dist/` remains preserved and is not the 0.3.6 upload source.

# Chrome Web Store submission status

Latest update verified in the Threadlane publisher dashboard on **2026-10-07 at 13:00:04.533 UTC**.

**Update 0.3.10 is pending review**, store revision `00005`, on the existing public item. Automatic publication after approval is enabled. Matching Claude and Gemini screenshots now accompany the original ChatGPT screenshot in the submitted listing. Pending review is not approval or availability of the update or new screenshots.

**Version 0.3.6 is published and publicly available.** The listing shows version 0.3.6, an Updated date of October 7, 2026, and Add to Chrome. [Install Threadlane](https://chromewebstore.google.com/detail/threadlane/fgajmfkookghcacddnmhfkamefndgfei). This record supersedes the earlier submission status text in [LISTING.md](LISTING.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

The submitted **0.3.10 production package** includes the later identity and send-acknowledgement fixes, plus the queue header hover adjustment. Source commits and local builds do not change the live Store version. See [the queue hover release report](QUEUE_HOVER_0.3.10.md) for the runtime change, verification, and local deployment limits.

Public-listing evidence is preserved in `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-publication-check-2026-10-07/public-listing-ax.txt`. The authorized publication email was confirmed sent on **2026-10-07 at 12:37:49.851 UTC**, and the completed daily publication automation was deleted. The separate notification record is `outputs/threadlane-publication-monitor.json` in the originating workspace.

## Current public update 0.3.10

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

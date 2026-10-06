# Chrome Web Store submission status

Verified in the Threadlane publisher dashboard on **2026-10-05 at 18:03:41 UTC**.

**Version 0.3.6 is pending review. It is not published.** It replaced the pending 0.2.5 submission on the same public item. This record supersedes the earlier submission status text in [LISTING.md](LISTING.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Separate unlisted beta

**Decision recorded on 2026-10-04: preserve the public release pending review and create a separate unlisted Chrome beta listing.** The beta is named **Threadlane BETA**; it must have its own Web Store item ID and **Unlisted** visibility. Do not cancel or replace the public submission, change its visibility, or upload the beta package to the public item as part of beta setup.

The 0.3.2 beta package and listing materials are prepared, but beta item creation/upload was not confirmed after the file-picker failure. There is no verified beta installation link yet. Resume the separate-item workflow in [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md), then record the beta item ID, version, visibility, and observed review/publication status. The beta also needs its own Google review.

## Public submission details

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

Store approval, public availability, and installation from the published listing still require separate verification.

## Historical public submission 0.2.5

On 2026-10-04 at 16:54 UTC, revision `00002` was verified as **Pending review** after 0.2.5 replaced the pending 0.2.3 review. The submitted `threadlane-0.2.5.zip` has SHA-256 `a9df1983b7f5df568217bc9e6cb771d17cbcdba67181e88ad0f1d837fc57f093`. Source and production files are recorded in commit `d820d1adda713139e05da7bd1b6fcf85d57b7aa4`; its committed `dist/` matches all ten files in that historical archive byte for byte. That `dist/` remains preserved and is not the 0.3.6 upload source.

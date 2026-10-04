# Chrome Web Store submission status

Verified in the Threadlane publisher dashboard on **2026-10-04 at 16:54 UTC**.

**Version 0.2.5 is pending review. It is not published.** This record supersedes the earlier registration-blocked and not-submitted status text in [LISTING.md](LISTING.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Separate unlisted beta

**Decision recorded on 2026-10-04: preserve the public release pending review and create a separate unlisted Chrome beta listing.** The beta is named **Threadlane BETA**; it must have its own Web Store item ID and **Unlisted** visibility. Do not cancel or replace the public submission, change its visibility, or upload the beta package to the public item as part of beta setup.

The 0.3.2 beta package and listing materials are prepared, but beta item creation/upload was not confirmed after the file-picker failure. There is no verified beta installation link yet. Resume the separate-item workflow in [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md), then record the beta item ID, version, visibility, and observed review/publication status. The beta also needs its own Google review.

## Public submission details

- Publisher/account: Threadlane, `threadlane.support@gmail.com`.
- Item ID: `fgajmfkookghcacddnmhfkamefndgfei`.
- Store revision: `00002`.
- Distribution: Public, all regions, free of charge.
- Automatic publication after approval: enabled.
- The pending 0.2.3 review was cancelled, the verified 0.2.5 archive was uploaded, and the dashboard confirmed successful submission and **Pending review** for 0.2.5.

Submitted package: `threadlane-0.2.5.zip`.

SHA-256: `a9df1983b7f5df568217bc9e6cb771d17cbcdba67181e88ad0f1d837fc57f093`.

Source and production files are recorded in commit `d820d1adda713139e05da7bd1b6fcf85d57b7aa4`. Its committed `dist/` matches all ten files in the submitted archive byte for byte.

Store approval, public availability, and installation from the published listing still require separate verification.

# Flame icon release 0.3.11

The user supplied `Elegant Black Flame Swoosh.png` on October 7, 2026 and requested its use as Threadlane's icon, a PR, and an update to the Chrome Store submission.

## Changes

- Preserve the original 1254×1254 opaque PNG in `assets/icons/source.png`, with its hash and direct-resize commands in the accompanying README.
- Replace the shared 16, 32, 48, and 128px extension icons with direct resizes of the supplied artwork, preserving its white background and margins.
- Replace the legacy SVG mark with a raster-preview wrapper, and use the same 128px PNG in the 440×280 Store promotional artwork.
- Bump the project from 0.3.10 to 0.3.11 through the SemVer release tool. The manifest template stays versionless.

## Verification

All **577 tests passed**, with zero failures. TypeScript, version consistency, and production release validation passed. An independent review confirmed the source hash, opaque RGB PNG formats, exact dimensions, readable promotional text, and absence of clipping or distortion.

The production archive contains the same ten files as 0.3.10. Only the four icon PNGs and manifest version differ; content, queue UI, worker, privacy page, license, and permissions are unchanged. Packaged icon bytes match the checked-in assets. No new queue behavior is claimed from this branding change.

Candidate: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/chrome-web-store-0.3.11/release/0.3.11/threadlane-0.3.11.zip`.

SHA-256: `06b21bfc332187acfff75eaf28b16875b8183d90815f574211c8aa2427ac2153`.

Source SHA-256: `87e948d50248a3fa9dc482c3213ffdec1f8253dd33a4eb17f671d25ca9c8dbf0`.

Preparation evidence and exact file comparison are recorded in `outputs/chrome-web-store-0.3.11/preparation.json` in the originating workspace. Packaging left installed extension directories intact.

## Distribution

The 0.3.11 Chrome ZIP has been uploaded to the existing public item. Its previous 0.3.10 review was canceled to permit this update; published 0.3.6 remains available. Replacing the separate Store icon and promotional image requires a browser-control confirmation because Google's removal dialog says the operation cannot be undone. That confirmation is pending; the new listing has not yet been submitted for review.

All three provider screenshots remain in the draft. The final review version, revision, date, and automatic-publication setting must be confirmed and recorded in [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md) after submission. Shared source assets apply to future Firefox builds; this Chrome workflow does not sign a Firefox release, change Mozilla's submission, or update its feed.

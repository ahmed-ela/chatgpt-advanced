# Firefox signing and update verification status

## Current verification — October 27, 2026

**Firefox public version 0.3.5 is now available on [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/threadlane/). The self-distributed beta feed remains at 0.3.2. Version 0.3.22 is prepared locally for both channels; neither candidate has been signed, submitted, or distributed.**

- The public listing displays version **0.3.5** and exposes its [public XPI download](https://addons.mozilla.org/firefox/downloads/file/5088810/threadlane-0.3.5.xpi). An anonymous download succeeded. SHA-256: `0af582f7ef6698d04076b7df8aff80fce749269ccefe8c73115af099b1b832be`. Its manifest retains `threadlane@extensions.invalid`, omits `update_url`, and contains Mozilla signature metadata. This verifies public download availability, not a newly observed normal Firefox installation or cryptographic signature verification in Firefox.
- The [public beta feed](https://raw.githubusercontent.com/ahmed-ela/threadlane-updates/main/firefox/updates.json) still advertises only **0.3.2**, matching the sole published `firefox-v0.3.2` release in `ahmed-ela/threadlane-updates`. The feed and hosted XPI were not modified during this release preparation.
- The currently published 0.3.5 package has the older icons. All four icon files differ from the current Chrome flame artwork; the prepared 0.3.22 packages include the current shared icons. The AMO listing icon is separate metadata and was not changed here.

### Prepared 0.3.22 artifacts

- Self-distributed beta: `.local/release/firefox/0.3.22/threadlane-firefox-0.3.22.zip`, SHA-256 `071e697def8dcb26d43ffcc573f7e6fa382eae343c41a0e84bff098d9c59724a`. This manifest retains the stable GitHub update feed. Do not upload this package as the public listed version.
- Public AMO candidate: `outputs/release-0.3.22/firefox/listed/threadlane-firefox-listed-0.3.22.zip`, SHA-256 `da07f99b266c9c315687e28dd496b59667b5381651a0261bd7a26f3dcc7a9068`.
- Matching reviewer source: `outputs/release-0.3.22/firefox/listed/threadlane-firefox-listed-0.3.22-source.zip`, SHA-256 `1393b3a4d08fa2cf6adc9cdfd7014dd72df66942a19649efe2c1e8357b33ec07`.
- The listed candidate omits only `gecko.update_url` compared with the same-version beta manifest; every runtime TypeScript file and the other nine production files match byte for byte. Its copied build and package validators reproduce that channel difference without changing the main source build configuration.
- Fresh extraction of the 31-file reviewer archive, frozen dependency installation with Bun 1.3.5, and a Firefox build reproduced all ten production files byte for byte. Listed-mode web-ext lint reports zero errors, zero notices, and the four existing warnings. Build instructions, source/output hashes, reviewer notes, and preparation receipts are beside the listed artifacts. The source archive excludes dependencies, browser data, private test conversations, and Git metadata.
- **Remaining:** live Firefox qualification of this exact candidate, normal signed installation/update verification, submission/signing, and publication/download readback. Beta promotion additionally requires a verified immutable signed asset and feed update. No API signing credentials were configured in the preparation environment; the existing authorized Mozilla browser session remains the documented submission route. Local build or source reproduction does not establish any of these external results.

## Historical submission and installation record

The sections below retain the state observed on their recorded dates. The October 27 verification above supersedes the earlier public-listing `Awaiting Review` status; it does not retroactively establish the other unfinished installation and update tests.

Latest submission verified on **2026-10-05**. The signed beta installation and update observations below were recorded on 2026-10-04.

**Firefox 0.3.5 has been submitted for a public addons.mozilla.org listing and is Awaiting Review; public installation is not yet verified. The self-distributed beta remains at signed, hosted 0.3.2. Mozilla has also signed 0.3.3, but the real 0.3.2 → 0.3.3 update test is still pending; 0.3.3 has not been installed normally or published to the feed.**

- Mozilla account: `threadlane.support@gmail.com`; add-on profile display name: Threadlane.
- Account and profile creation completed using Google sign-in.
- The account owner completed two-step authentication on 2026-10-04. The 0.3.2 and 0.3.3 release submissions proceeded through **On your own** under the Threadlane account; the earlier file-picker upload blockage is resolved.
- Distribution now has two channels under the same stable identifier `threadlane@extensions.invalid`: a public **On this site** AMO submission at 0.3.5, and the existing **On your own** self-distributed beta. The October 5 public-listing request supersedes the earlier decision to use self-distribution alone. Existing beta installations retain `https://raw.githubusercontent.com/ahmed-ela/threadlane-updates/main/firefox/updates.json` and versioned signed GitHub Release assets; the feed was not changed by the public submission.
- The user returned from account setup to the distribution-selection form. No additional agreement prompt was presented during the subsequent selection/upload step; do not treat that observation as authorization to accept any future new agreement.
- The separate Chrome beta route is an unlisted **Threadlane BETA** Web Store item. Public Chrome 0.3.6 separately replaced pending 0.2.5 on 2026-10-05 and is Pending review; that update did not change either Firefox channel. The browser-specific rationale and release gates are in [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md).
- The public artifact-only host `https://github.com/ahmed-ela/threadlane-updates` now serves the signed 0.3.2 release and its feed entry at host repository commit `cc69b1e`. The feed returned HTTP 200, and the public XPI was read back and matched the signed artifact. The source repository remains private.
- Existing temporary installations do not become normal signed installations automatically. Testers must install the signed release once. A Git push alone does not sign, publish, or distribute extension updates.

## Public AMO 0.3.5 submitted, awaiting review

- Existing add-on record: `3086438`; slug: `threadlane`. Submitted through **On this site** under `threadlane.support@gmail.com` on 2026-10-05.
- Version record `6544671`, file `5088810`: **Awaiting Review**, with creation timestamp `2026-10-05T17:12:57Z`. The dashboard's **Visible** setting is selected, but its preview still reports that the listing is not public. The dashboard-observed listing URL is [addons.mozilla.org/en-US/firefox/addon/threadlane/](https://addons.mozilla.org/en-US/firefox/addon/threadlane/). This is the intended public listing, not proof that it is publicly available or installable. Approval, publication, and normal installation of 0.3.5 remain unverified.
- Saved listing metadata: Threadlane name and annotation/queue summary; description retaining the visible-conversation-tab requirement; experimental flag; Social & Communication category; `threadlane.support@gmail.com` support contact; All Rights Reserved license; complete privacy text; reviewer and release notes. The custom 128px logo was uploaded, Mozilla's generated 32/64/128px images were observed loaded, and the store preview displayed the correct logo. The package's four logo PNGs remain unchanged.
- Uploaded input extension ZIP: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-amo-public-0.3.5/threadlane-firefox-0.3.5.zip`, SHA-256 `87bc9396b643f767c6640940a8b1b7722629699ce4825aeed2e5b133a2de508f`. This is the unsigned input hash. The returned AMO archive has SHA-256 `e347a6f9ba563c0a24c9553fbed924799d0eabdcafd52213c632632c5515c350`; independent payload comparison found nine files byte-identical and the manifest JSON identical, with only its final newline removed. AMO also added empty directory entries and repackaged ZIP metadata. This comparison verifies payload consistency, not Firefox signature acceptance or public availability.
- Reviewer source ZIP: `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-amo-public-0.3.5/threadlane-firefox-0.3.5-source.zip`, SHA-256 `c2ff9671eae835007472a81fd21caac4767a786273f8230868e241aa4c986b23`. The attached source was downloaded through the dashboard as `/Users/ahmedelamin/Downloads/threadlane-0.3.5-src.zip` and matched that exact hash.
- The isolated candidate uses the approved, live-tested 0.3.2 runtime. All runtime source files and nine non-manifest production files are byte-identical to 0.3.2. The output manifest changes only its version to 0.3.5 and removes `browser_specific_settings.gecko.update_url`, retaining the same ID, provider scope, install data permissions, minimum Firefox version, and private-browsing restriction. The unqualified 0.3.4 background-tab changes are excluded.
- Validation passed: TypeScript, version consistency, release-package checks, baseline payload parity, and listed-mode web-ext 10.7.0 lint with zero errors and four existing warnings. Fresh source-archive extraction, frozen dependency installation, and a Bun `1.3.5+1e86cebd7` build on macOS 27.0 ARM64 reproduced all ten production files byte for byte and verified the 29 listed source hashes. The 30-file source archive omits installed dependencies, private evidence, and browser data. Linux reproduction is not verified.
- Reproduction instructions, source/output checksums, `reviewer-notes.txt`, `PREPARATION.md`, `payload-parity.json`, `source-changes.json`, `reproduction.json`, and the `submission.json` receipt are preserved in the same isolated output directory. The receipt records verification at `2026-10-05T17:18:27Z` and points to `mozilla-review-status.jpg` and `mozilla-listing-preview.jpg`. The main development package version and installed builds were not changed for this manifest-only submission.
- This listed manifest uses AMO updates after publication. Existing self-distributed 0.3.2 installations continue using their installed beta feed; this submission does not migrate them. A feed-to-AMO migration would require a separately verified signed higher-version update without `update_url`. See [Mozilla's channel guidance](https://extensionworkshop.com/documentation/publish/distribute-pre-release-versions/).
- New Firefox submissions must use a version **greater than 0.3.5**. The current 0.3.6 development runtime still needs its existing live Firefox/signing gates before submission. Preserve the immutable 0.3.3 update fixture rather than rewriting already signed artifacts.

## Historical tested 0.3.1 packages

The tested extension archive is `threadlane-firefox-0.3.1.zip`, SHA-256 `34b89c45a5e679071d24036eb2e73bb5da1f26c37f1821d76492e16869105d1f`.

The reviewer source archive is `threadlane-firefox-0.3.1-source.zip`, SHA-256 `7722a6efb0395462e147c68139dbb353a572f8d76b1aaabc8b22746ae434563d`. It contains the production build inputs from commit `5c4d8ffd96379c21093bef1867a220284707214b`, pinned build instructions, and expected output hashes. A fresh dependency install and build with Bun 1.3.5 reproduced all ten production files byte for byte on macOS ARM64. Linux reproduction has not been separately verified.

Local artifacts are under `.local/release/firefox/0.3.1/` and `.local/amo/0.3.1/`; they are not committed. The source archive omits Git history, browser data, test conversations, local reports, and installed dependencies.

The [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) was updated again for 0.3.2 from `PRIVACY.md` and read back byte for byte on 2026-10-04. Source, both packaged candidates, and the public copy include the GitHub update-host disclosure, browser-profile storage, lack of cross-browser synchronization, and Firefox's provider-submission data permissions. The old source archive cannot substitute for the changed 0.3.2 package.

## Background queue candidate 0.3.4

The 0.3.4 background queue task created isolated Chrome, Chrome beta, and Firefox packages without changing the signed 0.3.2 feed, publishing the signed 0.3.3 candidate, or updating a Web Store submission. These runtime changes are excluded from the public 0.3.5 candidate above. Shared source subsequently advanced to 0.3.6, and only its Chrome public package was submitted for review on 2026-10-05. Firefox 0.3.6 qualification and signing remain pending; the Firefox channels above are unchanged. See [BACKGROUND_QUEUE_VERIFICATION.md](BACKGROUND_QUEUE_VERIFICATION.md) and [AUTOSEND_PATCH_0.3.6.md](AUTOSEND_PATCH_0.3.6.md).

## Approved, hosted, and installed 0.3.2

- Unsigned submission package: `.local/release/firefox/0.3.2/threadlane-firefox-0.3.2.zip`.
- SHA-256: `6f0a813d9236608d540b979cd6d4518bfbf3ac3be020475b3e1a8aa1edeb524c`.
- Reviewer source: `.local/amo/0.3.2/threadlane-firefox-0.3.2-source.zip`, SHA-256 `04a7f568b938ea5b76b458b79677758bbdc6ee5e694b9a599e1a15fa92e9eb9e`. A fresh frozen dependency install with Bun 1.3.5 on macOS ARM64 reproduced all ten packaged files byte for byte. The archive includes 30 selected source/build files and omits Git history, browser data, local reports, and installed dependencies. Linux reproduction is not verified.
- The extension and matching minimal reproducible source were uploaded to Mozilla. Version record `6541674`, file `5085814`: **Approved**.
- Signed XPI: 68,609 bytes, SHA-256 `b44dfdef9225b4101a02b27120dc46684be799c91d4ca45b2ec1754ce30ca71a`.
- Public signed download: [threadlane-firefox-0.3.2.xpi](https://github.com/ahmed-ela/threadlane-updates/releases/download/firefox-v0.3.2/threadlane-firefox-0.3.2.xpi). The public download matches the signed artifact; the live feed contains its 0.3.2 entry.
- Final release checks: 475 tests, 2,071 assertions, TypeScript, version and diff checks passed. Self-hosted Firefox validation reported zero errors and four existing warnings (Android minimum version and three `innerHTML` uses).
- Runtime source is unchanged from live-tested 0.3.1; manifest, bundled privacy, and release tooling changed.
- The standard Firefox 157 release installed the signed package normally and kept it enabled after a cold restart. Separately, macOS code-signature verification confirmed the installed Firefox application was signed by Mozilla and unmodified. An existing Claude annotation from 0.3.1 remained available. A new 0.3.2 queued test message auto-sent successfully. These observations establish that tested installation and recovery path, not every provider or migration case.
- A new paused queue is staged for update-state retention testing. Its private conversation text and browser data are not included in repository records.
- On 2026-10-04 at 17:15 EDT, the invited tester was emailed the public signed 0.3.2 installer and one-time setup instructions from the support account. Gmail confirmed sending, and the sent message was read back. It distinguishes future periodic signed-feed updates from a source Git push and explicitly states that the first version-to-version test is still in progress.

## Signed 0.3.3 awaiting real update verification

- This version qualifies delivery through the signed Firefox update channel; runtime behavior and permissions are unchanged from 0.3.2. At signing, `package.json` and `CHANGELOG.md` matched the isolated candidate. Current development has advanced to 0.3.6; the immutable 0.3.3 candidate remains separate. The tracked historical Chrome `dist/` remains 0.2.5 and was not used for the 0.3.6 store upload.
- Mozilla version record `6541692`, file `5085832`: **Approved**. The signed XPI was downloaded, but is not yet normally installed or published as a feed release.
- Signed XPI: 68,616 bytes, SHA-256 `af0e20c4df3aa4994c5e1778fec2c3058cd029b24cf2acf8aa292b1e6243fa10`.
- Reviewer source: `.local/update-qualification/0.3.3/threadlane-firefox-0.3.3-source.zip`, SHA-256 `3dbd4b84a3070c9f7a14556fed5abe291f0ca011d1e939564c73c0a2c4f79a6f`. A fresh extraction, frozen dependency install, and build with Bun 1.3.5 reproduced all ten production files. Relative to 0.3.2, only the output manifest version changes.
- The signed 0.3.3 payload has exactly the expected ten production files: nine are byte-identical to the isolated output, and the manifest is JSON-equivalent. Payload comparison is not a substitute for Firefox's own signature verification or a real update test.

## Verification still needed

The real **0.3.2 → 0.3.3** signed update and retention of annotations/paused queue state remain pending. A fresh isolated Firefox profile currently presents first-run Terms requiring the user's action-time approval; that request is pending. Keep the feed at its verified 0.3.2 release until the 0.3.3 publication checks pass, then exercise Firefox's normal update mechanism and record the resulting version and retained state. Separately, confirm AMO approval and actual public installation availability for listed 0.3.5, and test its normal signed installation. Do not describe this first signed installation, source reproduction, approval, or Awaiting Review status as proof that an automatic version upgrade or public publication occurred. Historical 0.3.1 temporary-installation results and limits remain recorded in [FIREFOX.md](FIREFOX.md).

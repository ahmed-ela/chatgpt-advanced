# Firefox signing and update verification status

Verified on **2026-10-04**.

**Firefox 0.3.2 is Mozilla-approved, signed, hosted publicly, and installed normally in Firefox 157. Its live update feed advertises 0.3.2. Mozilla has also approved and signed 0.3.3, but the real 0.3.2 → 0.3.3 update test is still pending; 0.3.3 has not been installed normally or published to the feed.**

- Mozilla account: `threadlane.support@gmail.com`; add-on profile display name: Threadlane.
- Account and profile creation completed using Google sign-in.
- The account owner completed two-step authentication on 2026-10-04. Both release submissions proceeded through **On your own** under the Threadlane account; the earlier file-picker upload blockage is resolved.
- Selected distribution: Mozilla **On your own** signing and self-distribution, with no public AMO listing. Keep the stable add-on identifier `threadlane@extensions.invalid`. The live feed is `https://raw.githubusercontent.com/ahmed-ela/threadlane-updates/main/firefox/updates.json`; signed XPI files use versioned GitHub Release assets. This supersedes the earlier public AMO listing plan.
- The user returned from account setup to the distribution-selection form. No additional agreement prompt was presented during the subsequent selection/upload step; do not treat that observation as authorization to accept any future new agreement.
- The separate Chrome beta route is an unlisted **Threadlane BETA** Web Store item; the public Chrome 0.2.5 submission is preserved. The browser-specific rationale and release gates are in [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md).
- The public artifact-only host `https://github.com/ahmed-ela/threadlane-updates` now serves the signed 0.3.2 release and its feed entry at host repository commit `cc69b1e`. The feed returned HTTP 200, and the public XPI was read back and matched the signed artifact. The source repository remains private.
- Existing temporary installations do not become normal signed installations automatically. Testers must install the signed release once. A Git push alone does not sign, publish, or distribute extension updates.

## Historical tested 0.3.1 packages

The tested extension archive is `threadlane-firefox-0.3.1.zip`, SHA-256 `34b89c45a5e679071d24036eb2e73bb5da1f26c37f1821d76492e16869105d1f`.

The reviewer source archive is `threadlane-firefox-0.3.1-source.zip`, SHA-256 `7722a6efb0395462e147c68139dbb353a572f8d76b1aaabc8b22746ae434563d`. It contains the production build inputs from commit `5c4d8ffd96379c21093bef1867a220284707214b`, pinned build instructions, and expected output hashes. A fresh dependency install and build with Bun 1.3.5 reproduced all ten production files byte for byte on macOS ARM64. Linux reproduction has not been separately verified.

Local artifacts are under `.local/release/firefox/0.3.1/` and `.local/amo/0.3.1/`; they are not committed. The source archive omits Git history, browser data, test conversations, local reports, and installed dependencies.

The [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) was updated again for 0.3.2 from `PRIVACY.md` and read back byte for byte on 2026-10-04. Source, both packaged candidates, and the public copy include the GitHub update-host disclosure, browser-profile storage, lack of cross-browser synchronization, and Firefox's provider-submission data permissions. The old source archive cannot substitute for the changed 0.3.2 package.

## Background queue candidate 0.3.4

The current source includes the background-tab queue fix and isolated Chrome, Chrome beta, and Firefox 0.3.4 packages. This does not change the signed 0.3.2 feed, publish the signed 0.3.3 candidate, or update any Web Store submission. Firefox 0.3.4 still requires signing and live Firefox verification. See [BACKGROUND_QUEUE_VERIFICATION.md](BACKGROUND_QUEUE_VERIFICATION.md).

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

- This version qualifies delivery through the signed Firefox update channel; runtime behavior and permissions are unchanged from 0.3.2. At signing, `package.json` and `CHANGELOG.md` matched the isolated candidate. Current development has advanced to 0.3.4; the immutable 0.3.3 candidate remains separate. The public Chrome `dist/` remains 0.2.5.
- Mozilla version record `6541692`, file `5085832`: **Approved**. The signed XPI was downloaded, but is not yet normally installed or published as a feed release.
- Signed XPI: 68,616 bytes, SHA-256 `af0e20c4df3aa4994c5e1778fec2c3058cd029b24cf2acf8aa292b1e6243fa10`.
- Reviewer source: `.local/update-qualification/0.3.3/threadlane-firefox-0.3.3-source.zip`, SHA-256 `3dbd4b84a3070c9f7a14556fed5abe291f0ca011d1e939564c73c0a2c4f79a6f`. A fresh extraction, frozen dependency install, and build with Bun 1.3.5 reproduced all ten production files. Relative to 0.3.2, only the output manifest version changes.
- The signed 0.3.3 payload has exactly the expected ten production files: nine are byte-identical to the isolated output, and the manifest is JSON-equivalent. Payload comparison is not a substitute for Firefox's own signature verification or a real update test.

## Verification still needed

The real **0.3.2 → 0.3.3** signed update and retention of annotations/paused queue state remain pending. A fresh isolated Firefox profile currently presents first-run Terms requiring the user's action-time approval; that request is pending. Keep the feed at its verified 0.3.2 release until the 0.3.3 publication checks pass, then exercise Firefox's normal update mechanism and record the resulting version and retained state. Do not describe this first signed installation, source reproduction, or approval as proof that an automatic version upgrade occurred. Historical 0.3.1 temporary-installation results and limits remain recorded in [FIREFOX.md](FIREFOX.md).

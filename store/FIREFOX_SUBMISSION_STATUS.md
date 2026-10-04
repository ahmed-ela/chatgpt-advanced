# Firefox submission preparation

Verified on **2026-10-04**.

**Firefox 0.3.1 remains an unsigned, unsubmitted temporary beta. The selected successor is a signed, self-distributed 0.3.2 beta with an HTTPS update feed; signing and automatic updates are not yet verified.**

- Mozilla account: `threadlane.support@gmail.com`; add-on profile display name: Threadlane.
- Account and profile creation completed using Google sign-in.
- Mozilla requires two-step authentication before the first add-on submission. The account owner must complete credential setup before submission can continue.
- Selected distribution: Mozilla **On your own** signing and self-distribution, with no public AMO listing. Keep the stable add-on identifier `threadlane@extensions.invalid`. The intended feed is `https://raw.githubusercontent.com/ahmed-ela/threadlane-updates/main/firefox/updates.json`; signed XPI files will be versioned GitHub Release assets. This supersedes the earlier public AMO listing plan.
- Mozilla account terms/profile creation do not establish acceptance of any separately presented developer distribution agreement. Complete that step if the submission flow requires it.
- The separate Chrome beta route is an unlisted **Threadlane BETA** Web Store item; the public Chrome 0.2.5 submission is preserved. The browser-specific rationale and release gates are in [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md).
- The public artifact-only host `https://github.com/ahmed-ela/threadlane-updates` and empty feed were initialized on 2026-10-04 at repository commit `a7778be`. The raw feed returned HTTP 200 with `updates: []`. No signed update is advertised by an empty feed. The source repository remains private.
- The current temporary installation does not become a normal signed installation automatically. Install the signed release once available. A Git push alone does not sign, publish, or distribute extension updates.

## Historical tested 0.3.1 packages

The tested extension archive is `threadlane-firefox-0.3.1.zip`, SHA-256 `34b89c45a5e679071d24036eb2e73bb5da1f26c37f1821d76492e16869105d1f`.

The reviewer source archive is `threadlane-firefox-0.3.1-source.zip`, SHA-256 `7722a6efb0395462e147c68139dbb353a572f8d76b1aaabc8b22746ae434563d`. It contains the production build inputs from commit `5c4d8ffd96379c21093bef1867a220284707214b`, pinned build instructions, and expected output hashes. A fresh dependency install and build with Bun 1.3.5 reproduced all ten production files byte for byte on macOS ARM64. Linux reproduction has not been separately verified.

Local artifacts are under `.local/release/firefox/0.3.1/` and `.local/amo/0.3.1/`; they are not committed. The source archive omits Git history, browser data, test conversations, local reports, and installed dependencies.

The [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) was updated again for 0.3.2 from `PRIVACY.md` and read back byte for byte on 2026-10-04. Source, both packaged candidates, and the public copy include the GitHub update-host disclosure, browser-profile storage, lack of cross-browser synchronization, and Firefox's provider-submission data permissions. The old source archive cannot substitute for the changed 0.3.2 package.

## Prepared 0.3.2 candidate

- Unsigned submission package: `.local/release/firefox/0.3.2/threadlane-firefox-0.3.2.zip`.
- SHA-256: `6f0a813d9236608d540b979cd6d4518bfbf3ac3be020475b3e1a8aa1edeb524c`.
- Reviewer source: `.local/amo/0.3.2/threadlane-firefox-0.3.2-source.zip`, SHA-256 `04a7f568b938ea5b76b458b79677758bbdc6ee5e694b9a599e1a15fa92e9eb9e`. A fresh frozen dependency install with Bun 1.3.5 on macOS ARM64 reproduced all ten packaged files byte for byte. The archive includes 30 selected source/build files and omits Git history, browser data, local reports, and installed dependencies. Linux reproduction is not verified.
- Final release checks: 475 tests, 2,071 assertions, TypeScript, version and diff checks passed. Self-hosted Firefox validation reported zero errors and four existing warnings (Android minimum version and three `innerHTML` uses).
- Runtime source is unchanged from live-tested 0.3.1; manifest, bundled privacy, and release tooling changed. Existing live results do not prove a signed installation or an update.
- Mozilla two-step setup remains the external gate. No signed XPI or feed release entry has been published.

## Verification still needed

Complete account two-step authentication and Mozilla's self-distribution submission flow, resolve validator/reviewer findings, and obtain the signed package. Then verify normal site/data permissions, Firefox exit/restart recovery, the hosted feed and signed download, and a real higher-version update that retains notes and queue state. Record final package/version/hashes and hosted links after observation; proposed URLs and local scripts do not establish a deployed update channel. Existing 0.3.1 temporary-installation results and limits remain recorded in [FIREFOX.md](FIREFOX.md).

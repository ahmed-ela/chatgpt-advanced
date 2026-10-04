# Firefox submission preparation

Verified on **2026-10-04**.

**Firefox 0.3.1 is unsigned and has not been submitted to Mozilla. Automatic updates are not enabled for the temporary beta.**

- Mozilla account: `threadlane.support@gmail.com`; add-on profile display name: Threadlane.
- Account and profile creation completed using Google sign-in.
- Mozilla requires two-step authentication before the first add-on submission. The account owner must complete credential setup before submission can continue.
- Planned distribution: a listed Firefox Add-ons release. Keep the stable add-on identifier `threadlane@extensions.invalid`; publish higher versions to the same listing so Firefox can discover updates through Mozilla.
- The current temporary installation does not become a normal signed installation automatically. Install the signed release once available. A Git push alone does not sign, publish, or distribute extension updates.

## Prepared packages

The tested extension archive is `threadlane-firefox-0.3.1.zip`, SHA-256 `34b89c45a5e679071d24036eb2e73bb5da1f26c37f1821d76492e16869105d1f`.

The reviewer source archive is `threadlane-firefox-0.3.1-source.zip`, SHA-256 `7722a6efb0395462e147c68139dbb353a572f8d76b1aaabc8b22746ae434563d`. It contains the production build inputs from commit `5c4d8ffd96379c21093bef1867a220284707214b`, pinned build instructions, and expected output hashes. A fresh dependency install and build with Bun 1.3.5 reproduced all ten production files byte for byte on macOS ARM64. Linux reproduction has not been separately verified.

Local artifacts are under `.local/release/firefox/0.3.1/` and `.local/amo/0.3.1/`; they are not committed. The source archive omits Git history, browser data, test conversations, local reports, and installed dependencies.

The [public privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf) was updated from `PRIVACY.md` and read back byte for byte. It now describes browser-profile storage, lack of cross-browser synchronization, and Firefox's provider-submission data permissions.

## Verification still needed

Complete Mozilla's submission flow, resolve any validator or reviewer findings, obtain the signed package, and verify normal site/data permissions plus Firefox exit/restart recovery. Confirm the published listing and update channel before describing automatic updates as operational. The existing live temporary-installation results and their limits are recorded in [FIREFOX.md](FIREFOX.md).

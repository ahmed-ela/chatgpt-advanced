# Beta distribution and automatic updates

Beta channels selected on **2026-10-04**; public Firefox submission added on **2026-10-05**. Firefox **0.3.5** is submitted to addons.mozilla.org and **Awaiting Review**, without verified public installation availability. The existing beta **0.3.2** is signed, approved, hosted, and installed normally; **0.3.3** is signed and approved but awaits feed publication and a real version-update test. Chrome beta **0.3.2** remains a prepared package without a confirmed upload. Observations and remaining gates are recorded below; signing, submission, or a first installation alone does not prove publication or an automatic version upgrade.

| Browser / channel | Initial installation | Later updates |
| --- | --- | --- |
| Chrome beta: separate **Threadlane BETA** Web Store item, **Unlisted** | Install once from its published Web Store link | Publish a higher version to that same beta item; Chrome distributes it after Google's review/publication |
| Firefox public: existing Threadlane add-on, **On this site**, 0.3.5 Awaiting Review | Install from the AMO listing once approval/publication and installation availability are confirmed | Publish higher listed versions to that same AMO add-on; this manifest omits the self-hosted update URL |
| Firefox beta: Mozilla-signed **self-distributed** add-on | Install the signed XPI once in desktop Firefox | Firefox checks the stable HTTPS feed and installs eligible higher signed versions |
| Existing unpacked Chrome or temporary Firefox beta | Developer-mode or temporary loading | Remains manual; these copies do not become normal store/signed installs automatically |

The public Chrome item `fgajmfkookghcacddnmhfkamefndgfei` remains separate from the beta. Its 0.3.6 submission replaced pending 0.2.5 on 2026-10-05 and is **Pending review**, with Public distribution and automatic publication after approval; [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md) records the exact package and dated history. This separately authorized public update does not change the decision to create a distinct unlisted beta. Creating that beta does not cancel, replace, or verify approval of the public submission. The October 5 request restores a public AMO channel alongside Firefox's existing self-distributed beta, superseding the earlier self-distribution-only decision. Public AMO version `6544671`, file `5088810`, belongs to existing add-on `3086438`, slug `threadlane`, and is Awaiting Review; [FIREFOX_SUBMISSION_STATUS.md](FIREFOX_SUBMISSION_STATUS.md) records its immutable candidates and source-attachment hash verification.

## Why the browsers use different channels

For ordinary Windows/macOS users, Chrome supports direct installation and automatic updates through the Chrome Web Store. Self-hosted Chrome installation on those systems requires enterprise policies; Linux has a separate exception. An unlisted Store beta supplies an ordinary installation/update experience without a native helper, an enterprise-management setup, or asking testers to reload unpacked files. [Chrome distribution](https://developer.chrome.com/docs/extensions/how-to/distribute).

Firefox permits self-distribution of Mozilla-signed extensions. A stable `update_url` lets Firefox retrieve later signed versions without a public AMO listing. Signing/review still applies; hosting the ZIP yourself does not replace Mozilla signing. [Mozilla self-distribution](https://extensionworkshop.com/documentation/publish/self-distribution/).

Firefox's public AMO channel uses the same add-on ID but omits `update_url`, so installations from that channel use Mozilla's updates. Existing beta users retain the feed embedded in their installed version. A public listing does not automatically move beta installations to AMO; migration needs a separately tested signed higher version delivered through the existing feed without `update_url`. [Mozilla's listed and beta channel guidance](https://extensionworkshop.com/documentation/publish/distribute-pre-release-versions/).

These channels are **link-accessible, not access-controlled invitations**. Anyone who receives the unlisted Chrome link can install it once published. The Firefox feed and signed downloads are public. Direct emails to testers are invitations to try the beta, not technical access restrictions. Unlisted Chrome items have the same review and policy requirements as public items. [Chrome visibility options](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## Chrome beta listing requirements

Google permits a testing item alongside a production item when its name clearly ends in **BETA** or **DEVELOPMENT BUILD**, and its description states **THIS EXTENSION IS FOR BETA TESTING**. This beta uses **Threadlane BETA** and that exact opening sentence. Keep those labels on subsequent releases; they distinguish the beta from the pending public Threadlane item under Google's repetitive-content policy. [Test-version guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution#publish-a-test-version), [spam policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/spam-faq).

A new beta item needs its own listing, privacy declarations, screenshots, icon, promotional image, and review. Required image inputs are a 128×128 PNG extension icon, a 440×280 promotional image, and at least one full-bleed screenshot at 1280×800 or 640×400. Screenshots must show the actual current experience and omit private conversations/account details. Existing artwork may be reused where accurate; a historical screenshot is not new-candidate live verification. [Chrome image requirements](https://developer.chrome.com/docs/webstore/images).

## Firefox signing and feed identity

- Stable add-on ID: `threadlane@extensions.invalid`.
- Beta channel: Mozilla Developer Hub **On your own** (self-distribution), retaining the installed stable feed. Public channel: **On this site**, omitting `update_url` in the separately prepared listed candidate.
- Stable feed: `https://raw.githubusercontent.com/ahmed-ela/threadlane-updates/main/firefox/updates.json`.
- Artifact hosting: versioned signed XPI assets in GitHub Releases of the public `ahmed-ela/threadlane-updates` repository.
- Source code stays in the separate private `ahmed-ela/chatgpt-advanced` repository. Publish only intended distribution artifacts and feed metadata in the public repository, not credentials, source-review archives, test conversations, browser data, or raw screenshots.
- The feed includes the exact add-on ID, higher version, public HTTPS signed-XPI URL, compatible Firefox version, and SHA-256 of the **signed XPI**. The unsigned submission ZIP's checksum is not the signed download checksum.

Keep the installed feed URL reachable indefinitely. Firefox checks the address embedded in the installed version; users cannot discover a replacement if that address disappears. Preserve published versioned artifacts and release forward with a higher version for fixes rather than overwriting an old signed release. The browser's update preferences and cadence still apply; updates are not an instant push. [Firefox update manifest and behavior](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

The public artifact-only repository began with an empty feed on 2026-10-04 (commit `a7778be`). Host commit `cc69b1e` now advertises the signed 0.3.2 release. The feed returned HTTP 200 and the [public signed XPI](https://github.com/ahmed-ela/threadlane-updates/releases/download/firefox-v0.3.2/threadlane-firefox-0.3.2.xpi) was downloaded and matched against the signed artifact. This establishes an available release, not proof of a browser version upgrade. The release tool must refuse to promote unsigned, mismatched, or unavailable artifacts.

## Build and release workflow

The release commands prepare artifacts; they do not remove the review/signing gates:

```sh
bun run build:chrome-beta
bun run package:chrome-beta
bun run build:firefox
bun run package:firefox
```

Chrome beta output is `.local/release/chrome-beta/<version>/threadlane-chrome-beta-<version>.zip`. Self-distributed Firefox output is `.local/release/firefox/<version>/threadlane-firefox-<version>.zip`. These shared-source commands still produce the beta's feed-bearing Firefox manifest; do not upload it as a public AMO candidate. The listed 0.3.5 package and matching source were prepared separately from verified 0.3.2 under `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/threadlane-amo-public-0.3.5/`, with only output manifest version/update-channel changes. Use the actual package hashes produced for the final candidate; 0.3.1's test and archive records are historical. New Firefox submissions must use a version greater than 0.3.5; the unqualified 0.3.4 runtime cannot be submitted unchanged under its old version.

Before distributing each candidate:

1. Increase the version, record changes, and run version, TypeScript, automated, manifest/package, and Firefox validator checks. Verify relevant provider flows on the exact candidate. Keep source, bundled, and public privacy disclosures aligned with the final behavior, including Firefox's GitHub update/download hosts.
2. For Chrome, upload only the beta ZIP to the distinct **Threadlane BETA** item, select **Unlisted**, complete beta-labelled listing/privacy fields, and submit. Read back the resulting item ID, version, visibility, and review status. Verify its live installation link after publication; uploading is not publishing.
3. For Firefox, complete account two-step authentication and any separately required developer agreement. Select the intended channel explicitly: **On your own** for the feed-bearing beta, or **On this site** for a listed manifest without `update_url`. Upload the exact corresponding reproducible source, address review findings, and retrieve Mozilla's signed XPI. For the listed channel, confirm approval/publication and actual installation availability at the observed AMO listing URL; submission is not publication.
4. Verify the signed XPI's provenance, signature, add-on ID, version, intended update channel, contents, and checksum. Install it normally in an isolated Firefox profile and verify site/data consent, all three providers, saved notes/queue state, and browser restart recovery.
5. For the beta, upload the verified signed XPI to its immutable public release URL. Read the download back and verify its hash. Only then generate and publish a feed entry that points to that exact artifact; read the feed back and validate it. A failed signing/download/hash check must leave the previous feed untouched. Listed AMO publication does not require publishing a beta-feed entry and must not silently replace its release.
6. Exercise a real eligible higher-version update from an installed signed baseline, using Firefox's normal update controls. Verify the resulting version and retained annotations/queue state. A single first installation cannot prove an update occurred.
7. Send testers the actual install link or signed file and explain which channel they are joining. Record package, source commit, signed-file hashes, listing/release URLs, dates, and observed verification separately from preparation.

The feed CLI can prepare an empty manifest with `bun run feed:firefox --empty --out <updates.json>`. Promotion requires `--signed-xpi`, `--mozilla-download-url`, `--update-link`, and `--out`; use the release tool's validation and verified values, never substitute an unsigned local ZIP. Authenticated browser downloads can use an explicitly selected, locally recorded receipt after a normal signed Firefox installation; this is trusted operator evidence, not cryptographic verification or an automatic fallback. See the [feed tooling instructions and receipt schema](FIREFOX_FEED_TOOL.md). A normal **source-code Git push alone does not update Chrome or Firefox**. Chrome needs Store publication; Firefox beta needs a signed hosted release and a published feed entry, while Firefox public needs a higher version published through AMO. Automation can perform some steps after configuration, but the existence of scripts is not evidence of an operating end-to-end release pipeline.

## One-time migration and saved data

An unpacked Chrome install, the new beta Store item, and the public Store item have separate extension identities and databases. Installing the beta does not import notes/queues from the unpacked or public copy. Browser/profile changes also use separate storage. There is currently no built-in database export/import.

The temporary Firefox 0.3.1 package has no update feed and is removed on browser exit. Install the signed feed-bearing beta once. In the observed normal 0.3.2 installation and cold-restart test, a prior Claude annotation remained available. That single recovery result does not guarantee every temporary-to-signed migration or all queued data. Keeping the same Gecko ID is necessary for subsequent signed updates; retain important text before migrating.

Before migration, finish any active responses and save/resolve drafts and pending sends. Preserve the old installation if it holds needed notes or queues; uninstalling or clearing storage can destroy them. To avoid duplicate queue handlers, disable the old Chrome extension while keeping its storage, or test the new channel in a separate browser profile. Do not run two Threadlane copies on the same provider conversation. Copy important text manually before any removal if no other backup exists.

## Current external gates

Public AMO 0.3.5 was submitted on 2026-10-05 and is **Awaiting Review** (add-on `3086438`, version `6544671`, file `5088810`). Its observed [Threadlane listing URL](https://addons.mozilla.org/en-US/firefox/addon/threadlane/) is not yet verified publicly available. Its runtime and nine non-manifest production files match approved 0.3.2, excluding 0.3.4's background changes. Listed-mode validation and fresh reviewer-source reproduction passed. Approval/publication and normal signed 0.3.5 installation remain to be verified; the beta feed is unchanged.

Mozilla account/profile creation and two-step authentication are complete. **On your own** submissions succeeded for both Firefox versions, and the earlier upload blockage is resolved. Version 0.3.2 is Approved (Mozilla version `6541674`, file `5085814`), signed, hosted, and installed normally in Firefox 157. Firefox verified its Mozilla application signature and retained the enabled installation after a cold restart. A prior Claude annotation remained available, and a new queued test message auto-sent successfully. The 0.3.2 feed and public artifact were read back and verified.

Version 0.3.3 is also Approved (Mozilla version `6541692`, file `5085832`), and its signed file has been downloaded and compared with the reproducible candidate. It is not yet normally installed or published to the feed. The real **0.3.2 → 0.3.3** update test, including preservation of a staged paused queue and annotations, remains pending. A fresh isolated Firefox profile presents first-run Terms requiring user approval at that step; the approval request is pending. [FIREFOX_SUBMISSION_STATUS.md](FIREFOX_SUBMISSION_STATUS.md) records the exact hashes and verification limits.

The last observed Chrome dashboard state on 2026-10-05 at 18:03:41 UTC, under `threadlane.support@gmail.com`, showed the existing public item at 0.3.6 **Pending review**, revision `00003`, after replacing pending 0.2.5. Public distribution, all regions, free pricing, and automatic publication after approval were retained. The separate beta package has not been uploaded, and no beta item creation, review, published link, or normal installation is confirmed. Its historical prepared package is `.local/release/chrome-beta/0.3.2/threadlane-chrome-beta-0.3.2.zip`, SHA-256 `8f1f6d385eb42b9475873eb22a18cbf6d8e2eb949a5bf7654619d4b4d96de431`; listing text and correctly sized assets are prepared in `.local/beta/0.3.2/`. Prepare and qualify a current beta package, complete that separate upload, and record the actual item ID and Unlisted review status before sharing an installation link; preserve the pending public item.

## Background queue development update

Version 0.3.4 adds background-tab dispatch in shared source. Its isolated packages are local candidates; it is excluded from the public 0.3.5 manifest-only submission. Its existing Firefox live/signing gates remain and it needs a version greater than 0.3.5 before a new Firefox submission. The store/feed versions above change only when the respective release workflow completes. See [BACKGROUND_QUEUE_VERIFICATION.md](BACKGROUND_QUEUE_VERIFICATION.md) for testing and installed-development status.

Version 0.3.6 adds the retained-animation completion patch and queue hold diagnostics. Chrome's qualified package was submitted to the existing public item on 2026-10-05 and is Pending review. Firefox 0.3.6 remains an unsigned candidate awaiting live qualification; public AMO 0.3.5 and the signed 0.3.2 beta feed were not changed. See [AUTOSEND_PATCH_0.3.6.md](AUTOSEND_PATCH_0.3.6.md) and [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md).

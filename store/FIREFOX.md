# Firefox port

Threadlane's Firefox desktop build uses the same annotation, queue, encryption, and provider code as Chrome. It requires Firefox 140 or later. The selected beta route is a Mozilla-signed, self-distributed package with an HTTPS update feed, not a public AMO listing. Signing and the update channel are not operational until verified; see [submission status](FIREFOX_SUBMISSION_STATUS.md) and [distribution rationale](BETA_DISTRIBUTION.md).

## Build and inspect

```sh
bun install --frozen-lockfile
bun run build:firefox
bun run lint:firefox
bun run version:check
bunx tsc --noEmit
bun test
bun run package:firefox
```

`build:firefox` writes `dist-firefox/`. `package:firefox` creates an immutable candidate under `.local/release/firefox/<version>/`, containing `extension/`, `threadlane-firefox-<version>.zip`, and its SHA-256 file. Chrome continues to use `bun run build`, `dist/`, and `bun run package:release`. Both targets derive their version from `package.json` and `CHANGELOG.md`.

The Firefox manifest uses an event page (`background.scripts`) instead of Chrome's service worker. Manifest V3 makes it nonpersistent automatically; the unsupported legacy `persistent` property is omitted. The stable add-on identifier is `threadlane@extensions.invalid`; it is an identifier, not a contact address or website. Keep it unchanged in future Firefox releases so updates use the same installation and storage. The runtime prefers Firefox's `browser` Promise APIs and adapts Chrome's callback/error behavior at the browser boundary.

The only supported page matches are HTTPS ChatGPT, Claude, and Gemini. Production builds do not include localhost access or a development reload server. Firefox private browsing is disabled because these features deliberately keep persistent conversation data.

`web-ext` 10.7.0 reports three `UNSAFE_VAR_ASSIGNMENT` warnings for existing `innerHTML` templates. User-controlled note, queue, error, and URL text passes through the local HTML-escaping helper; draft text is set through the textarea's `value`; icons are bundled Lucide SVG. Keep reviewing these boundaries when modifying templates. The validator also reports the Android 142 data-consent minimum despite this desktop-only manifest omitting `gecko_android` ([Mozilla issue 3561](https://github.com/mozilla/web-ext/issues/3561)). Do not add Android support merely to hide that warning. Lint warnings are retained in the validation output.

## Signed beta distribution

The next candidate is 0.3.2. Its intended `browser_specific_settings.gecko.update_url` is `https://raw.githubusercontent.com/ahmed-ela/threadlane-updates/main/firefox/updates.json`, and its Gecko ID remains `threadlane@extensions.invalid`. Submit the package through Mozilla's **On your own** channel, provide reproducible source, and distribute only Mozilla's returned signed XPI. Signed files will be hosted as versioned GitHub Release assets. Publishing the feed must follow signing, asset verification, and release qualification; a Git push of application source alone cannot update installed copies.

Firefox reads a higher version from the installed add-on's update URL and verifies its signed package. The feed must name the exact add-on ID and version, HTTPS XPI URL, and SHA-256 of the **signed** download. Keep the feed address stable and available; an installed version cannot discover a replacement address if the old feed disappears. Current temporary 0.3.1 users must install a signed beta once; loading an unsigned ZIP through `about:debugging` does not become persistent or automatically updating by itself. [Mozilla's self-distribution guide](https://extensionworkshop.com/documentation/publish/self-distribution/) and [update manifest reference](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

## Try the unsigned candidate locally

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on** and select `dist-firefox/manifest.json` or the packaged Firefox ZIP.
3. Open a supported conversation and allow site access if Firefox requests it. Save drafts and wait for active responses before refreshing any existing chat tab.
4. After rebuilding, use the extension's **Reload** button in `about:debugging`, then refresh idle test tabs.

Temporary add-ons disappear when Firefox exits. Normal installations require Mozilla signing. Temporary loading also differs from a signed installation's permissions and restart behavior; it is not proof of the store installation experience. Do not disable add-on signature checking.

Queues and annotations stay in the current Firefox profile and installation. They do not sync with Chrome, other profiles, or other devices. An extension ID or profile change creates separate storage. Uninstalling a normal installation or clearing its storage removes saved records; no built-in export/import is available.

## Data declarations

Firefox 140 introduced built-in data consent. New add-ons must declare their transmitted data. This manifest requires `personalCommunications` and `websiteContent`: queued messages and selected annotation text can be submitted through the native composer to the chosen AI provider. There is no publisher telemetry, analytics, or cloud database. Declaring `none` would misdescribe those submissions. The bundled privacy policy explains this distinction.

## Before Mozilla submission

- Complete the remaining live cases listed below, including successful Send now interruption, failed/uncertain delivery, and the controls not separately exercised on every provider.
- Qualify the final candidate through event-page suspension and a signed installation across browser restart. Historical 0.3.0/0.3.1 temporary-installation checks do not prove the new package or update path.
- Review site-access and data-consent prompts using a signed installation. Temporary loading skips parts of the normal installation experience.
- Keep the source, packaged, and public privacy policies aligned, including the GitHub-hosted feed/download connection disclosure. Self-distribution does not need a public AMO listing or listing screenshots, but reviewer/source information is still required.
- Supply the TypeScript source, lockfile, local assets, and build instructions to Mozilla so reviewers can reproduce the bundled JavaScript.
- Complete account two-step authentication and any required developer agreement, then select **On your own** for Mozilla signing/review. Treat the local unsigned ZIP as a submission artifact only.
- Verify the signed XPI and public feed/download hashes, normal first installation and browser restart, and a real later-version update before calling the automatic update path tested. See [BETA_DISTRIBUTION.md](BETA_DISTRIBUTION.md).

## Candidate 0.3.1

Candidate 0.3.1 incorporates the native replay guard and closed-storage connection recovery shipped in Chrome 0.2.5, while preserving Firefox's Promise-based browser API adapter and the retained-draft retry fixes. It supersedes the older 0.3.0 candidate even though that candidate already had a higher version than the Chrome release.

Candidate 0.3.1 passed 444 automated tests (1,959 assertions), TypeScript, version consistency, production build, and package validation. The loadable production build is byte-identical to the packaged extension. Mozilla web-ext reported zero errors and the same four warnings documented above. These automated checks are separate from the live results below.

## Live candidate 0.3.1 verification — October 4, 2026

Core live checks passed on signed-in ChatGPT, Claude, and Gemini in Firefox using the exact temporarily installed 0.3.1 candidate. The tested archive's SHA-256 is `34b89c45a5e679071d24036eb2e73bb5da1f26c37f1821d76492e16869105d1f`. No source patch was needed during this live pass. Detailed results, limitations, and native accessibility evidence are recorded in the [live verification report](/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/firefox-0.3.1-live/report.md).

- All three providers queued follow-ups during generation, delivered them sequentially once each, and left an empty queue. Paused queues stayed paused through response completion and survived closing and reopening the conversation tab. Gemini's multiline messages drained without a Send unconfirmed error.
- ChatGPT's queue editing preserved the reserved position; focused-grip keyboard reordering, deletion, and protection of an unrelated composer draft passed. Claude's native pointer drag reordered queued messages. ChatGPT and Gemini mirrored queues across tabs and drained without duplicate sends.
- All three providers passed native pointer selection, opening the annotation editor, saving a note, inserting the exact quote/comment into the native composer, sending, and receiving the completed reply. The saved notes remained after sending. Claude recovered the exact note after tab close/reopen, Gemini after reload, and ChatGPT synchronized the exact note into a second already-open tab.
- A final unpaused ChatGPT repeat with Extra High completed all 120 requested lines and the `COMPLETE_120` marker, then sent `FINAL_A` and `FINAL_B` once each and cleared the queue.

The initial ChatGPT request for 80 lines ended at line 48 before its queued follow-up sent. The cause and timing were not established, so this remains an unresolved observation rather than a confirmed premature-send bug. Later controlled pause/drain checks and the final unpaused 120-line repeat passed.

This remains an unsigned temporary installation. Full Firefox exit/restart persistence, permanent signed installation, and normal installation permission/consent prompts are unverified. All live reopening checks closed individual tabs without quitting Firefox. Successful Send now interruption and provider failure/uncertain-send recovery were not tested live; only Send now's unrelated-draft protection was verified. Dispatch latency and immediate queue-row removal were not quantitatively timed. Claude cross-tab behavior, Claude's first multiline message taking the queued path, ChatGPT note reload recovery, and the controls not listed for each provider were not separately tested. Initial white screenshots, accessibility activation quirks, and capture interruptions were tooling observations, not established extension bugs.

## Historical candidate 0.3.0 verification — October 4, 2026

Firefox 157.0 was installed from Mozilla's signed, notarized macOS distribution. The 0.3.0 candidate loaded as a temporary add-on. The automated suite passed 421 tests (1,854 assertions), TypeScript and version checks passed, and the exact release ZIP had zero validator errors with the four warnings described above.

An isolated localhost add-on with a separate test identity used byte-identical release content and worker scripts. Two real Firefox tabs verified concurrent queue operations, single-owner dispatch, pause, reorder, editing, deletion, uncertain delivery and retry, and encrypted annotation storage. Saved data and nonextractable encryption keys survived both natural background shutdown and an explicit test add-on reload. The runtime evidence contains 91 passing assertion records, including repeated checks across recovery phases.

The Firefox UI fixture verified Enter-to-queue, editing in place, drag reordering, trash deletion, pause/resume, preservation of a different composer draft, and persistence after closing and reopening the tab. Three queued messages then sent once each in the intended order and disappeared from the queue. Provider responses were simulated; the observed 21 ms final dispatch delay does not establish live-provider latency.

At that earlier stage, the local Firefox DNS conflict was repaired for the current macOS account, with DNS-over-HTTPS verified off and locked after a cold restart. ChatGPT, Claude, and Gemini loaded, but signed-in extension verification was still pending. This account-level correction did not update the canonical system-policy generator. The annotation selection trigger appeared in the fixture, but native annotation-editor activation was not verified because computer-use window capture and focus stopped working reliably. Those historical results did not establish complete live-site compatibility; the 0.3.1 live pass above supplies the newer provider evidence. Full browser restart persistence of a signed add-on and normal signed-installation behavior remain unverified.

## Mozilla references

- [Temporary installation and its limitations](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
- [Manifest V3 migration](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- [Built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [web-ext validation and signing](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)

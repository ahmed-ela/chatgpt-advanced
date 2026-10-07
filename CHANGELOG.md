# Changelog

Changes are recorded here before each version bump. Version 0.x is the development series; entries do not imply Chrome Web Store publication.

## [Unreleased]

## [0.3.11] - 2026-10-07

### Changed

- Use the supplied black flame artwork for extension icons and matching Chrome Store branding. Queue behavior and permissions are unchanged.

## [0.3.10] - 2026-10-07

### Fixed

- Keep the queue header background unchanged on hover, while preserving row numbers, reorder handles, and action-button feedback.

## [0.3.9] - 2026-10-07

### Fixed

- Exclude collapsed-message display decorations from plain-text ChatGPT prompts as well as rich-text prompts, so a long message can be confirmed without expanding or refreshing its bubble.

## [0.3.8] - 2026-10-07

### Fixed

- Confirm queued ChatGPT messages rendered as rich text by preserving paragraph blank lines and excluding display-only decorations. Confirmed messages leave the queue without retrying the native send.

## [0.3.7] - 2026-10-06

### Fixed

- Preserve verified ChatGPT conversation identity through cached-chat navigation, and ignore hidden cached answers when observing the first send in a new chat.
- Capture form-submit first sends and distinguish an unverified conversation identity from an unfinished response in queue recovery guidance.

## [0.3.6] - 2026-10-05

### Fixed

- Keep stale animation in a positively completed ChatGPT turn from blocking queued follow-ups, while retaining active response and conversation identity checks.
- Explain draft, attachment, and unconfirmed completion holds in the queue, and expose content-free dispatch diagnostics for intermittent stalls.
- Prevent development reloads from rebuilding the wrong checkout; support a qualified source checkout writing to an existing installed extension directory.

Includes the 0.3.4 background dispatch changes for Chrome and the Firefox candidate. Live verification and release status are recorded separately; this entry does not imply store submission or publication.

## [0.3.5] - 2026-10-05

### Changed

- Reserve version 0.3.5 for the public Mozilla submission, which retains the tested 0.3.2 runtime and omits the self-distributed update feed. It does not include the 0.3.4 background dispatch changes.

## [0.3.4] - 2026-10-04

### Fixed

- Remove the visible-tab requirement for queued follow-ups while retaining completion, draft, pause, ownership, and uncertain-send checks. Live Chrome background sending passed on ChatGPT and Claude; Gemini can still wait for its native response animation to finish when the tab becomes visible.
- Deliver controlled-editor changes through `beforeinput` before falling back to direct DOM edits, preserving editor cancellation and avoiding duplicate insertion.
- Wake queue checks directly from completion events and yield native composer commits without background-throttled timers.
- Reject expired send authorizations after a suspended tab resumes instead of clicking Send with stale ownership.

Firefox 0.3.4 live background verification remains pending because computer use could not complete the temporary-add-on file picker. This candidate has not been submitted to Chrome or published through the Firefox update feed; see [verification status](store/BACKGROUND_QUEUE_VERIFICATION.md).

## [0.3.3] - 2026-10-04

### Changed

- Prepare a version-only candidate for qualifying Mozilla-signed Firefox updates from 0.3.2 to 0.3.3 through the public HTTPS update feed. Extension runtime behavior and permissions are unchanged. Signing is complete, but the normal version-upgrade and state-retention test remains pending; the live feed still advertises 0.3.2.

## [0.3.2] - 2026-10-04

### Added

- Add an explicitly named Threadlane BETA Chrome build and isolated package output for a separate unlisted store listing.
- Configure the existing Firefox add-on identity for a stable HTTPS update feed used by Mozilla-signed, self-distributed releases.
- Generate Firefox update metadata only after the local XPI matches both a trusted Mozilla download and the public GitHub release asset, with matching identity/version/feed checks and a pinned SHA-256 hash; support an empty feed while signing is pending.

### Changed

- Keep the public Chrome build target and its committed 0.2.5 submission artifacts separate from beta packages.

## [0.3.1] - 2026-10-04

### Fixed

- Bring Chrome 0.2.5's native send recovery fixes into the Firefox candidate: permit one matching asynchronous replay from a model extension without duplicating queued messages.
- Revoke replay permission after draft edits, navigation, hidden tabs, or timeouts, preserving uncertain sends for explicit review.
- Reopen unexpectedly closed IndexedDB connections only before a transaction begins, without replaying an uncertain write.
- Preserve the Firefox browser API adapter and the existing durable retry behavior for retained composer drafts.

## [0.3.0] - 2026-10-04

### Added

- Add a Firefox desktop build for Firefox 140 and later, with a nonpersistent background page, stable extension identity, and install-time disclosure of provider-bound messages and annotation excerpts.
- Produce isolated Firefox build outputs and immutable Firefox release archives while preserving the Chrome build and release defaults.
- Validate browser-specific manifests and pin Mozilla's web-ext tooling for reproducible Firefox linting.

### Fixed

- Retry a send-unconfirmed message using its original saved queue item, clearing only its unchanged matching draft after the retry is durably saved.
- Preserve queue pause state, unrelated drafts, attachments, and edits made while retrying; avoid duplicate queued copies after a failed clear or lost retry response.

## [0.2.5] - 2026-10-04

### Fixed

- Allow one matching deferred native send after another composer extension cancels the initial queued click, without blocking the replay or allowing duplicate sends. Revoke that allowance when the draft, conversation, or composer changes.
- Recover a closed extension database connection without clearing saved queues or notes, and retry only when a transaction could not begin.

## [0.2.4] - 2026-10-04

### Fixed

- Let Retry resume a saved message after an unconfirmed send by clearing only its unchanged matching composer draft after the retry is durably saved. Preserve other drafts and pause state.

## [0.2.3] - 2026-10-04

### Fixed

- Keep new Gemini queues resuming after a conversation is reopened by saving stable response-turn references instead of changing prompt indices.
- Preserve older queued text when its response reference cannot be safely recovered after reopening, with a visible explanation and explicit Send now recovery.

## [0.2.2] - 2026-10-04

### Security

- Encrypt saved annotation and queue records with locally generated AES-256-GCM keys while preserving existing database identities.
- Migrate older plaintext records only after encrypted copies are durably saved and authenticated, preserving original data on failure.

### Fixed

- Keep follow-ups queued while ChatGPT is starting a response, even when typing changes the native control from Stop to Send before the response text appears.

### Changed

- Renamed the extension and public store materials to Threadlane while preserving existing storage and message identifiers.
- Replaced the speech-bubble icon with a simpler three-lane mark and updated the store icon and promotional tile.
- Added the confirmed support/privacy contact, threadlane.support@gmail.com, and updated the promotional tile and release archive name.

## [0.2.1] - 2026-10-03

### Fixed

- New-chat and temporary conversation pages no longer show a false annotation save failure when no notes exist.
- Notes on an unsaved conversation keep their text and legacy copies with accurate unsaved guidance.

## [0.2.0] - 2026-10-03

### Added

- Durable annotation storage owned by the extension, shared across tabs in the same Chrome profile.
- Visible annotation save failures and retry controls, with guarded migration of existing website-local notes.
- Extension icons, a bundled privacy page, and an isolated production ZIP packaging command.

### Fixed

- Annotation insertion and native message sends no longer erase saved notes.
- Annotation insertion preserves existing composer drafts and attachments.
- Route transitions and delayed save acknowledgements preserve the correct conversation's notes and unfinished annotation drafts.
- Production packages exclude localhost permissions, development reload hooks, and source maps.

### Changed

- Removed the redundant queue status and storage footer.

## [0.1.0] - 2026-10-03

Initial versioned development baseline, consolidating the earlier 0.0.1 prototype.

### Added

- Highlight assistant responses and compose inline annotation replies on ChatGPT, Claude, and Gemini.
- Durable per-conversation text queues with automatic sending, cross-tab coordination, pause/resume, send now, editing, deletion, and drag reordering.
- Consistent Lucide icons, including the annotation +, with keyboard activation for annotation controls.
- Safe development reloads that wait for active responses, drafts, and queue operations.
- Semantic version commands, a shared build version, and this changelog.

### Fixed

- Gemini multiline send confirmation, including display padding, blank lines, and indentation.
- Queue confirmation recovery and stale draft warnings.

### Changed

- Queue rows disappear after confirmed sending; the next response remains tracked internally.
- Page changes wake queue dispatch and confirmation without a fixed success cooldown.

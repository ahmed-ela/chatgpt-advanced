# Changelog

Changes are recorded here before each version bump. Version 0.x is the development series; entries do not imply Chrome Web Store publication.

## [Unreleased]

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

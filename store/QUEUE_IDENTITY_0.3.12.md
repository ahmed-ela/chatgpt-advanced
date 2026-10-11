# ChatGPT conversation identity recovery — 0.3.12

## Reproduced failure

A completed ChatGPT conversation could retain a temporary `local-chatgpt:*` identity in its visible response controls. Threadlane correctly refused to send when it could not link that identity to the saved route, but Send now misleadingly described the conversation as still loading.

The failure does not require attachments. In the reproduced ordering, ChatGPT cleared its composer before assigning the saved route. Subsequent route/identity mutations happened during the first response, when Threadlane's observer skipped work. Recovery depended on a polling timer that a background tab could delay beyond the first-send witness lifetime. Separately, a content-script restart discarded valid bindings held only in memory.

The reported conversation showed an unverified temporary identity despite a completed response. The exact event that lost its witness was not recorded, so the reproduced ordering is a confirmed cause rather than a claim about that chat's precise history. Private conversation content is omitted from this report.

## Change and safety boundary

- Capture pending first-send identity changes during active responses, without performing a durable heartbeat on every streamed token.
- Store witnessed route/local-ID/first-user-ID bindings in the existing encrypted queue record.
- Restore only an exact current visible match. Mixed markers, changed routes, changed first users, conflicting bindings, and absent first-send evidence remain blocked.
- Preserve completion, loading, draft, attachment, pause, and cross-tab ownership checks.
- Describe an unverified identity accurately and offer native conversation reopening as recovery guidance.

The patch is shared by the Chrome and Firefox builds. It adds no permissions or external data transmission.

## Automated qualification

- All **602 tests passed**, with 2,752 assertions across 16 files.
- TypeScript, version consistency, and `git diff --check` passed.
- The hidden first-response regression was run with fallback polling disabled. Removing the new pending-witness observer branch caused that regression to fail; restoring the patch made it pass.
- Coverage includes encrypted storage close/reopen, concurrent binding writers, fresh visible/hidden Documents, stale asynchronous reads after navigation, mismatched identities, loading/completion guards, two queued sends exactly once, and no heartbeat amplification across streamed text mutations.

## Local Chrome verification

The installed development build was activated through the existing draft-safe reload hook as **0.3.12**, build `mv42n9gn-kpo16x`. User tabs were checked for drafts, attachments, and active responses before activation.

In a separate harmless diagnostic chat, a queued follow-up sent once and left the queue. Two additional messages and the paused preference survived a controlled page restart. Resume sent both messages once and removed both from the queue. The reopened page exposed authoritative provider conversation identity; live restart therefore qualifies queue/pause persistence, while exact temporary-alias restoration is covered by the automated tests.

Two more follow-ups were queued during a response and the test tab was left in the background. The automation-only focus override was temporarily disabled for that test tab; actual `document.visibilityState` was confirmed as `hidden` before and after dispatch. Both messages appeared exactly once, received their expected replies, and the queue became empty. The dispatch diagnostics also recorded `hidden`. The temporary automation override was restored afterward; user tabs were not modified for this test.

Local proof files are `outputs/threadlane-identity-2026-10-11/patched-background-result.json` and `patched-autosend.jpg`. These contain only the harmless diagnostic chat.

Firefox packages were built and validated, but Firefox live runtime testing and store publication are not part of this verification. Neither store submission was updated by this task.

## Release artifacts

Production Chrome ZIP SHA-256:

`96c1ceee3765fa7ff46fe03abdbf05be185eb7ae896db4c5ee89b27e1a7da998`

Production Firefox ZIP SHA-256:

`412d2e3194ccb71ca60ff575d40a88188050bd15c6e6861af8e58ef1860b323b`

The final candidates are under `outputs/threadlane-identity-2026-10-11/release-final/` in the task workspace. Earlier files under `release/` are superseded and must not be uploaded.

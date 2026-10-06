# Background queue verification — 0.3.4

Tested on 2026-10-04 in the installed Chrome development extension. This is a local development qualification, not a Chrome Web Store or Firefox feed publication.

## Change

The queue no longer requires a visible document to claim, prepare, send, or continue a deferred native send. Completion events schedule microtask checks; native editor commits yield through a short-lived MessageChannel instead of a background-throttled timer. Controlled editors receive `beforeinput` before direct DOM fallback, and cancelled edits are respected.

Drafts, attachments, pause state, route identity, completion anchors, atomic ownership, and uncertain-send review remain enforced. Before clicking Send, the sender refreshes durable state and rejects expired or no-longer-owned attempted sends.

## Automated evidence

- 522 tests passed, 2,275 assertions across 15 files; TypeScript and diff checks passed.
- New cases cover hidden sequential dispatch, visible/hidden concurrent claims, hiding during claim and native replay, held drafts/paused queues/busy responses, expired or paused attempt responses, and controlled-editor insertion, rejection, and deletion.
- Claude and Gemini fixtures test two-message hidden draining. Fixture success does not establish current website behavior.

## Live Chrome evidence

Test conversations were separate from the user's chats. Browser focus emulation was disabled for the test pages, and a temporary native-click listener recorded the actual `document.visibilityState` at each synthetic Send. This avoids an automation tool making a background page appear visible. It did not alter provider completion state.

- ChatGPT: two queued prompts sent exactly once while hidden, both received the expected replies, and the queue emptied. The test used Extra High. Conversation: `6ac2dab8-1a90-83e9-8c0f-44b6bd9a7bb0`.
- Claude: the initial live run exposed a managed-editor failure. After the `beforeinput` correction, two queued prompts sent exactly once while hidden, both received the expected replies, and the queue emptied. Conversation: `4803bd28-c946-49a4-9f29-3cd8e85d41e1`.
- Gemini: **background draining is not qualified**. The native client retained pending response-animation nodes, `aria-busy=true`, and an unfinished footer while hidden, even though response text was in the DOM and Stop had disappeared. Threadlane correctly retained both queued messages. Restoring visibility allowed native rendering and sending to resume. Do not weaken the completion check or advertise this as full Gemini background support. Conversation: `eff348f1d6a87835`.

Local evidence is under `/Users/ahmedelamin/Documents/Codex/2026-10-03/do-x20/outputs/background-queue-0.3.4/`. Automated output is `.local/background-queue-tests.log`.

## Installation and release boundaries

Chrome extension `cdfkdneimljlophheachlpgjkkfbcekd` was updated in place at `/Users/ahmedelamin/repos/projects/plannotator-chatgpt-notes/dist`, preserving its identity and storage. Its prior development files are backed up under the evidence directory. This source checkout is the source of the 0.3.4 build; the older dirty checkout's source was not overwritten. Running that older checkout's build/reload command can replace these generated files with its older source.

Final release candidates are under `.local/background-queue-final/`, rather than the earlier superseded `.local/release/*/0.3.4` candidates:

| Target | ZIP SHA-256 |
| --- | --- |
| Chrome | `686770d454b70104fe1c8235ce297294e24dfb926e83cad0409ac053361649bd` |
| Chrome beta | `62a53452d320a683e6000f07bea7d9295bc64ad61e6e41669026cc312cd3b979` |
| Firefox unsigned | `940eaf43711c5ef9f871bc0ae16bec1fb28a0ccabb32e64a127933a6d4a38a1d` |

These candidates have not been uploaded to Chrome or signed/published for Firefox. The tracked public Chrome `dist/` remains the historical 0.2.5 submission. Firefox's signed feed remains 0.3.2; its separate signed 0.3.3 update test remains pending. Firefox 0.3.4 needs its own live qualification and signing.

Open background tabs can send when their native page is ready. Frozen or discarded pages, closed tabs/browsers, and sleeping computers cannot execute DOM sends. Saved queues remain durable, and expired attempted sends require review rather than an automatic duplicate.

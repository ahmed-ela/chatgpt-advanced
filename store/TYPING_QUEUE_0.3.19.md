# Sending queued messages while typing — 0.3.19

Date: October 26, 2026 (America/Los_Angeles).

## Result

The corrected local Chrome build passed a native ChatGPT test after the user reloaded 0.3.19. Two queued prompts sent exactly once, in order, while an unfinished draft remained editable. Both rows disappeared, both queued prompts received complete replies, and the complete unfinished draft returned to the native input. It was not posted or left in recovery.

Conversation: https://chatgpt.com/c/6adefcfb-fafc-832b-97d4-e0703011dcbe

- Posted prompts: `TL0319_FINAL_A: Give one short idempotency example.` and `TL0319_FINAL_B: Give one short retry example.`
- Final input: `UNSENT_TL0319_FINAL_DRAFT: this unfinished note must remain in the input. Continued typing before delivery.`
- Visible diagnostics: two confirmed sends, empty queue, draft restoration `restored`, no saved recovery drafts.
- Extra High was visibly selected. The initial setup response displayed “This response couldn’t load”; the two queued follow-ups then produced normal complete answers. This test verifies queue handling through that initial failure and the following successful response completion.

## Root cause and correction

The original empty-input guard intentionally blocked automatic sending whenever the user was typing. Draft preservation now saves an encrypted recovery copy and keeps ongoing typing in a separate editable buffer while the native input submits the queued payload. The native editor commit-order fix from 0.3.18 prevents sending a stale internal ProseMirror document; see `TYPING_QUEUE_0.3.18.md` for that reproduced failure.

Live 0.3.18 correctly sent both queue items but left the unfinished draft in recovery. Its restoration guard reused full send readiness, which treats active assistant streaming as a busy/loading state. That incorrectly prevented restoring a draft during a newly acknowledged response. A separate regression also reproduced the posted user bubble arriving before the provider clears its input.

Restoration now checks conversation identity separately from response generation. It requires the exact observed posted user ID, verified route/alias, original connected composer, no attachments, and empty or owned native text. Send and completion guards are unchanged. A bounded, event-driven 1.5-second maximum wait handles native clearing or a brief route-loading transition; ordinary generation adds no delay. Changed routes, identities, composers, native drafts, missing turns, attachments, and persistent loading retain recovery copies. No automatic composer rebinding was added.

## Regression and browser evidence

- **824 tests pass, 0 failures, 3,770 assertions across 17 files.** This includes 25 added tests beyond the 799-test 0.3.18 candidate.
- TypeScript and `git diff --check` pass; Chrome and Firefox production builds pass.
- Firefox lint: zero errors, zero notices, four pre-existing warnings.
- New cases cover active generation, delayed clearing, continued typing/Enter during that delay, timeout recovery, temporary loading, missing acknowledged turns, stale identity, navigation, attachments, and replacement/conflicting editors.
- Actual Firefox browser test used the official ProseMirror editor with response streaming markers held active and native clearing delayed 120 ms after the user echo. `FIREFOX_0319_QUEUE_A` and `FIREFOX_0319_QUEUE_B` each sent once; model payload matched DOM at both clicks. `UNSENT_FIREFOX_0319_DRAFT while I continue typing` remained in the native model and input after the queue emptied.
- The Firefox test uses real editor, queue, and encrypted storage code with simulated provider responses/extension transport. It does **not** establish installed Firefox add-on behavior on the three live providers.

## Activation and release state

The immutable Chrome ZIP and all ten installed files match byte-for-byte. The user confirmed reloading 0.3.19, and the fresh native test exposed the new restoration diagnostic and corrected behavior. A fresh tab before that reload still ran cached 0.3.18 code; file copying alone was not sufficient activation.

Candidate: `.local/release/0.3.19/threadlane-0.3.19.zip`.

SHA-256: `cbb070c3eff62b6dc4a92fc0db8be98268e895896dfbcec9e844457060ef3c51`.

No commit, push, PR, Store upload, Firefox signing, or update-feed publication has been performed for 0.3.17–0.3.19. The existing Store submission is unchanged. The unsafe 0.3.17 package remains marked DO_NOT_PUBLISH; 0.3.18 is superseded by this candidate.

Local untracked evidence: `outputs/typing-queue-2026-10-25/native-0319-final.{json,png}`, `native-0319-final-ax.txt`, `full-suite-0.3.19.txt`, `post-ack-restoration-before.txt`, `post-ack-restoration-after.txt`, `installed-file-parity-0.3.19.json`, and `prosemirror-live/firefox-0319-final{.png,-ax.txt}`. The evidence directory keeps its original session date.

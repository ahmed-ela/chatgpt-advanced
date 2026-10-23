# Reply batch consumption — 0.3.15

Qualification record: **October 22, 2026, America/Los_Angeles**. Build, local activation, live behavior, submission, and public availability are separate gates.

## Reproduced problem

On the active Chrome 0.3.14 runtime (`mvk3rrmq-o8674x`), the blue **Insert notes** arrow copied a test reply into the native composer, but **Show notes** still counted that reply. Creating and inserting another batch included the earlier reply again. This was observed in the browser before the fix; `before.png` and `before-duplicated-batch.png` preserve the evidence. No private conversation URLs are recorded here.

The original blue-arrow regression failed against the old source: one note remained when successful transfer should leave zero. Independent review also reproduced three edge cases before their fixes: restored notes with missing offsets, restored notes with an older provider message ID, and immediate insertion of an edit before its debounced save.

## Change and guards

- After verified composer insertion, consume only the exact transferred note snapshots. The next reply batch starts without those notes; native message submission remains a separate action.
- Match consumption to original stored records, since selection restoration can repair message IDs, quotes, and offsets in the displayed notes.
- Preserve a pending edit until its save is acknowledged, then consume that revision. Acknowledging an already in-flight save does not resend it.
- Keep notes when the composer is unavailable, occupied, has attachments, changes during insertion, or rejects the write. The composer writer checks its text by reading it back before reporting success.
- Keep unresolved notes and additions or edits made after the transfer snapshot. Storage consumption compares complete records and preserves a different current revision. Tombstones prevent stale saves or imports from restoring consumed notes.
- Failed cleanup keeps the transferred composer text, pending cleanup, and visible retry guidance. Retry does not insert the prompt again.

Pending local saves retain the existing last-write-wins behavior across tabs; this release does not add general concurrent-edit conflict resolution. Exact-record consumption protects newer stored revisions at the consumption transaction. Composer readback confirms the synchronous transfer, not completion of a subsequent native send.

This package also includes the earlier queue changes: 0.3.13 recognizes the bounded completed-turn state together with its response toolbar and observes completion attributes; 0.3.14 resumes an older anchored queue only after verifying the original anchor and every intervening native response. Missing, ambiguous, busy, unfinished, or mismatched transcripts continue to hold. See [the 0.3.13 qualification](AUTOSEND_COMPLETION_0.3.13.md); its older permanent-hold behavior was subsequently addressed by 0.3.14.

## Automated and package qualification

- Full suite: **691 passed, 0 failed**, **3,120 assertions across 16 files** (`tests-final.log`).
- TypeScript, version consistency, and diff whitespace checks passed.
- Independent review reproduced and then passed the three restoration/edit regressions. Independent in-memory production rebuilding confirmed exact byte parity for `content.js`, `queue-ui.js`, and `queue-worker.js`.
- Chrome and Firefox production archives built and passed package validation. Firefox lint reported **0 errors, 0 notices, 4 warnings**: one Android minimum-version compatibility warning and three dynamic `innerHTML` warnings; details are retained in `firefox-lint.log`.
- All ten local installed production files match the Chrome candidate, recorded in `installed-package-parity.json`. The candidate was installed under the existing local extension identity, preserving its storage; activation and live behavior were then verified separately below.

| Archive | SHA-256 |
| --- | --- |
| `release/0.3.15/threadlane-0.3.15.zip` | `1aa14a7cdcfb8c48fa36ef185b197476cba520a092417f83fa0985b4a8f59dcb` |
| `release/firefox/0.3.15/threadlane-firefox-0.3.15.zip` | `0b1500d74667ce8a15e581837a48cd91bc6f14fc22fe1668a131838f0a1b6624` |

Evidence and archives are retained locally under:

`/Users/ahmedelamin/Documents/Codex/2026-10-22/thi/outputs/threadlane-reply-fix/`

## Live Chrome qualification

The user completed the extension's manual Reload. Fresh provider tabs activated the installed 0.3.15 production candidate and showed no development attributes.

- **ChatGPT:** batches ONE and TWO transferred and cleared. Refresh did not restore them. A new batch contained only THREE and left zero notes after insertion; native Send then received `BATCH_THREE_OK`.
- **Claude:** ONE transferred and left zero notes; refresh did not restore it. The next batch contained only TWO and again left zero notes. An existing composer draft blocked insertion while preserving both the draft and its note; insertion succeeded after the draft was cleared.
- **Gemini:** ONE transferred and left zero notes; refresh did not restore it. The next batch contained only TWO and again left zero notes.

The test-generated drafts were cleared. No Claude or Gemini message was sent. `chatgpt-live.json`, `claude-live.json`, and `gemini-live.json` retain provider observations. These checks qualify reply consumption; they do not claim every reusable release-checklist flow was repeated live.

## Submission and publication

The Chrome Web Store confirmed **successful submission for review on October 23, 2026 at 04:42 UTC (October 22 at 21:42 PDT)**. The package dashboard shows **Pending review**, draft **0.3.15**, revision **00008**, while published version remains **0.3.12**. Automatic publication after approval was checked (`Value: 1`) before submission. Public visibility, free pricing, and all regions were verified. The hosted privacy policy was updated and read back with exact content parity.

The submitted ZIP is the Chrome archive identified above. Evidence includes `submission-result-ax.txt`, `submission-success.png`, `pending-package-ax.txt`, and `pending-package.png`. [Submission status](SUBMISSION_STATUS.md) records the current and historical dashboard states. **0.3.15 is pending review, not yet verified publicly available.**

The Firefox archive is built and validated only. No Mozilla publication was requested; no Firefox installation, live qualification, signing, submission, or update-feed promotion is claimed here.

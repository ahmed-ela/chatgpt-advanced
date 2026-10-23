# Threadlane Chrome Web Store privacy-field draft

Use these answers only after checking them against the final uploaded ZIP and the actual dashboard fields. No form has been submitted by this document.

## Single purpose

Help users annotate and manage follow-up messages within supported AI conversations on ChatGPT, Claude, and Gemini.

## Site access justification

The content scripts run only on `https://chatgpt.com/*`, `https://claude.ai/*`, and `https://gemini.google.com/*`. They locate assistant passages for user-created highlights, restore saved notes to their conversations, read the native composer and response state, and submit user-queued text through the provider's normal send control. Conversation identifiers keep each site's notes and queue separate. No unrelated browsing history is read.

The production manifest requests no additional `permissions`, `host_permissions`, optional host access, externally connectable access, or web-accessible resources. IndexedDB is used in the extension's own origin; it does not require the Chrome storage permission. Development-only localhost access and reload hooks must be absent from the upload candidate.

## Remote code

No. JavaScript, SVG interface icons, and other executable resources are bundled locally. The extension does not download or evaluate remote code. AI provider pages and their own code are outside this extension.

## Data handling disclosure

Do not answer that the extension handles no user data merely because it is local. It processes website content and user communications to provide its advertised functions. [Chrome requires local data handling to be disclosed](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

| Data type or question | Draft answer and scope |
| --- | --- |
| Website content | Yes: selected assistant text, nearby anchoring text, short excerpts, message IDs, composer text, and rendered send/response state. |
| Personal communications / user-generated content | Yes: user notes and queued prompts. These may contain personal information supplied by the user. |
| Browsing activity / web history | Limited to supported conversation URLs/identifiers needed to associate notes and queue state with a chat. No general browser history collection. Disclose this narrow use if the form categorizes conversation URLs as web history. |
| User activity | Only local interaction and response state needed for the controls, such as queue/edit/send actions and whether the composer is occupied. No analytics or tracking profile. |
| Identity, financial, health, authentication, or location data | No deliberate extraction or dedicated collection. User-provided text can contain such information; do not claim the extension can exclude it. Review the dashboard's category definitions when choosing checkboxes. |
| Storage | Local extension-owned IndexedDB in the current Chrome profile. Note/queue records use AES-256-GCM with locally persisted non-extractable CryptoKeys. Legacy plaintext is removed only after verified encrypted persistence; website-local notes migrate when their conversation is visited. |
| Transfer | User-directed insertion/sending to the currently selected AI provider through its native composer. No transfer to the publisher or an analytics service. |
| Retention | Saved notes until deletion or successful insertion of that reply batch into the native composer; queued content until removed/completed, with up to 20 edited-message recovery receipts per conversation retained until replaced or storage is cleared. Identifier-only records prevent duplicates and deleted-note resurrection. |
| Device/profile sync | None. |
| Sale, advertising, unrelated use, creditworthiness | None. |

## Limited Use certifications

The extension's stated behavior uses data only for the annotation and queue features; does not sell data or transfer it for unrelated purposes; and does not use it for creditworthiness or lending. Confirm the final policy, implementation, and dashboard declarations agree before the publisher makes any certification. [Chrome's Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/policies) apply to local processing as well as transfers.

## Encryption scope

Keys stay in the extension databases; there is no password/server recovery. Active extension/profile or device compromise is outside the protection. Plaintext is needed in memory/UI and provider submissions. Migration removes logical plaintext records only after durable authenticated ciphertext exists; it does not promise secure wiping of database pages, backups, or unvisited website-local copies. Missing keys or authentication failures preserve records and show an error. The implementation now provides at-rest encryption; this description does not certify overall Chrome Web Store compliance or approval.

## Required URLs and contact

Publisher/support contact is **threadlane.support@gmail.com**. Public policy URL: [Threadlane privacy policy](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf), hosted and checked live. Keep [../PRIVACY.md](../PRIVACY.md) and the packaged [privacy.html](privacy.html) in agreement.

# Threadlane privacy policy

Last updated: 2026-10-04

Threadlane adds annotations and a message queue to ChatGPT, Claude, and Gemini. This policy describes the packaged extension; local development builds also use a local development server.

## Information used

The extension reads the supported conversation's page content, conversation and message identifiers, composer contents, and send/response state to attach notes and deliver queued messages. When you save a note, it stores your selected quote, comment, nearby text needed to locate the highlight, a short message excerpt, identifiers, and a timestamp. When you queue a message, it stores that message's text, order, pause state, identifiers, and delivery/edit coordination state.

It does not collect general browsing history, passwords, authentication cookies, payment details, or account profiles. Your notes or messages may themselves contain personal information you choose to include. The extension does not run on unrelated websites.

## Local storage and sharing

Notes and queues are stored in the extension's own IndexedDB databases in your current browser profile. They are shared between tabs of the same conversation in that profile, but are not synced to other browsers, profiles, or devices. There is no publisher-operated cloud storage, analytics, advertising, or telemetry. The extension does not send your notes or queue contents to the publisher.

Older versions saved notes in the supported site's local storage. When those notes are encountered, the extension imports them into its own database. It removes the old local copy only after the import succeeds. If import fails, the original remains available for a later retry.

When you choose Insert, annotation text is placed in the provider's native composer. When a queued message sends, the extension submits it through that same composer to the provider you are using: OpenAI for ChatGPT, Anthropic for Claude, or Google for Gemini. The provider's own terms and privacy policy govern that submitted content. The extension does not call a separate AI API or send the text to the publisher. Automatic sending requires a visible supported conversation and a ready, empty composer.

The Firefox installation declares personal communications and website content in its required data permissions because these features can submit your queued messages and selected quotes to the chosen AI provider. These permissions do not enable publisher analytics or telemetry. The Firefox build does not run in private browsing windows.

## Retention and deletion

Saved notes remain until you delete them; inserting a prompt or sending a message does not delete your notes. Queued text remains while pending, uncertain, or awaiting its response, and is removed from the active queue after completion or explicit deletion. To recognize retries after a lost save response, the queue may retain the text of up to 20 recently edited, retired messages per conversation until those recovery records are replaced or extension storage is cleared. Non-content identifiers and deletion records may remain to prevent duplicate sends or reimporting deleted notes.

You can edit or delete notes and pending queue items in the extension interface. Removing a local note or queue item does not delete messages already submitted to an AI provider. Clearing the extension's storage or uninstalling the extension removes its local databases. An unimported legacy copy remains in the relevant site's storage until successfully imported or that site's storage is cleared. There is currently no built-in export or cloud backup.

## Limited use and security

The extension uses conversation data only to provide its annotation and queue features, consistent with the Chrome Web Store User Data Policy, including its Limited Use requirements. It does not sell user data, use it for advertising or credit decisions, or provide it for unrelated purposes. No remote executable code is loaded.

Stored note and queue records are encrypted with AES-256-GCM using a fresh random initialization value for each write. Keys are generated locally and persisted as non-extractable CryptoKeys in the extension's databases. The browser and the extension can use those keys during normal operation. The protection depends on the security of the browser, the active profile, the device, and the extension code; it does not protect against compromise of those components. Plaintext is used in memory and the interface, and for messages you submit to an AI provider. There is no password or server-based key recovery. If a key is missing or stored data cannot be authenticated, the extension preserves the records and reports an error rather than silently resetting them.

Plaintext records from older extension databases are migrated when a database is opened. Each original record is removed only after its encrypted replacement has been durably saved and verified. Older website-local notes are imported when the relevant conversation is visited, as described above. Removing a record does not guarantee secure erasure from browser/database free space, filesystem backups, or copies outside the extension.

## Contact and changes

For privacy or support questions, email [threadlane.support@gmail.com](mailto:threadlane.support@gmail.com). If you contact support, your email address and the information you choose to include are received through Gmail and used to respond to your request. Avoid sending private conversation text unless it is needed for your question. This policy will be updated when data practices change.

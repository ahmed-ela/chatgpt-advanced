# Store listing draft

Status: Threadlane **0.3.6 is published and publicly available**, verified on October 7, 2026. Update **0.3.10 is pending review** with automatic publication after approval. Its listing was resubmitted on October 7 with matching ChatGPT, Claude, and Gemini screenshots; see [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md). The description below matches the submitted listing. The newer update and screenshots are not yet confirmed public.

## Name

Threadlane

## Summary

Highlight AI responses on ChatGPT, Claude, and Gemini, add inline notes, and queue follow-up messages in the native composer.

## Description

Keep your feedback next to the passage it refers to, and prepare follow-up messages while an AI response is still arriving.

Threadlane works inside ChatGPT, Claude, and Gemini:

- Select part of an assistant response, add a note, and return to the highlight later.
- Insert a revision prompt built from your notes into the native composer. Your saved notes remain available until you delete them.
- Queue text follow-ups while a response is running. The next message sends after the previous response finishes and the composer is ready.
- Drag to reorder, edit a message in its original queue slot, remove it, pause/resume the queue, or use Send now to interrupt the current response and send a selected message.
- Keep saved notes and queues across tabs, page reloads, and browser restarts in the same Chrome profile.

Your notes and queue are stored locally in the extension, without publisher analytics or cloud storage. Queued messages are submitted to the AI provider through its normal composer. They are not synced between devices or Chrome profiles. A tab for the conversation must remain open and able to run for automatic sending; existing drafts and attachments block automatic delivery in that tab. ChatGPT and Claude can continue sending in a background tab. Gemini may wait until you return to the tab so its response animation can finish. Closed, frozen, or discarded tabs and a sleeping computer cannot send. The queue supports text messages, not attachments.

This is an early beta. If the extension cannot confirm a send, it holds the queue for your review. Check the conversation before retrying. Changes to the providers' websites may affect compatibility. You need access to the relevant provider and its normal chat interface; the extension does not include an AI subscription.

Threadlane is an independent extension and is not affiliated with or endorsed by OpenAI, Anthropic, or Google.

## Publisher fields to verify before updating

- Category: choose the dashboard's appropriate productivity category.
- Language: English.
- Visibility: **Public**, as authorized by the user. Complete the gates in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
- Publisher/support contact: **threadlane.support@gmail.com**.
- Privacy policy URL: [https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf](https://gist.github.com/ahmed-ela/5ce1f17c643c3daaa4bc983e7b0a81bf). Hosted policy was checked live; packaged `privacy.html` is the offline copy.
- Support email: [threadlane.support@gmail.com](mailto:threadlane.support@gmail.com). A separate homepage/support website is optional and has not been provided.
- Screenshot assets: use the ordered [ChatGPT, Claude, and Gemini demo images](assets/screenshots/README.md), each a 1280×800 JPEG showing a harmless herb conversation with two paused follow-ups. Their capture versions, provenance, and hashes are recorded alongside the files. Do not use private chat content or imply a feature that is absent.

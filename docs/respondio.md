# respond.io integration

Open Settings → Integrations → respond.io. The integration is disabled by default and does not create a provider subscription or a WhatsApp account.

1. In respond.io Settings → Integrations → Developer API, create an access token. API access requires Growth or higher.
2. Identify the numeric ID of the WhatsApp channel in your respond.io workspace (Developer API: List channels). Use the WhatsApp channel you intend to send through, not a contact ID.
3. Create a respond.io webhook for **New Incoming Message**, pointing at the webhook URL shown in Owly. Webhooks require Advanced or higher.
4. Enter the access token, channel ID and webhook `signingKey` in Owly. Save and enable respond.io. Empty secret fields preserve the saved values; GET responses return presence flags only.
5. Reply to the connected WhatsApp account from a test contact. The new text reply appears in Conversations. Reply from Owly and inspect the respond.io outgoing log before retrying a failed/uncertain send.

The adapter uses POST `https://api.respond.io/v2/contact/{identifier}/message`, a `phone:+...` contact identifier, an explicit `channelId`, Bearer authentication and a text message body. Contacts must already exist in respond.io. Only text messages are supported in this version, with a maximum of 4096 characters. Provider WhatsApp session, consent, template and billing requirements still apply. This adapter does not send templates or bypass the messaging window.

Incoming `message.received` events must have `traffic: incoming`, text content, the configured channel ID and a valid base64 HMAC-SHA256 `X-Webhook-Signature`. Original timestamps and message IDs are retained. Event IDs use the existing provider-event unique index; message IDs are namespaced by channel and deterministically mapped to an Owly ID. Outgoing/read/delivery events do not import a message. This is a live inbox connection; it does not backfill history or apply RocketSender's campaign-only import filter.

respond.io is also selectable as the existing 15-minute fallback. It sends the prepared Owly draft only. Network errors, HTTP 408/449/5xx, malformed acknowledgement or missing message IDs are uncertain and must not cause another provider send. Disabled respond.io cannot send. Fallback processing uses the existing extension-heartbeat drain; a stopped browser or sleeping server delays it.

The integration does not claim connectivity from the presence of an API key; the UI reports enabled but requiring a live test. The free Render service may sleep. respond.io requires HTTP 200 within 5 seconds and retries for only a short period, so this hosting tier cannot guarantee continuous reception. Provider retries use the existing event log; no durable external queue or historical reconciliation is added by this adapter.

Official references:
- https://developers.respond.io/docs/api/a748f5bfb1bb5-send-a-message
- https://developers.respond.io/docs/webhooks/5edb782537996-new-incoming-message
- https://developers.respond.io/docs/webhooks/lwocem4sq812x-overview
- https://respond.io/help/integrations/developer-api
- https://respond.io/help/integrations/webhooks

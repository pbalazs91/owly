# WhatsApp providers and reply fallback

Owly accepts inbound text messages from Infobip and Peach and adds them to the
same WhatsApp customer conversation. Admin replies in that conversation use
the provider recorded on the conversation.

## Configure in Owly

Open Settings → Integrations → WhatsApp tartalék szolgáltatók. Enter each
provider's API key, sender or Peach App flow ID, and a separate long random
webhook token. The API keys and webhook tokens are not returned by the settings
API after saving. Enable the fallback only after the selected provider fields
are complete. It is disabled by default.

Infobip's inbound endpoint is
/api/integrations/whatsapp/infobip/inbound. Configure the inbound WhatsApp
webhook to send text-message events there and include the saved secret in the
X-Owly-Webhook-Token header.

Peach's inbound endpoint is
/api/integrations/whatsapp/peach/inbound. Subscribe it to the
message_delivery.replied webhook and configure the same header. Peach sends
replies through a Peach App flow. The configured flow must use the message
liquid value supplied by Owly.

## Fifteen-minute fallback

When the Chrome extension receives an allowed customer message, Owly stores a
durable fallback timer. After 15 minutes, the selected provider sends the exact
local Ollama draft only if Owly has not confirmed sending it. The extension
stores the draft with Owly before offering it for send, checks with Owly just
before sending, and reports an uncertain WhatsApp send before the fallback can
run. Uncertain outcomes are held for manual checking rather than sent again.

The extension polls Owly every 30 seconds while Chrome is running. This lets an
active extension wake a sleeping free Render instance and process due records.
If the extension is closed or offline, the stored timer remains, and the next
request processes it; exact 15-minute delivery then cannot be guaranteed.

## Production activation

Apply the new Prisma migration before deploying the application. Configure the
provider keys and webhook tokens in Owly after deployment. The fallback and
provider webhooks remain inactive until configured. Test each provider using a
consenting test number before enabling the fallback for live conversations.

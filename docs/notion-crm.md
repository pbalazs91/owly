# Notion CRM

Owly can manually synchronize customer and conversation records to one Notion database. The sync is one-way: Owly is the source of truth, and Notion changes are not imported. Conversation pages include up to the most recent 20 messages, limited to 2,000 characters total. Run it from Settings → Integrations → Notion CRM. Each run processes up to 100 customers and 100 conversations; if more remain, click the sync button again to continue. Repeated syncs update the existing Notion row using the `Owly ID` column.

## Setup

1. Create a Notion internal integration, enable read, insert, and update content capabilities, and copy its secret token.
2. Create a CRM table in Notion. Keep its title column and add an `Owly ID` text property. Optional properties are `Phone` (phone number), `WhatsApp` (phone number), `Email` (email), `Tags` (text), `Channel` (text), `Status` (text), `Summary` (text), `Messages` (text), `Type` (text), and `Last contact` (date).
3. Share the source database with the integration using the database's **Add connections** menu. A linked view alone is not sufficient.
4. In Owly Settings → Integrations, enter the token and database ID, save with sync disabled, and run **Kapcsolat ellenőrzése**. Enable sync and save when the check passes.
5. Use **Ügyfelek szinkronizálása Notionba** to export customers and conversations.

The API token stays server-side and is never returned by the settings endpoint. The database ID and sync status are visible in Owly. No data is written to Notion during the connection check; only the sync button creates or updates CRM rows.

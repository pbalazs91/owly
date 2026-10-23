const NOTION_VERSION = "2026-03-11";
const NOTION_API = "https://api.notion.com/v1";
let lastNotionRequestAt = 0;

type NotionRecord = Record<string, unknown>;
type DatabaseInfo = { dataSourceId: string; properties: Record<string, { type?: string }> };

async function notionRequest(token: string, path: string, init?: RequestInit): Promise<NotionRecord> {
  const delay = 350 - (Date.now() - lastNotionRequestAt);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  lastNotionRequestAt = Date.now();
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as NotionRecord;
  if (!response.ok) {
    const code = typeof body.code === "string" ? body.code : "notion_error";
    if (response.status === 401) throw new Error("A Notion API-kulcs érvénytelen vagy visszavonták.");
    if (response.status === 403 || response.status === 404) throw new Error("A Notion-adatbázis nem érhető el. Add hozzá a Notion-integrációt az adatbázis kapcsolataihoz.");
    if (response.status === 429) throw new Error("A Notion átmenetileg korlátozta a kéréseket. Próbáld újra később.");
    const message = typeof body.message === "string" ? body.message : code;
    throw new Error(`Notion hiba (${response.status}): ${message.slice(0, 240)}`);
  }
  return body;
}

export async function inspectNotionDatabase(token: string, databaseId: string): Promise<DatabaseInfo> {
  const database = await notionRequest(token, `/databases/${encodeURIComponent(databaseId)}`);
  const sources = Array.isArray(database.data_sources) ? database.data_sources as NotionRecord[] : [];
  const source = sources.find(item => typeof item.id === "string");
  if (!source || typeof source.id !== "string") throw new Error("A Notion-adatbázisban nem található adatforrás.");
  const dataSource = await notionRequest(token, `/data_sources/${encodeURIComponent(source.id)}`);
  const properties = (dataSource.properties && typeof dataSource.properties === "object" ? dataSource.properties : {}) as DatabaseInfo["properties"];
  const hasTitle = Object.values(properties).some(property => property?.type === "title");
  const owlyId = Object.entries(properties).find(([name, property]) => name.trim().toLowerCase() === "owly id" && property?.type === "rich_text");
  if (!hasTitle) throw new Error("Az ügyfél-adatbázisban legyen egy Cím típusú oszlop.");
  if (!owlyId) throw new Error("A duplikációvédelemhez hozz létre egy „Owly ID” nevű Szöveg oszlopot a Notion-adatbázisban.");
  return { dataSourceId: source.id, properties };
}

function richText(value: string) {
  const chunks = value.slice(0, 2000);
  return { rich_text: chunks ? [{ type: "text", text: { content: chunks } }] : [] };
}

function pageProperties(record: NotionRecord, schema: DatabaseInfo["properties"], kind: "customer" | "conversation"): NotionRecord {
  const properties: NotionRecord = {};
  const titleName = Object.entries(schema).find(([, property]) => property?.type === "title")?.[0];
  if (!titleName) throw new Error("A Notion-adatbázisban hiányzik a Cím típusú oszlop.");
  const idName = Object.keys(schema).find(name => name.trim().toLowerCase() === "owly id");
  if (!idName) throw new Error("Hiányzik az Owly ID oszlop.");
  const label = kind === "customer" ? record.name : record.customerName;
  const name = typeof label === "string" && label.trim() ? label.trim() : kind === "customer" ? "Owly ügyfél" : "Owly beszélgetés";
  properties[titleName] = { title: [{ type: "text", text: { content: name.slice(0, 2000) } }] };
  properties[idName] = richText(String(record.id || ""));

  const optional: Array<[string, string, string]> = kind === "customer"
    ? [["Phone", "phone", "phone_number"], ["WhatsApp", "whatsapp", "phone_number"], ["Email", "email", "email"], ["Tags", "tags", "rich_text"]]
    : [["Phone", "customerContact", "phone_number"], ["Channel", "channel", "rich_text"], ["Status", "status", "rich_text"], ["Summary", "summary", "rich_text"]];
  for (const [column, field, type] of optional) {
    const key = Object.keys(schema).find(value => value.trim().toLowerCase() === column.toLowerCase());
    if (!key || schema[key]?.type !== type) continue;
    const value = typeof record[field] === "string" ? record[field] as string : "";
    properties[key] = type === "rich_text" ? richText(value) : { [type]: value || null };
  }
  const kindKey = Object.keys(schema).find(value => value.trim().toLowerCase() === "type");
  if (kindKey && schema[kindKey]?.type === "rich_text") properties[kindKey] = richText(kind === "customer" ? "Ügyfél" : "Beszélgetés");
  if (kind === "conversation") {
    const messages = Array.isArray(record.messages) ? record.messages as NotionRecord[] : [];
    const transcript = [...messages].reverse().map(message => `${typeof message.role === "string" ? message.role : "üzenet"}: ${typeof message.content === "string" ? message.content : ""}`).join("\n").slice(-2000);
    const messageKey = Object.keys(schema).find(value => value.trim().toLowerCase() === "messages");
    if (messageKey && schema[messageKey]?.type === "rich_text") properties[messageKey] = richText(transcript);
  }
  const lastContactKey = Object.keys(schema).find(value => value.trim().toLowerCase() === "last contact");
  const lastContact = kind === "customer" ? record.lastContact : record.updatedAt;
  if (lastContactKey && schema[lastContactKey]?.type === "date" && lastContact instanceof Date) {
    properties[lastContactKey] = { date: { start: lastContact.toISOString() } };
  }
  return properties;
}

async function upsertPage(token: string, database: DatabaseInfo, record: NotionRecord, kind: "customer" | "conversation") {
  const idName = Object.keys(database.properties).find(name => name.trim().toLowerCase() === "owly id");
  if (!idName) throw new Error("Hiányzik az Owly ID oszlop.");
  const found = await notionRequest(token, `/data_sources/${encodeURIComponent(database.dataSourceId)}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 1, filter: { property: idName, rich_text: { equals: String(record.id) } } }),
  });
  const existing = Array.isArray(found.results) ? found.results[0] as NotionRecord | undefined : undefined;
  const properties = pageProperties(record, database.properties, kind);
  if (existing && typeof existing.id === "string") {
    await notionRequest(token, `/pages/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify({ properties }) });
    return "updated" as const;
  }
  await notionRequest(token, "/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: database.dataSourceId }, properties }),
  });
  return "created" as const;
}

async function syncRecords(token: string, databaseId: string, records: NotionRecord[], kind: "customer" | "conversation") {
  const database = await inspectNotionDatabase(token, databaseId);
  let created = 0, updated = 0, failed = 0;
  const errors: string[] = [];
  for (const record of records) {
    try {
      const result = await upsertPage(token, database, record, kind);
      if (result === "created") created += 1;
      else updated += 1;
    } catch (error) {
      failed += 1;
      if (errors.length < 3) errors.push(error instanceof Error ? error.message : "A Notion-szinkron sikertelen.");
    }
  }
  return { created, updated, failed, errors };
}

export function syncNotionCustomers(token: string, databaseId: string, customers: NotionRecord[]) {
  return syncRecords(token, databaseId, customers, "customer");
}

export function syncNotionConversations(token: string, databaseId: string, conversations: NotionRecord[]) {
  return syncRecords(token, databaseId, conversations, "conversation");
}

// Deliberately accepts an explicit sent ledger, never a campaign recipient list.
// RocketSender's native Excel export needs mapping to this documented template.
export function parseRegistryFile(text: string, accountId: string, campaignId: string) {
  if (text.trimStart().startsWith("[")) return JSON.parse(text);
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const ch = input[index];
    if (ch === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(field); field = ""; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && input[index + 1] === '\n') index++;
      row.push(field); if (row.some(value => value.trim())) rows.push(row);
      row = []; field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("Lezáratlan idézőjel a CSV-ben.");
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  const headers = rows.shift()?.map(value => value.trim());
  if (!headers || !["phone", "status", "sentAt"].every(header => headers.includes(header))) throw new Error("A CSV-hez phone, status és sentAt oszlop kell. Használd a küldési sablont.");
  return rows.map(values => ({ accountId, campaignId, ...Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])) }));
}

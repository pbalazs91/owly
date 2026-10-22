// whatsapp-web.js 1.34.7 waits forever for every initial subresource to load.
// Begin injection once the document is parsed, with a bounded navigation wait.
const fs = require('node:fs');
const file = 'node_modules/whatsapp-web.js/src/Client.js';
const source = fs.readFileSync(file, 'utf8');
const before = /await page\.goto\(WhatsWebURL,\s*\{\s*waitUntil: 'load',\s*timeout: 0,/g;
if ((source.match(before) || []).length !== 1) {
  throw new Error('Unexpected WhatsApp client source; review the navigation patch');
}
fs.writeFileSync(file, source.replace(before, "await page.goto(WhatsWebURL, {\n            waitUntil: 'domcontentloaded',\n            timeout: 60000,"));
console.log('Applied bounded WhatsApp initial navigation');

// whatsapp-web.js 1.34.7 waits forever for every initial subresource to load.
// Begin injection once the document is parsed, with a bounded navigation wait.
const fs = require('node:fs');
const file = 'node_modules/whatsapp-web.js/src/Client.js';
const source = fs.readFileSync(file, 'utf8');
const before = /await page\.goto\(WhatsWebURL,\s*\{\s*waitUntil: 'load',\s*timeout: 0,/g;
if ((source.match(before) || []).length !== 1) {
  throw new Error('Unexpected WhatsApp client source; review the navigation patch');
}
const setAgent = 'await page.setUserAgent(this.options.userAgent);';
if (source.split(setAgent).length !== 2) {
  throw new Error('Unexpected WhatsApp user agent setup; review the compatibility patch');
}
const patched = source
  .replace(before, "await page.goto(WhatsWebURL, {\n            waitUntil: 'domcontentloaded',\n            timeout: 60000,")
  // The upstream default advertises Chrome 101. Use the installed browser's
  // actual version so WhatsApp does not see an obsolete browser.
  .replace(setAgent, `const browserVersion = (await browser.version()).split('/').pop();
            const currentUserAgent = this.options.userAgent.replace(/(?:Headless)?Chrome\\/[\\d.]+/, 'Chrome/' + browserVersion);
            await page.setUserAgent(currentUserAgent);`);
fs.writeFileSync(file, patched);
console.log('Applied bounded WhatsApp navigation and current Chromium user agent');

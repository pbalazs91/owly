const OWLY = 'https://owlyapp.onrender.com';
const OLLAMA = 'http://127.0.0.1:11434';
const DEFAULTS = { token: '', enabled: false, autoReply: false, model: 'llama3.2:3b', allowed: {}, primaryTab: null, waStatus: 'disconnected', lastStatusAt: 0, error: '', drafts: [], seen: [], pending: [] };
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const state = async () => ({ ...DEFAULTS, ...await chrome.storage.local.get(Object.keys(DEFAULTS)) });
const save = (value) => chrome.storage.local.set(value);
async function api(action, data = {}) {
  const settings = await state();
  if (!settings.token) throw new Error('Másold be az Owly párosítókódját.');
  const response = await fetch(OWLY + '/api/channels/whatsapp/browser', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': settings.token },
    body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Az Owly nem érhető el.');
  return result;
}
async function heartbeat() {
  const settings = await state();
  if (settings.token) await api('heartbeat', { status: settings.enabled && Date.now() - settings.lastStatusAt < 65000 ? settings.waStatus : 'disconnected' });
}
async function tabMessage(type, data = {}) {
  const settings = await state();
  if (!Number.isInteger(settings.primaryTab)) throw new Error('Nyisd meg a WhatsAppot a bővítmény gombjával.');
  const tab = await chrome.tabs.get(settings.primaryTab);
  if (!tab.url?.startsWith('https://web.whatsapp.com/')) throw new Error('A kapcsolt WhatsApp-lap bezárult. Nyisd meg újra.');
  const result = await chrome.tabs.sendMessage(tab.id, { type, ...data });
  if (result?.error) throw new Error(result.error);
  if (!result) throw new Error('Frissítsd a WhatsApp-lapot a bővítmény telepítése után.');
  return result;
}
async function sendDraft(id) {
  const settings = await state();
  const draft = settings.drafts.find((item) => item.id === id);
  if (!draft || !settings.enabled || !settings.allowed[draft.chatId]) throw new Error('Ez a beszélgetés nincs engedélyezve.');
  // Mark before sending: an uncertain network result must never automatically
  // resend the same reply. The user can check WhatsApp if a send times out.
  await save({ drafts: settings.drafts.filter((item) => item.id !== id) });
  await tabMessage('WA_SEND', { chatId: draft.chatId, content: draft.content });
  await api('sent', { messageId: draft.id, content: draft.content });
}
async function incoming(message) {
  const settings = await state();
  if (!settings.enabled || !settings.token || !message || !settings.allowed[message.chatId] || settings.seen.includes(message.id)) return;
  if (typeof message.id !== 'string' || message.id.length > 250 || typeof message.content !== 'string' || message.content.length > 6000) return;
  await save({ pending: [...settings.pending.filter((item) => item.id !== message.id), message].slice(-20) });
  const result = await api('incoming', message);
  async function processed() {
    const current = await state();
    await save({ seen: [...current.seen, message.id].slice(-1000), pending: current.pending.filter((item) => item.id !== message.id) });
  }
  if (result.duplicate || !result.aiEnabled) { await processed(); return; }
  if (settings.drafts.some((item) => item.id === result.messageId)) { await processed(); return; }
  const response = await fetch(OLLAMA + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: result.model || 'llama3.2:3b', messages: result.messages, stream: false, keep_alive: '5m', options: { num_ctx: 8192, num_predict: result.maxTokens, temperature: result.temperature } }),
    signal: AbortSignal.timeout(120000),
  });
  const generated = await response.json();
  if (!response.ok || !generated.message?.content?.trim()) throw new Error(generated.error || 'Az Ollama nem készített választ.');
  const draft = { id: result.messageId, chatId: message.chatId, name: message.name, content: generated.message.content.trim().slice(0, 6000) };
  const current = await state();
  await save({ drafts: [...current.drafts, draft].slice(-20), error: '' });
  await processed();
  if (current.autoReply && current.enabled && current.allowed[draft.chatId]) await sendDraft(draft.id);
}
let queue = Promise.resolve();
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Érvénytelen bővítménykérés.');
  const isPopup = sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  if (!isPopup) {
    const settings = await state();
    if (!sender.tab || sender.tab.id !== settings.primaryTab || !sender.tab.url?.startsWith('https://web.whatsapp.com/')) return { ignored: true };
    if (message.type === 'WA_STATUS') {
      if (!['loading', 'qr_ready', 'connected', 'disconnected'].includes(message.status)) return;
      await save({ waStatus: message.status, lastStatusAt: Date.now() }); await heartbeat(); return { ok: true };
    }
    if (message.type === 'WA_INCOMING') {
      queue = queue.then(() => incoming(message.message)).catch((error) => save({ error: error.message || 'Üzenetfeldolgozási hiba.' }));
      return { queued: true };
    }
    return { ignored: true };
  }
  if (message.type === 'GET_STATE') { const settings = await state(); return { ...settings, token: settings.token ? 'saved' : '' }; }
  if (message.type === 'OPEN_WA') {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    const tab = tabs.length ? await chrome.tabs.update(tabs[0].id, { active: true }) : await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
    await save({ primaryTab: tab.id, waStatus: 'loading', error: '' }); return { ok: true };
  }
  if (message.type === 'SAVE') {
    const settings = await state();
    const token = typeof message.token === 'string' && message.token.trim() ? message.token.trim() : settings.token;
    if (token.length > 2000) throw new Error('Hibás párosítókód.');
    await save({ token, enabled: !!message.enabled, autoReply: !!message.autoReply, error: '' });
    await heartbeat(); return { ok: true };
  }
  if (message.type === 'ALLOW_ACTIVE') {
    const chat = await tabMessage('WA_ACTIVE');
    if (!/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(chat.chatId)) throw new Error('Csak személyes beszélgetés engedélyezhető.');
    const settings = await state(); await save({ allowed: { ...settings.allowed, [chat.chatId]: chat.name } }); return chat;
  }
  if (message.type === 'REMOVE_CHAT') {
    const settings = await state(); delete settings.allowed[message.chatId]; await save({ allowed: settings.allowed }); return { ok: true };
  }
  if (message.type === 'SEND_DRAFT') { await sendDraft(message.id); return { ok: true }; }
  if (message.type === 'RETRY_PENDING') {
    queue = queue.then(async () => { for (const item of (await state()).pending) await incoming(item); }).catch((error) => save({ error: error.message }));
    return { queued: true };
  }
  if (message.type === 'TEST_OLLAMA') {
    const settings = await state();
    const response = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Az Ollama nem engedélyezi ezt a bővítményt.');
    const data = await response.json();
    if (!data.models?.length) throw new Error('Még nincs helyi modell telepítve.');
    return { ok: true, models: data.models.map((model) => model.name).join(', ') };
  }
  throw new Error('Ismeretlen művelet.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then((result) => respond(result || {})).catch(async (error) => {
    await save({ error: error.message || 'Kapcsolódási hiba.' }); respond({ error: error.message || 'Kapcsolódási hiba.' });
  });
  return true;
});
chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => heartbeat().catch((error) => save({ error: error.message })));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await state()).primaryTab === tabId) { await save({ primaryTab: null, waStatus: 'disconnected' }); await heartbeat().catch(() => {}); }
});

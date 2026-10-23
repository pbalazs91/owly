const OWLY = 'https://owlyapp.onrender.com';
const OLLAMA = 'http://127.0.0.1:11434';
const DEFAULTS = { token: '', enabled: false, controlRevision: '', autoReply: false, model: 'llama3.2:3b', allowed: {}, remoteAllowed: {}, rocket: { enabled: false, accountId: '' }, rocketPending: [], primaryTab: null, waStatus: 'disconnected', lastStatusAt: 0, lastHeartbeatAt: 0, error: '', drafts: [], seen: [], pending: [], uncertainMessageIds: [] };
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const state = async () => ({ ...DEFAULTS, ...await chrome.storage.local.get(Object.keys(DEFAULTS)) });
const save = (value) => chrome.storage.local.set(value);
const isAllowed = (settings, id) => !!settings.allowed[id] || !!settings.remoteAllowed[id];
let rocketRetrying = false;
let historyRunning = false;
let completedHistory = '';
async function importHistory(requestId) {
  if (historyRunning || completedHistory === requestId) return;
  historyRunning = true;
  let imported = 0, chats = 0, skipped = 0, warning = '';
  const reason = error => String(error?.message || 'Ismeretlen hiba').replace(/https?:\/\/\S+/g, '[kapcsolati cím]').slice(0, 220);
  try {
    const settings = await state();
    if (settings.waStatus !== 'connected') throw new Error('Előbb csatlakoztasd a WhatsApp Webet.');
    const allowed = Object.entries({ ...settings.allowed, ...settings.remoteAllowed }).filter(([id]) => /^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(id));
    if (!allowed.length) throw new Error('Még nincs engedélyezett beszélgetés.');
    if (allowed.length > 50) throw new Error('Egyszerre legfeljebb 50 engedélyezett beszélgetés másolható.');
    for (const [chatId, name] of allowed) {
      let result;
      try {
        result = await tabMessage('WA_HISTORY', { chatId });
        if (!Array.isArray(result.messages)) throw new Error('Töltsd újra a frissített bővítményt és a WhatsAppot.');
      } catch (error) { skipped++; warning = 'WhatsApp-előzmények olvasása: ' + reason(error); continue; }
      const targetId = /^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(result.chatId || '') ? result.chatId : chatId;
      const messages = result.messages.slice(-50);
      for (let i = 0; i < messages.length; i++) {
        const current = await state();
        if (!isAllowed(current, chatId)) break;
        // One bounded message keeps even multibyte text below the request limit.
        const batch = await api('history', { requestId, chatId: targetId, name: String(name || chatId).slice(0, 200), messages: [{ ...messages[i], content: messages[i].content.slice(0, 4000) }] });
        imported += batch.imported || 0;
      }
      chats++;
    }
    if (!chats) throw new Error(warning || 'Nem olvasható egyetlen engedélyezett beszélgetés sem.');
    await api('historyResult', { requestId, status: 'done', imported, chats, skipped, ...(warning ? { warning } : {}) });
    completedHistory = requestId;
  } catch (error) {
    const message = 'Az előzmények másolása megszakadt: ' + reason(error);
    await save({ error: message });
    await api('historyResult', { requestId, status: 'error', imported, chats, skipped, error: message.slice(0, 300) }).catch(() => {});
  } finally { historyRunning = false; }
}
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
  let settings = await state();
  if (!settings.token) return;
  // Re-discover a refreshed/reopened WhatsApp tab after extension or browser reload.
  let candidates = Number.isInteger(settings.primaryTab) ? [{ id: settings.primaryTab }] : [];
  try { candidates = [...candidates, ...(await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })).filter(tab => tab.id !== settings.primaryTab)]; } catch {}
  for (const tab of candidates) {
    try {
      const ping = await chrome.tabs.sendMessage(tab.id, { type: 'WA_PING' });
      if (ping?.contentReady && ['loading', 'qr_ready', 'connected', 'disconnected'].includes(ping.status) && Date.now() - ping.lastStatusAt < 10000) {
        const update = { primaryTab: tab.id, waStatus: ping.status, lastStatusAt: ping.lastStatusAt };
        await save(update); settings = { ...settings, ...update }; break;
      }
    } catch {}
  }
  const status = Date.now() - settings.lastStatusAt < 65000 ? settings.waStatus : 'disconnected';
  await save({ lastHeartbeatAt: Date.now() });
  const result = await api('heartbeat', { status, enabled: settings.enabled, controlRevision: settings.controlRevision, protocol: 2, version: '0.5.5', uncertainMessageIds: settings.uncertainMessageIds });
  if (result.rocket && typeof result.rocket.enabled === 'boolean') {
    await save({ rocket: { enabled: result.rocket.enabled, accountId: String(result.rocket.accountId || '') } });
  }
  if (result.alwaysAllowed && typeof result.alwaysAllowed === 'object' && !Array.isArray(result.alwaysAllowed)) {
    await save({ remoteAllowed: Object.fromEntries(Object.entries(result.alwaysAllowed).filter(([id, name]) => /^\d+@c\.us$/.test(id) && typeof name === 'string').slice(0, 50)) });
  }
  if (typeof result.desiredEnabled === 'boolean' && typeof result.controlRevision === 'string' && result.controlRevision !== settings.controlRevision) {
    await save({ enabled: result.desiredEnabled, controlRevision: result.controlRevision });
    await api('heartbeat', { status, enabled: result.desiredEnabled, controlRevision: result.controlRevision, protocol: 2, version: '0.5.5', uncertainMessageIds: settings.uncertainMessageIds });
  }
  if (typeof result.historyRequest === 'string') void importHistory(result.historyRequest);
  if (result.rocket?.enabled && !rocketRetrying) {
    rocketRetrying = true;
    queue = queue.then(async () => {
      try { await rocketApi('', { action: 'drain' }); for (const item of (await state()).rocketPending) await rocketIncoming(item); }
      finally { rocketRetrying = false; }
    }).catch(error => save({ error: error.message || 'RocketSender újrapróbálkozási hiba.' }));
  }
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
  if (!draft || !settings.enabled || !isAllowed(settings, draft.chatId)) throw new Error('Ez a beszélgetés nincs engedélyezve.');
  const gate = await api('canSend', { messageId: id });
  if (!gate.allowed) throw new Error('A 15 perces tartalék már elküldte ezt a választ.');
  // Mark before sending: an uncertain network result must never automatically
  // resend the same reply. The user can check WhatsApp if a send times out.
  await save({ drafts: settings.drafts.filter((item) => item.id !== id) });
  await save({ uncertainMessageIds: [...new Set([...settings.uncertainMessageIds, id])].slice(-20) });
  const sent = await tabMessage('WA_SEND', { chatId: draft.chatId, content: draft.content });
  await api('sent', { messageId: draft.id, content: draft.content, whatsappId: sent.whatsappId });
  const latest = await state();
  await save({ uncertainMessageIds: latest.uncertainMessageIds.filter((item) => item !== id) });
}
async function incoming(message) {
  const settings = await state();
  if (settings.rocket.enabled) { await rocketIncoming(message); return; }
  if (!settings.enabled || !settings.token || !message || !isAllowed(settings, message.chatId) || settings.seen.includes(message.id)) return;
  if (typeof message.id !== 'string' || message.id.length > 250 || typeof message.content !== 'string' || message.content.length > 6000) return;
  await save({ pending: [...settings.pending.filter((item) => item.id !== message.id), message].slice(-20) });
  const result = await api('incoming', message);
  async function processed() {
    const current = await state();
    await save({ seen: [...current.seen, message.id].slice(-1000), pending: current.pending.filter((item) => item.id !== message.id) });
  }
  if (result.duplicate || !result.aiEnabled) { await processed(); return; }
  if (settings.drafts.some((item) => item.id === result.messageId)) { await processed(); return; }
  if (typeof result.generatedDraft === 'string' && result.generatedDraft.trim()) {
    const draft = { id: result.messageId, chatId: message.chatId, name: message.name, content: result.generatedDraft.trim().slice(0, 6000) };
    const current = await state();
    await save({ drafts: [...current.drafts, draft].slice(-20), error: '' });
    await processed();
    if (current.autoReply && current.enabled && isAllowed(current, draft.chatId)) await sendDraft(draft.id);
    return;
  }
  const response = await fetch(OLLAMA + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: result.model || 'llama3.2:3b', messages: result.messages, stream: false, keep_alive: '5m', options: { num_ctx: 8192, num_predict: result.maxTokens, temperature: result.temperature } }),
    signal: AbortSignal.timeout(120000),
  });
  const generated = await response.json();
  if (!response.ok || !generated.message?.content?.trim()) throw new Error(generated.error || 'Az Ollama nem készített választ.');
  const draft = { id: result.messageId, chatId: message.chatId, name: message.name, content: generated.message.content.trim().slice(0, 6000) };
  await api('draft', { messageId: draft.id, content: draft.content });
  const current = await state();
  await save({ drafts: [...current.drafts, draft].slice(-20), error: '' });
  await processed();
  if (current.autoReply && current.enabled && isAllowed(current, draft.chatId)) await sendDraft(draft.id);
}
async function rocketApi(path, body) {
  const settings = await state();
  const response = await fetch(OWLY + '/api/integrations/rocketsender' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': settings.token },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'RocketSender importkapcsolati hiba.');
  return data;
}
async function rocketIncoming(message) {
  const settings = await state();
  // Reply import is a separate RocketSender feature. It must keep working when
  // Owly's AI-processing switch is off; importing never generates or sends a reply.
  if (!settings.token || !settings.rocket.enabled || !message || message.fromMe) return;
  if (!/^\d+@c\.us$/.test(message.chatId) || !/^\d+@c\.us$/.test(message.accountId) || typeof message.id !== 'string' || message.id.length > 250 || typeof message.content !== 'string' || message.content.length > 6000 || !Number.isFinite(message.timestamp)) return;
  const accountId = '+' + message.accountId.split('@')[0];
  if (accountId !== settings.rocket.accountId) return;
  const phone = '+' + message.chatId.split('@')[0];
  const occurredAt = new Date(message.timestamp).toISOString();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const pending = settings.rocketPending.filter(item => item.timestamp >= cutoff);
  const alreadyPending = pending.some(item => item.id === message.id);
  if (!alreadyPending) pending.push(message);
  await save({ rocketPending: pending.slice(-500) });
  // The candidate stays in Chrome's local storage while its body is withheld
  // from Owly. The eligibility request contains only account/phone/time and
  // creates no Owly profile.
  const eligible = await rocketApi('/check', { accountId, phone, occurredAt });
  // The user may upload RocketSender's successful-send report after a contact
  // has already replied. Keep unmatched candidates on this device and retry
  // after later heartbeat syncs; only send reply text once an actual prior
  // campaign send qualifies.
  if (!eligible.eligible) return;
  await rocketApi('/inbound', {
    eventType: 'reply', eventId: 'wa:' + message.id, externalMessageId: message.id,
    conversationId: message.chatId, accountId, phone, occurredAt,
    name: String(message.name || '').slice(0, 200), content: message.content,
  });
  const latest = await state();
  await save({ rocketPending: latest.rocketPending.filter(item => item.id !== message.id) });
}
let queue = Promise.resolve();
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Érvénytelen bővítménykérés.');
  const isPopup = sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  if (!isPopup) {
    const settings = await state();
    if (!sender.tab || !sender.tab.url?.startsWith('https://web.whatsapp.com/')) return { ignored: true };
    if (sender.tab.id !== settings.primaryTab) {
      if (message.type !== 'WA_STATUS' || (settings.primaryTab && Date.now() - settings.lastStatusAt < 65000)) return { ignored: true };
      await save({ primaryTab: sender.tab.id });
    }
    if (message.type === 'WA_STATUS') {
      if (!['loading', 'qr_ready', 'connected', 'disconnected'].includes(message.status)) return;
      const settings = await state();
      const changed = settings.waStatus !== message.status;
      const due = Date.now() - (settings.lastHeartbeatAt || 0) >= 5 * 60 * 1000;
      await save({ waStatus: message.status, lastStatusAt: Date.now() });
      if (changed || due) await heartbeat();
      return { ok: true };
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
    const settings = await state();
    const selected = tabs.find(tab => tab.id === settings.primaryTab) || tabs.find(tab => tab.active) || tabs[0];
    const tab = selected ? await chrome.tabs.update(selected.id, { active: true }) : await chrome.tabs.create({ url: 'https://web.whatsapp.com/', active: true });
    await save({ primaryTab: tab.id, waStatus: 'loading', error: '' });
    if (selected) await chrome.tabs.reload(tab.id);
    // Selecting a tab does not bring its containing Chrome window to the front.
    if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
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
  if (message.type === 'SELF_OPEN') {
    const chat = await tabMessage('WA_SELF');
    if (!/^\d+@(c\.us|lid)$/.test(chat.chatId)) throw new Error('A saját beszélgetés nem érhető el.');
    const settings = await state();
    await save({ allowed: { ...settings.allowed, [chat.chatId]: chat.name } });
    const tab = await chrome.tabs.get(settings.primaryTab);
    await chrome.tabs.update(tab.id, { active: true });
    if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
    return chat;
  }
  if (message.type === 'SELF_TEST') {
    const settings = await state();
    if (!settings.enabled) throw new Error('Előbb kapcsold be és mentsd el az üzenetfeldolgozást.');
    if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 1000) throw new Error('Írj egy rövid tesztüzenetet.');
    const chat = await tabMessage('WA_SELF');
    if (!/^\d+@(c\.us|lid)$/.test(chat.chatId)) throw new Error('A saját beszélgetés nem érhető el.');
    await save({ allowed: { ...settings.allowed, [chat.chatId]: chat.name } });
    return tabMessage('WA_TEST', { content: message.content.trim() });
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
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(() => heartbeat().catch((error) => save({ error: error.message })));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await state()).primaryTab === tabId) { await save({ primaryTab: null, waStatus: 'disconnected' }); await heartbeat().catch(() => {}); }
});

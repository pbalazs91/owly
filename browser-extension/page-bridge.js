(() => {
  if (window.__owlyBridgeStarted) return;
  window.__owlyBridgeStarted = true;
  const startedAt = Date.now() / 1000;
  const idOf = (id) => id?._serialized || (typeof id === 'string' ? id : id?.toString?.()) || '';
  const post = (type, payload) => window.postMessage({ channel: 'owly-wa-page-v1', type, ...payload }, location.origin);
  const ready = () => !!window.WPP?.isReady;
  const status = () => {
    let connected = false;
    try { connected = ready() && !!window.WPP.conn.isAuthenticated(); } catch {}
    post('status', { status: connected ? 'connected' : document.querySelector('[data-ref] canvas') ? 'qr_ready' : 'loading' });
  };
  let subscribed = false;
  function subscribe() {
    if (!ready() || subscribed) return;
    subscribed = true;
    window.WPP.on('chat.new_message', (msg) => {
      const chatId = idOf(msg.from);
      const id = idOf(msg.id);
      const timestamp = Number(msg.t || 0);
      if (msg.id?.fromMe || msg.fromMe || msg.type !== 'chat' || !/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId)) return;
      if (!id || !timestamp || timestamp < startedAt - 5 || typeof msg.body !== 'string' || !msg.body.trim()) return;
      post('incoming', { message: { id, chatId, content: msg.body.slice(0, 6000), name: String(msg.notifyName || 'WhatsApp ügyfél').slice(0, 200) } });
    });
  }
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'owly-wa-content-v1') return;
    const { requestId, action, chatId, content } = event.data;
    if (typeof requestId !== 'string' || requestId.length > 100) return;
    try {
      if (!ready()) throw new Error('A WhatsApp Web még töltődik.');
      if (action === 'active') {
        const chat = window.WPP.chat.getActiveChat();
        const id = idOf(chat?.id);
        if (!/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(id)) throw new Error('Nyiss meg egy személyes beszélgetést a WhatsAppban.');
        post('result', { requestId, result: { chatId: id, name: String(chat.formattedTitle || chat.name || id).slice(0, 200) } });
      } else if (action === 'send') {
        if (!/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId) || typeof content !== 'string' || !content.trim() || content.length > 6000) throw new Error('Hibás válasz.');
        await window.WPP.chat.sendTextMessage(chatId, content);
        post('result', { requestId, result: { sent: true } });
      }
    } catch (error) { post('result', { requestId, error: error.message || 'WhatsApp hiba.' }); }
  });
  setInterval(() => { subscribe(); status(); }, 2000);
  subscribe(); status();
})();

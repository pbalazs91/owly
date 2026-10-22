(() => {
  if (window.__owlyBridgeStarted) return;
  window.__owlyBridgeStarted = true;
  const startedAt = Date.now() / 1000;
  const idOf = (id) => id?._serialized || (typeof id === 'string' ? id : id?.toString?.()) || '';
  const post = (type, payload) => window.postMessage({ channel: 'owly-wa-page-v1', type, ...payload }, location.origin);
  const ready = () => !!window.WPP?.isReady;
  const normalize = (id) => idOf(id).replace(/:\d+(?=@)/, '').replace('@s.whatsapp.net', '@c.us');
  const ownIds = () => new Set([window.WPP?.conn.getMyUserWid?.(), window.WPP?.conn.getMyUserId?.(), window.WPP?.conn.getMyUserLid?.()].map(normalize).filter(Boolean));
  const ownChat = () => normalize(window.WPP?.conn.getMyUserWid?.() || window.WPP?.conn.getMyUserId?.());
  const sentByBridge = new Map();
  let pendingSends = [];
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
      const fromMe = !!(msg.id?.fromMe || msg.fromMe);
      const target = normalize(fromMe ? msg.to : msg.from);
      const selfChat = ownIds().has(target);
      const chatId = selfChat ? ownChat() : target;
      const id = idOf(msg.id);
      const timestamp = Number(msg.t || 0);
      if ((fromMe && !selfChat) || msg.type !== 'chat' || !/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId)) return;
      if (!id || !timestamp || timestamp < startedAt - 5 || typeof msg.body !== 'string' || !msg.body.trim()) return;
      pendingSends = pendingSends.filter((item) => Date.now() - item.at < 120000);
      for (const [key, at] of sentByBridge) if (Date.now() - at > 120000) sentByBridge.delete(key);
      if (selfChat && (sentByBridge.has(id) || pendingSends.some((item) => item.chatId === chatId && item.content === msg.body))) {
        sentByBridge.set(id, Date.now()); return;
      }
      post('incoming', { message: { id, chatId, content: msg.body.slice(0, 6000), name: String(msg.notifyName || 'WhatsApp ügyfél').slice(0, 200) } });
    });
  }
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'owly-wa-content-v1') return;
    const { requestId, action, chatId, content } = event.data;
    if (typeof requestId !== 'string' || requestId.length > 100) return;
    try {
      if (!ready()) throw new Error('A WhatsApp Web még töltődik.');
      if (action === 'self' || action === 'test') {
        const self = ownChat();
        if (!/^\d+@(c\.us|lid)$/.test(self)) throw new Error('A saját WhatsApp-azonosító még nem érhető el.');
        await window.WPP.chat.openChatBottom(self);
        if (action === 'test') {
          if (typeof content !== 'string' || !content.trim() || content.length > 1000) throw new Error('Írj egy rövid tesztüzenetet.');
          await window.WPP.chat.sendTextMessage(self, content.trim());
        }
        post('result', { requestId, result: { chatId: self, name: 'Saját tesztbeszélgetés', sent: action === 'test' } });
      } else if (action === 'active') {
        const chat = window.WPP.chat.getActiveChat();
        const id = idOf(chat?.id);
        if (!/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(id)) throw new Error('Nyiss meg egy személyes beszélgetést a WhatsAppban.');
        post('result', { requestId, result: { chatId: id, name: String(chat.formattedTitle || chat.name || id).slice(0, 200) } });
      } else if (action === 'send') {
        if (!/^\d+@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId) || typeof content !== 'string' || !content.trim() || content.length > 6000) throw new Error('Hibás válasz.');
        pendingSends.push({ chatId: normalize(chatId), content, at: Date.now() });
        pendingSends = pendingSends.slice(-100);
        await window.WPP.chat.sendTextMessage(chatId, content);
        post('result', { requestId, result: { sent: true } });
      }
    } catch (error) { post('result', { requestId, error: error.message || 'WhatsApp hiba.' }); }
  });
  setInterval(() => { subscribe(); status(); }, 2000);
  subscribe(); status();
})();

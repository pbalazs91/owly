(() => {
  const pending = new Map();
  let lastStatus = 0;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'owly-wa-page-v1') return;
    const data = event.data;
    if (data.type === 'result' && pending.has(data.requestId)) {
      const item = pending.get(data.requestId);
      pending.delete(data.requestId); clearTimeout(item.timer);
      item.respond(data.error ? { error: data.error } : data.result);
    } else if (data.type === 'status' && Date.now() - lastStatus > 20000) {
      lastStatus = Date.now();
      chrome.runtime.sendMessage({ type: 'WA_STATUS', status: data.status }).catch(() => {});
    } else if (data.type === 'incoming') {
      chrome.runtime.sendMessage({ type: 'WA_INCOMING', message: data.message }).catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['WA_ACTIVE', 'WA_SEND'].includes(message.type)) return;
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); respond({ error: 'A WhatsApp nem válaszolt időben.' }); }, 30000);
    pending.set(requestId, { timer, respond });
    window.postMessage({ channel: 'owly-wa-content-v1', requestId, action: message.type === 'WA_ACTIVE' ? 'active' : 'send', chatId: message.chatId, content: message.content }, location.origin);
    return true;
  });
})();

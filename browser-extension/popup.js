const $ = (id) => document.getElementById(id);
$('version').textContent = 'Betöltött bővítmény: ' + chrome.runtime.getManifest().version;
$('reload').onclick = () => chrome.runtime.reload();
async function request(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (result?.error) throw new Error(result.error);
  return result;
}
async function render(initial = false) {
  const state = await request('GET_STATE');
  const names = { connected: 'WhatsApp csatlakoztatva', qr_ready: 'A WhatsApp-oldalon vár a QR-kód', loading: 'A WhatsApp Web töltődik', disconnected: 'WhatsApp nincs csatlakoztatva' };
  $('status').textContent = names[state.waStatus] + (state.enabled ? '' : ' · feldolgozás szünetel');
  $('rocket-wait').textContent = state.rocket?.enabled && state.rocketPending?.length
    ? `${state.rocketPending.length} WhatsApp-válasz a gépen vár a RocketSender sikeres küldéseinek igazolására.`
    : '';
  if (initial) {
    $('token').placeholder = state.token ? 'Párosítókód elmentve; csak cseréhez írj újat' : 'Másold ide az Owly párosítókódját';
    $('enabled').checked = state.enabled; $('auto').checked = state.autoReply;
  }
  if (state.error) $('notice').textContent = state.error;
  $('allowed').replaceChildren();
  const allowed = { ...state.allowed, ...state.remoteAllowed };
  for (const [chatId, name] of Object.entries(allowed)) {
    const card = document.createElement('div'); card.className = 'card';
    const label = document.createElement('strong'); label.textContent = name;
    const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Engedély visszavonása';
    remove.onclick = () => perform(remove, async () => { await request('REMOVE_CHAT', { chatId }); await render(); });
    if (state.remoteAllowed?.[chatId]) { const note = document.createElement('p'); note.textContent = 'Mindig engedélyezve az Owlyban'; card.append(label, note); }
    else card.append(label, document.createElement('br'), remove);
    $('allowed').append(card);
  }
  if (!Object.keys(allowed).length) $('allowed').textContent = 'Még egy beszélgetés sincs engedélyezve.';
  $('drafts').replaceChildren();
  for (const draft of state.drafts) {
    const card = document.createElement('div'); card.className = 'card';
    const label = document.createElement('strong'); label.textContent = draft.name;
    const text = document.createElement('p'); text.textContent = draft.content;
    const send = document.createElement('button'); send.textContent = 'Válasz elküldése a WhatsAppon';
    send.onclick = () => perform(send, async () => { await request('SEND_DRAFT', { id: draft.id }); await render(); });
    card.append(label, text, send); $('drafts').append(card);
  }
  if (!state.drafts.length) $('drafts').textContent = 'Még nincs választervezet.';
  $('retry').hidden = !state.pending?.length;
}
async function perform(button, fn) {
  button.disabled = true; $('notice').textContent = '';
  try { await fn(); } catch (error) { $('notice').textContent = error.message || 'Hiba történt.'; }
  finally { button.disabled = false; }
}
$('open').onclick = () => perform($('open'), () => request('OPEN_WA'));
$('save').onclick = () => perform($('save'), async () => {
  await request('SAVE', { token: $('token').value, enabled: $('enabled').checked, autoReply: $('auto').checked });
  $('token').value = ''; $('notice').textContent = 'Beállítások elmentve.'; await render();
});
$('allow').onclick = () => perform($('allow'), async () => { await request('ALLOW_ACTIVE'); await render(); });
$('test').onclick = () => perform($('test'), async () => { const result = await request('TEST_OLLAMA'); $('notice').textContent = 'Az Ollama elérhető. Telepített modellek: ' + result.models; });
$('retry').onclick = () => perform($('retry'), async () => { await request('RETRY_PENDING'); await render(); });
$('self').onclick = () => perform($('self'), async () => { await request('SELF_OPEN'); await render(); $('notice').textContent = 'A saját beszélgetés engedélyezve. Bekapcsolt feldolgozásnál az ide írt új kérdésekből tervezet készül.'; });
$('send-test').onclick = () => perform($('send-test'), async () => { await request('SELF_TEST', { content: $('test-message').value }); $('notice').textContent = 'Tesztüzenet elküldve saját magadnak. A választervezet elkészítése eltarthat egy ideig.'; });
render(true).catch((error) => { $('notice').textContent = error.message; });
setInterval(() => render().catch(() => {}), 3000);

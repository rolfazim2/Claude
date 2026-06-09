'use strict';

/* Gram — клиент мессенджера (веб и desktop). */

// Базовый адрес сервера: в браузере — текущий origin,
// в desktop-приложении задаётся через window.GRAM_SERVER (preload).
const SERVER = (window.GRAM_SERVER || localStorage.getItem('gram_server') || location.origin)
  .replace(/\/$/, '');
const WS_URL = SERVER.replace(/^http/, 'ws') + '/ws';

const state = {
  token: localStorage.getItem('gram_token'),
  me: null,
  chats: [],                // список чатов (chatView с сервера)
  activeChatId: null,
  messages: new Map(),      // chatId -> Message[]
  hasMore: new Map(),       // chatId -> bool (есть ли более старые сообщения)
  presence: new Map(),      // userId -> {online, lastSeen}
  typing: new Map(),        // chatId -> Map<userId, timeoutId>
  socket: null,
  wsRetry: 0,
  editingMessageId: null,
  groupSelected: new Map(), // userId -> user
};

const $ = (id) => document.getElementById(id);

// ---------- API ----------

async function api(method, path, body) {
  const res = await fetch(SERVER + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.me) logout();
    throw new Error(data.error || 'Ошибка сети');
  }
  return data;
}

// ---------- Утилиты ----------

const AVATAR_COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];

function avatarHtml(name, id, extra = '', online = false) {
  const color = AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length];
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('');
  return `<div class="avatar ${extra}" style="background:${color}">${esc(initials)}` +
    (online ? '<span class="online-dot"></span>' : '') + '</div>';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function fmtChatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  const days = (today - d) / 86400000;
  if (days < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function fmtLastSeen(p) {
  if (!p) return 'был(а) недавно';
  if (p.online) return 'в сети';
  if (!p.lastSeen) return 'был(а) недавно';
  const diff = Date.now() - p.lastSeen;
  if (diff < 60000) return 'был(а) только что';
  if (diff < 3600000) return `был(а) ${Math.floor(diff / 60000)} мин. назад`;
  return 'был(а) ' + new Date(p.lastSeen).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function getPresence(user) {
  return state.presence.get(user.id) || { online: user.online, lastSeen: user.lastSeen };
}

const chatById = (id) => state.chats.find((c) => c.id === id);

// ---------- Авторизация ----------

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('auth-name').classList.toggle('hidden', mode === 'login');
  $('auth-submit').textContent = mode === 'login' ? 'Войти' : 'Создать аккаунт';
  $('auth-error').classList.add('hidden');
}

async function handleAuth(e) {
  e.preventDefault();
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  const name = $('auth-name').value.trim();
  try {
    const data = authMode === 'login'
      ? await api('POST', '/api/login', { username, password })
      : await api('POST', '/api/register', { username, password, name });
    state.token = data.token;
    state.me = data.user;
    localStorage.setItem('gram_token', data.token);
    enterApp();
  } catch (err) {
    $('auth-error').textContent = err.message;
    $('auth-error').classList.remove('hidden');
  }
}

function logout() {
  localStorage.removeItem('gram_token');
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
  }
  location.reload();
}

// ---------- WebSocket ----------

function connectWS() {
  const ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(state.token));
  state.socket = ws;

  ws.onopen = () => {
    state.wsRetry = 0;
    refreshChats();
  };

  ws.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handleServerEvent(ev);
  };

  ws.onclose = () => {
    state.socket = null;
    const delay = Math.min(1000 * 2 ** state.wsRetry++, 15000);
    setTimeout(() => { if (state.me) connectWS(); }, delay);
  };
}

function wsSend(obj) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function handleServerEvent(ev) {
  switch (ev.type) {
    case 'message': {
      const m = normalizeMsg(ev.message);
      appendMessage(m);
      const chat = chatById(m.chatId);
      if (chat) {
        chat.lastMessage = m;
        if (m.senderId !== state.me.id && m.chatId !== state.activeChatId) {
          chat.unread = (chat.unread || 0) + 1;
          notify(chat, m);
        }
        renderChatList();
      } else {
        refreshChats(); // новый чат, которого ещё нет в списке
      }
      if (m.chatId === state.activeChatId) {
        clearTypingFor(m.chatId, m.senderId);
        if (m.senderId !== state.me.id && document.hasFocus()) markRead(m.chatId, m.id);
      }
      break;
    }
    case 'ack': {
      confirmTempMessage(ev.tempId, normalizeMsg(ev.message));
      break;
    }
    case 'message_edited': {
      const m = normalizeMsg(ev.message);
      replaceMessage(m);
      const chat = chatById(m.chatId);
      if (chat && chat.lastMessage && chat.lastMessage.id === m.id) {
        chat.lastMessage = m;
        renderChatList();
      }
      break;
    }
    case 'message_deleted': {
      const list = state.messages.get(ev.chatId);
      if (list) {
        const m = list.find((x) => x.id === ev.messageId);
        if (m) { m.deleted = true; m.text = ''; }
        if (ev.chatId === state.activeChatId) renderMessages();
      }
      refreshChats();
      break;
    }
    case 'typing': {
      showTyping(ev.chatId, ev.userId);
      break;
    }
    case 'presence': {
      state.presence.set(ev.userId, { online: ev.online, lastSeen: ev.lastSeen });
      renderChatList();
      if (state.activeChatId) renderChatHeader();
      break;
    }
    case 'read': {
      const chat = chatById(ev.chatId);
      if (chat) {
        chat.readByOthersUpTo = Math.max(chat.readByOthersUpTo || 0, ev.messageId);
        if (ev.chatId === state.activeChatId) renderMessages();
      }
      break;
    }
    case 'chat': {
      refreshChats();
      break;
    }
  }
}

// ---------- Чаты ----------

async function refreshChats() {
  const data = await api('GET', '/api/chats');
  state.chats = data.chats;
  for (const c of state.chats) {
    for (const m of c.members) {
      if (!state.presence.has(m.id)) {
        state.presence.set(m.id, { online: m.online, lastSeen: m.lastSeen });
      }
    }
  }
  renderChatList();
  if (state.activeChatId) renderChatHeader();
}

function renderChatList() {
  const el = $('chat-list');
  if (!state.chats.length) {
    el.innerHTML = '<div class="list-section">Нет чатов — найдите собеседника через поиск</div>';
    return;
  }
  el.innerHTML = state.chats.map((c) => {
    const last = c.lastMessage;
    const preview = last
      ? (last.deleted ? '🗑 Сообщение удалено'
        : (c.type === 'group' && last.senderId !== state.me.id ? last.senderName + ': ' : '') +
          (last.senderId === state.me.id ? 'Вы: ' : '') + last.text)
      : 'Нет сообщений';
    const online = c.type === 'direct' && c.peer && getPresence(c.peer).online;
    return `
      <div class="chat-item ${c.id === state.activeChatId ? 'active' : ''}" data-chat="${c.id}">
        ${avatarHtml(c.title, c.type === 'group' ? c.id + 100 : (c.peer ? c.peer.id : 0), '', online)}
        <div class="chat-item-body">
          <div class="chat-item-top">
            <span class="chat-item-title">${c.type === 'group' ? '👥 ' : ''}${esc(c.title)}</span>
            <span class="chat-item-time">${last ? fmtChatTime(last.createdAt) : ''}</span>
          </div>
          <div class="chat-item-bottom">
            <span class="chat-item-preview">${esc(preview)}</span>
            ${c.unread ? `<span class="unread-badge">${c.unread}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  el.querySelectorAll('.chat-item').forEach((item) => {
    item.onclick = () => openChat(Number(item.dataset.chat));
  });

  if (window.gramDesktop) {
    window.gramDesktop.setBadge(state.chats.reduce((sum, c) => sum + (c.unread || 0), 0));
  }
}

async function openChat(chatId) {
  state.activeChatId = chatId;
  state.editingMessageId = null;
  $('edit-banner').classList.add('hidden');
  $('empty-state').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
  $('search-input').value = '';
  hideSearch();
  renderChatList();
  renderChatHeader();

  if (!state.messages.has(chatId)) {
    const data = await api('GET', `/api/chats/${chatId}/messages?limit=50`);
    state.messages.set(chatId, data.messages.map(normalizeMsg));
    state.hasMore.set(chatId, data.messages.length === 50);
  }
  renderMessages();
  scrollToBottom();
  $('message-input').focus();

  const list = state.messages.get(chatId);
  const chat = chatById(chatId);
  if (list && list.length && chat && chat.unread) {
    markRead(chatId, list[list.length - 1].id);
  }
}

function renderChatHeader() {
  const chat = chatById(state.activeChatId);
  if (!chat) return;
  $('chat-avatar').outerHTML = avatarHtml(
    chat.title, chat.type === 'group' ? chat.id + 100 : (chat.peer ? chat.peer.id : 0)
  ).replace('class="avatar', 'id="chat-avatar" class="avatar');
  $('chat-title').textContent = (chat.type === 'group' ? '👥 ' : '') + chat.title;
  const statusEl = $('chat-status');
  if (chat.type === 'group') {
    const online = chat.members.filter((m) => m.id !== state.me.id && getPresence(m).online).length;
    statusEl.textContent = `${chat.members.length} участников` + (online ? `, ${online} в сети` : '');
    statusEl.classList.remove('online');
  } else if (chat.peer) {
    const p = getPresence(chat.peer);
    statusEl.textContent = fmtLastSeen(p);
    statusEl.classList.toggle('online', !!p.online);
  }
}

function markRead(chatId, messageId) {
  const chat = chatById(chatId);
  if (chat) chat.unread = 0;
  renderChatList();
  if (!wsSend({ type: 'read', chatId, messageId })) {
    api('POST', `/api/chats/${chatId}/read`, { messageId }).catch(() => {});
  }
}

// ---------- Сообщения ----------

function normalizeMsg(m) {
  return { ...m, id: Number(m.id), chatId: Number(m.chatId), senderId: Number(m.senderId) };
}

function appendMessage(m) {
  const list = state.messages.get(m.chatId);
  if (list && !list.some((x) => x.id === m.id)) {
    list.push(m);
    if (m.chatId === state.activeChatId) {
      const el = $('messages');
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      renderMessages();
      if (atBottom || m.senderId === state.me.id) scrollToBottom();
    }
  }
}

function replaceMessage(m) {
  const list = state.messages.get(m.chatId);
  if (!list) return;
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m;
  if (m.chatId === state.activeChatId) renderMessages();
}

function confirmTempMessage(tempId, m) {
  const list = state.messages.get(m.chatId);
  if (!list) return;
  const i = list.findIndex((x) => x.tempId === tempId);
  if (i >= 0) list[i] = m; else if (!list.some((x) => x.id === m.id)) list.push(m);
  const chat = chatById(m.chatId);
  if (chat) { chat.lastMessage = m; renderChatList(); }
  if (m.chatId === state.activeChatId) renderMessages();
}

function renderMessages() {
  const chat = chatById(state.activeChatId);
  const list = state.messages.get(state.activeChatId) || [];
  const el = $('messages');
  let html = '';
  let lastDate = '';

  for (const m of list) {
    const date = fmtDate(m.createdAt);
    if (date !== lastDate) {
      html += `<div class="date-sep">${date}</div>`;
      lastDate = date;
    }
    const out = m.senderId === state.me.id;
    const read = chat && m.id && m.id <= (chat.readByOthersUpTo || 0);
    const checks = out && m.id ? `<span class="checks">${read ? '✓✓' : '✓'}</span>` : '';
    const pending = !m.id ? '<span title="Отправляется">🕓</span>' : '';
    const sender = !out && chat && chat.type === 'group'
      ? `<div class="msg-sender">${esc(m.senderName)}</div>` : '';
    const actions = out && m.id && !m.deleted
      ? `<div class="msg-actions">
           <button data-edit="${m.id}" title="Редактировать">✏️</button>
           <button data-del="${m.id}" title="Удалить">🗑</button>
         </div>` : '';
    const body = m.deleted ? 'Сообщение удалено' : esc(m.text);
    html += `
      <div class="msg ${out ? 'out' : 'in'} ${m.deleted ? 'deleted' : ''}">
        ${actions}${sender}${body}
        <span class="msg-meta">${m.editedAt && !m.deleted ? 'изм.' : ''} ${fmtTime(m.createdAt)} ${checks}${pending}</span>
      </div>`;
  }
  el.innerHTML = html;

  el.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => startEdit(Number(b.dataset.edit));
  });
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => deleteMessage(Number(b.dataset.del));
  });
}

function scrollToBottom() {
  const el = $('messages');
  el.scrollTop = el.scrollHeight;
}

async function loadOlder() {
  const chatId = state.activeChatId;
  const list = state.messages.get(chatId);
  if (!list || !list.length || !state.hasMore.get(chatId)) return;
  const el = $('messages');
  const prevHeight = el.scrollHeight;
  const data = await api('GET', `/api/chats/${chatId}/messages?before=${list[0].id}&limit=50`);
  if (chatId !== state.activeChatId) return;
  state.hasMore.set(chatId, data.messages.length === 50);
  list.unshift(...data.messages.map(normalizeMsg));
  renderMessages();
  el.scrollTop = el.scrollHeight - prevHeight;
}

async function sendMessage() {
  const input = $('message-input');
  const text = input.value.trim();
  if (!text || !state.activeChatId) return;
  input.value = '';
  input.style.height = 'auto';

  if (state.editingMessageId) {
    const id = state.editingMessageId;
    cancelEdit();
    try {
      const data = await api('PUT', `/api/messages/${id}`, { text });
      replaceMessage(normalizeMsg(data.message));
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const chatId = state.activeChatId;
  const tempId = 't' + Date.now() + Math.random().toString(36).slice(2);
  const temp = {
    id: 0, tempId, chatId, senderId: state.me.id, senderName: state.me.name,
    text, createdAt: Date.now(), deleted: false, editedAt: null,
  };
  state.messages.get(chatId).push(temp);
  renderMessages();
  scrollToBottom();

  if (!wsSend({ type: 'message', chatId, text, tempId })) {
    try {
      const data = await api('POST', `/api/chats/${chatId}/messages`, { text });
      confirmTempMessage(tempId, normalizeMsg(data.message));
    } catch (err) {
      alert('Не удалось отправить: ' + err.message);
    }
  }
}

function startEdit(messageId) {
  const list = state.messages.get(state.activeChatId) || [];
  const m = list.find((x) => x.id === messageId);
  if (!m) return;
  state.editingMessageId = messageId;
  $('edit-banner').classList.remove('hidden');
  const input = $('message-input');
  input.value = m.text;
  input.focus();
}

function cancelEdit() {
  state.editingMessageId = null;
  $('edit-banner').classList.add('hidden');
  $('message-input').value = '';
}

async function deleteMessage(messageId) {
  if (!confirm('Удалить сообщение?')) return;
  try {
    await api('DELETE', `/api/messages/${messageId}`);
    const list = state.messages.get(state.activeChatId);
    const m = list && list.find((x) => x.id === messageId);
    if (m) { m.deleted = true; m.text = ''; }
    renderMessages();
    refreshChats();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- «Печатает…» ----------

let typingThrottle = 0;

function sendTyping() {
  const now = Date.now();
  if (now - typingThrottle < 2000 || !state.activeChatId) return;
  typingThrottle = now;
  wsSend({ type: 'typing', chatId: state.activeChatId });
}

function showTyping(chatId, userId) {
  if (!state.typing.has(chatId)) state.typing.set(chatId, new Map());
  const map = state.typing.get(chatId);
  if (map.has(userId)) clearTimeout(map.get(userId));
  map.set(userId, setTimeout(() => {
    map.delete(userId);
    renderTyping();
  }, 4000));
  renderTyping();
}

function clearTypingFor(chatId, userId) {
  const map = state.typing.get(chatId);
  if (map && map.has(userId)) {
    clearTimeout(map.get(userId));
    map.delete(userId);
    renderTyping();
  }
}

function renderTyping() {
  const el = $('typing-bar');
  const map = state.typing.get(state.activeChatId);
  if (!map || !map.size) {
    el.textContent = '';
    return;
  }
  const chat = chatById(state.activeChatId);
  const names = [...map.keys()].map((uid) => {
    const m = chat && chat.members.find((x) => x.id === uid);
    return m ? m.name : '';
  }).filter(Boolean);
  el.textContent = names.length ? `${names.join(', ')} печатает…` : '';
}

// ---------- Поиск ----------

let searchTimer = 0;

function hideSearch() {
  $('search-results').classList.add('hidden');
  $('chat-list').classList.remove('hidden');
}

async function doSearch(q) {
  if (q.length < 2) {
    hideSearch();
    return;
  }
  const data = await api('GET', '/api/users?q=' + encodeURIComponent(q));
  const el = $('search-results');
  el.classList.remove('hidden');
  $('chat-list').classList.add('hidden');
  el.innerHTML = '<div class="list-section">Пользователи</div>' + (data.users.length
    ? data.users.map((u) => `
        <div class="chat-item" data-user="${u.id}">
          ${avatarHtml(u.name, u.id, '', u.online)}
          <div class="chat-item-body">
            <div class="chat-item-top"><span class="chat-item-title">${esc(u.name)}</span></div>
            <div class="chat-item-bottom"><span class="chat-item-preview">@${esc(u.username)}</span></div>
          </div>
        </div>`).join('')
    : '<div class="list-section">Никого не нашлось</div>');

  el.querySelectorAll('[data-user]').forEach((item) => {
    item.onclick = async () => {
      const data2 = await api('POST', '/api/chats', {
        type: 'direct', memberIds: [Number(item.dataset.user)],
      });
      await refreshChats();
      openChat(data2.chat.id);
    };
  });
}

// ---------- Группы ----------

let groupSearchTimer = 0;

function openGroupModal() {
  state.groupSelected.clear();
  $('group-title').value = '';
  $('group-search').value = '';
  $('group-results').innerHTML = '';
  renderGroupSelected();
  $('group-modal').classList.remove('hidden');
  $('menu-dropdown').classList.add('hidden');
  $('group-title').focus();
}

function renderGroupSelected() {
  $('group-selected').innerHTML = [...state.groupSelected.values()].map((u) =>
    `<span class="chip" data-remove="${u.id}">${esc(u.name)} ✕</span>`).join('');
  $('group-selected').querySelectorAll('[data-remove]').forEach((chip) => {
    chip.onclick = () => {
      state.groupSelected.delete(Number(chip.dataset.remove));
      renderGroupSelected();
    };
  });
}

async function groupSearch(q) {
  if (q.length < 2) {
    $('group-results').innerHTML = '';
    return;
  }
  const data = await api('GET', '/api/users?q=' + encodeURIComponent(q));
  $('group-results').innerHTML = data.users.map((u) => `
    <div class="chat-item" data-add="${u.id}" data-name="${esc(u.name)}" data-username="${esc(u.username)}">
      ${avatarHtml(u.name, u.id, 'small')}
      <div class="chat-item-body">
        <div class="chat-item-title">${esc(u.name)}</div>
        <div class="chat-item-preview">@${esc(u.username)}</div>
      </div>
    </div>`).join('');
  $('group-results').querySelectorAll('[data-add]').forEach((item) => {
    item.onclick = () => {
      const id = Number(item.dataset.add);
      state.groupSelected.set(id, { id, name: item.dataset.name, username: item.dataset.username });
      renderGroupSelected();
    };
  });
}

async function createGroup() {
  const title = $('group-title').value.trim();
  if (!title) { alert('Укажите название группы'); return; }
  if (!state.groupSelected.size) { alert('Добавьте участников'); return; }
  try {
    const data = await api('POST', '/api/chats', {
      type: 'group', title, memberIds: [...state.groupSelected.keys()],
    });
    $('group-modal').classList.add('hidden');
    await refreshChats();
    openChat(data.chat.id);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Уведомления ----------

function notify(chat, m) {
  if (document.hasFocus() || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const n = new Notification(chat.title, { body: (chat.type === 'group' ? m.senderName + ': ' : '') + m.text });
  n.onclick = () => { window.focus(); openChat(chat.id); };
}

// ---------- Тема ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('gram_theme', theme);
  $('theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ---------- Запуск ----------

async function enterApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('menu-avatar').outerHTML = avatarHtml(state.me.name, state.me.id, 'small')
    .replace('class="avatar', 'id="menu-avatar" class="avatar');
  $('menu-name').textContent = state.me.name;
  $('menu-username').textContent = '@' + state.me.username;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  connectWS();
}

function bindEvents() {
  $('tab-login').onclick = () => setAuthMode('login');
  $('tab-register').onclick = () => setAuthMode('register');
  $('auth-form').onsubmit = handleAuth;

  $('logout-btn').onclick = logout;
  $('new-group-btn').onclick = openGroupModal;
  $('menu-btn').onclick = (e) => {
    e.stopPropagation();
    $('menu-dropdown').classList.toggle('hidden');
  };
  document.addEventListener('click', (e) => {
    if (!$('menu-dropdown').contains(e.target)) $('menu-dropdown').classList.add('hidden');
  });

  $('theme-btn').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  $('search-input').oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => doSearch(q).catch(() => {}), 300);
  };

  const input = $('message-input');
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'Escape' && state.editingMessageId) cancelEdit();
  };
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    sendTyping();
  };
  $('send-btn').onclick = sendMessage;
  $('edit-cancel').onclick = cancelEdit;

  $('messages').onscroll = () => {
    if ($('messages').scrollTop < 60) loadOlder().catch(() => {});
  };

  window.addEventListener('focus', () => {
    const chat = chatById(state.activeChatId);
    const list = state.messages.get(state.activeChatId);
    if (chat && chat.unread && list && list.length) {
      markRead(chat.id, list[list.length - 1].id);
    }
  });

  $('group-cancel').onclick = () => $('group-modal').classList.add('hidden');
  $('group-create').onclick = createGroup;
  $('group-search').oninput = (e) => {
    clearTimeout(groupSearchTimer);
    const q = e.target.value.trim();
    groupSearchTimer = setTimeout(() => groupSearch(q).catch(() => {}), 300);
  };
}

async function main() {
  applyTheme(localStorage.getItem('gram_theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  if (window.gramDesktop) document.body.classList.add('desktop');
  bindEvents();

  if (state.token) {
    try {
      const data = await api('GET', '/api/me');
      state.me = data.user;
      enterApp();
      return;
    } catch {
      localStorage.removeItem('gram_token');
      state.token = null;
    }
  }
  $('auth-screen').classList.remove('hidden');
}

main();

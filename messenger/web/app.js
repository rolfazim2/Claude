'use strict';

/* Gram — клиент мессенджера (веб и desktop). */

// Базовый адрес сервера: в браузере — текущий origin,
// в desktop-приложении задаётся через window.GRAM_SERVER (preload).
const SERVER = (window.GRAM_SERVER || localStorage.getItem('gram_server') || location.origin)
  .replace(/\/$/, '');
const WS_URL = SERVER.replace(/^http/, 'ws') + '/ws';

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢', '🎉'];

const state = {
  token: localStorage.getItem('gram_token'),
  me: null,
  chats: [],                // список чатов (chatView с сервера)
  activeChatId: null,
  messages: new Map(),      // chatId -> Message[]
  hasMore: new Map(),       // chatId -> bool (есть ли более старые сообщения)
  presence: new Map(),      // userId -> {online, lastSeen}
  typing: new Map(),        // chatId -> Map<userId, timeoutId>
  drafts: new Map(),        // chatId -> текст черновика
  socket: null,
  wsRetry: 0,
  editingMessageId: null,
  replyToId: null,
  forwardMessageId: null,
  groupSelected: new Map(), // userId -> user
  groupType: 'group',
  recorder: null,           // MediaRecorder для голосовых
  call: null,               // состояние текущего звонка
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

async function uploadFile(file) {
  const res = await fetch(SERVER + '/api/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + state.token,
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || 'file'),
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить файл');
  return data.file;
}

const fileUrl = (url) => (url && url.startsWith('/') ? SERVER + url : url);

// ---------- Утилиты ----------

const AVATAR_COLORS = ['#e17076', '#faa774', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];

function avatarHtml(name, id, extra = '', online = false, avatarUrl = null) {
  const color = AVATAR_COLORS[Math.abs(Number(id) || 0) % AVATAR_COLORS.length];
  const inner = avatarUrl
    ? `<img src="${esc(fileUrl(avatarUrl))}" alt="">`
    : esc(String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join(''));
  return `<div class="avatar ${extra}" style="background:${color}">${inner}` +
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

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
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

function previewText(m) {
  if (!m) return 'Нет сообщений';
  if (m.deleted) return '🗑 Сообщение удалено';
  const kinds = { image: '🖼 Фото', video: '🎬 Видео', voice: '🎤 Голосовое сообщение', file: '📄 ' + (m.file ? m.file.name : 'Файл') };
  const body = m.kind !== 'text' ? kinds[m.kind] + (m.text ? ': ' + m.text : '') : m.text;
  return body;
}

function canPost(chat) {
  if (!chat) return false;
  if (chat.type !== 'channel') return true;
  return chat.myRole === 'owner' || chat.myRole === 'admin';
}

const isAdminOf = (chat) => chat && (chat.myRole === 'owner' || chat.myRole === 'admin');

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
        if (m) { m.deleted = true; m.text = ''; m.file = null; }
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
    case 'chat_updated': {
      const i = state.chats.findIndex((c) => c.id === ev.chat.id);
      if (i >= 0) {
        ev.chat.unread = state.chats[i].unread;
        state.chats[i] = ev.chat;
      } else {
        state.chats.push(ev.chat);
      }
      renderChatList();
      if (ev.chat.id === state.activeChatId) {
        renderChatHeader();
        renderPinnedBar();
        renderInfoPanel();
      }
      break;
    }
    case 'chat_removed': {
      state.chats = state.chats.filter((c) => c.id !== ev.chatId);
      if (state.activeChatId === ev.chatId) {
        state.activeChatId = null;
        $('chat-view').classList.add('hidden');
        $('empty-state').classList.remove('hidden');
        closeInfoPanel();
      }
      renderChatList();
      break;
    }
    case 'call': {
      handleCallEvent(ev);
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
  if (state.activeChatId) {
    renderChatHeader();
    renderPinnedBar();
  }
}

function chatIcon(c) {
  return c.type === 'group' ? '👥 ' : c.type === 'channel' ? '📢 ' : '';
}

function renderChatList() {
  const el = $('chat-list');
  if (!state.chats.length) {
    el.innerHTML = '<div class="list-section">Нет чатов — найдите собеседника через поиск</div>';
  } else {
    el.innerHTML = state.chats.map((c) => {
      const last = c.lastMessage;
      const from = last && !last.deleted
        ? (last.senderId === state.me.id ? 'Вы: '
          : (c.type !== 'direct' ? last.senderName + ': ' : ''))
        : '';
      const online = c.type === 'direct' && c.peer && getPresence(c.peer).online;
      return `
        <div class="chat-item ${c.id === state.activeChatId ? 'active' : ''}" data-chat="${c.id}">
          ${avatarHtml(c.title, c.type === 'direct' ? (c.peer ? c.peer.id : 0) : c.id + 100, '', online, c.avatar)}
          <div class="chat-item-body">
            <div class="chat-item-top">
              <span class="chat-item-title">${chatIcon(c)}${esc(c.title)}${c.muted ? ' <span class="muted-icon">🔇</span>' : ''}</span>
              <span class="chat-item-time">${last ? fmtChatTime(last.createdAt) : ''}</span>
            </div>
            <div class="chat-item-bottom">
              <span class="chat-item-preview">${esc(from + previewText(last))}</span>
              ${c.unread ? `<span class="unread-badge">${c.unread}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  el.querySelectorAll('.chat-item').forEach((item) => {
    item.onclick = () => openChat(Number(item.dataset.chat));
  });

  if (window.gramDesktop) {
    window.gramDesktop.setBadge(
      state.chats.reduce((sum, c) => sum + (c.muted ? 0 : (c.unread || 0)), 0)
    );
  }
}

async function openChat(chatId) {
  // сохраняем черновик предыдущего чата
  if (state.activeChatId) state.drafts.set(state.activeChatId, $('message-input').value);

  state.activeChatId = chatId;
  cancelEdit();
  cancelReply();
  $('empty-state').classList.add('hidden');
  $('chat-view').classList.remove('hidden');
  $('search-input').value = '';
  hideSearch();
  closeInfoPanel();
  renderChatList();
  renderChatHeader();
  renderPinnedBar();
  renderTyping();

  const chat = chatById(chatId);
  const writable = canPost(chat);
  $('composer-row').classList.toggle('hidden', !writable);
  $('readonly-bar').classList.toggle('hidden', writable);

  if (!state.messages.has(chatId)) {
    const data = await api('GET', `/api/chats/${chatId}/messages?limit=50`);
    state.messages.set(chatId, data.messages.map(normalizeMsg));
    state.hasMore.set(chatId, data.messages.length === 50);
  }
  renderMessages();
  scrollToBottom();
  $('message-input').value = state.drafts.get(chatId) || '';
  $('message-input').focus();

  const list = state.messages.get(chatId);
  if (list && list.length && chat && chat.unread) {
    markRead(chatId, list[list.length - 1].id);
  }
}

function renderChatHeader() {
  const chat = chatById(state.activeChatId);
  if (!chat) return;
  $('chat-avatar').outerHTML = avatarHtml(
    chat.title, chat.type === 'direct' ? (chat.peer ? chat.peer.id : 0) : chat.id + 100,
    '', false, chat.avatar
  ).replace('class="avatar', 'id="chat-avatar" class="avatar');
  $('chat-title').textContent = chatIcon(chat) + chat.title;
  const statusEl = $('chat-status');
  if (chat.type === 'group') {
    const online = chat.members.filter((m) => m.id !== state.me.id && getPresence(m).online).length;
    statusEl.textContent = `${chat.members.length} участников` + (online ? `, ${online} в сети` : '');
    statusEl.classList.remove('online');
  } else if (chat.type === 'channel') {
    statusEl.textContent = `${chat.members.length} подписчиков`;
    statusEl.classList.remove('online');
  } else if (chat.peer) {
    const p = getPresence(chat.peer);
    statusEl.textContent = fmtLastSeen(p);
    statusEl.classList.toggle('online', !!p.online);
  }
  const direct = chat.type === 'direct';
  $('call-audio-btn').classList.toggle('hidden', !direct);
  $('call-video-btn').classList.toggle('hidden', !direct);
}

function renderPinnedBar() {
  const chat = chatById(state.activeChatId);
  const bar = $('pinned-bar');
  if (!chat || !chat.pinnedMessage) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  $('pinned-text').textContent =
    chat.pinnedMessage.senderName + ': ' + previewText(chat.pinnedMessage);
  $('unpin-btn').classList.toggle('hidden', chat.type !== 'direct' && !isAdminOf(chat));
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

function renderMessageBody(m) {
  let html = '';
  if (m.forwardFrom) html += `<div class="msg-forward">Переслано от ${esc(m.forwardFrom)}</div>`;
  if (m.replyTo) {
    html += `<div class="msg-reply" data-jump="${m.replyTo.id}">
      <div class="msg-reply-name">${esc(m.replyTo.senderName)}</div>
      <div class="msg-reply-text">${esc(m.replyTo.deleted ? 'Сообщение удалено' : previewText(m.replyTo))}</div>
    </div>`;
  }
  if (m.deleted) return html + 'Сообщение удалено';
  const f = m.file;
  if (m.kind === 'image' && f) {
    html += `<img class="msg-image" src="${esc(fileUrl(f.url))}" data-lightbox="${esc(fileUrl(f.url))}" alt="${esc(f.name)}">`;
  } else if (m.kind === 'video' && f) {
    html += `<video controls preload="metadata" src="${esc(fileUrl(f.url))}"></video>`;
  } else if (m.kind === 'voice' && f) {
    html += `<audio controls preload="metadata" src="${esc(fileUrl(f.url))}"></audio>`;
  } else if (m.kind === 'file' && f) {
    html += `<a class="msg-file" href="${esc(fileUrl(f.url))}" download="${esc(f.name)}">
      <span class="msg-file-icon">📄</span>
      <span><div class="msg-file-name">${esc(f.name)}</div>
      <div class="msg-file-size">${fmtSize(f.size)}</div></span>
    </a>`;
  }
  if (m.text) html += esc(m.text);
  return html;
}

function renderReactions(m) {
  if (!m.reactions || !m.reactions.length) return '';
  return '<div class="msg-reactions">' + m.reactions.map((r) => {
    const mine = r.userIds.includes(state.me.id);
    return `<span class="reaction ${mine ? 'mine' : ''}" data-react-msg="${m.id}"
      data-emoji="${esc(r.emoji)}" title="${esc(r.names.join(', '))}">${r.emoji} ${r.count}</span>`;
  }).join('') + '</div>';
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
    let actions = '';
    if (m.id && !m.deleted) {
      const btns = [
        `<button data-react="${m.id}" title="Реакция">😀</button>`,
        canPost(chat) ? `<button data-reply="${m.id}" title="Ответить">↩️</button>` : '',
        `<button data-fwd="${m.id}" title="Переслать">➡️</button>`,
        (chat && (chat.type === 'direct' || isAdminOf(chat)))
          ? `<button data-pin="${m.id}" title="Закрепить">📌</button>` : '',
        out && m.kind === 'text' ? `<button data-edit="${m.id}" title="Редактировать">✏️</button>` : '',
        (out || (chat && chat.type !== 'direct' && isAdminOf(chat)))
          ? `<button data-del="${m.id}" title="Удалить">🗑</button>` : '',
      ].filter(Boolean).join('');
      actions = `<div class="msg-actions">${btns}</div>`;
    }
    html += `
      <div class="msg ${out ? 'out' : 'in'} ${m.deleted ? 'deleted' : ''}" data-msg="${m.id}">
        ${actions}${sender}${renderMessageBody(m)}
        <span class="msg-meta">${m.editedAt && !m.deleted ? 'изм.' : ''} ${fmtTime(m.createdAt)} ${checks}${pending}</span>
        ${renderReactions(m)}
      </div>`;
  }
  el.innerHTML = html;

  el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => startEdit(Number(b.dataset.edit)); });
  el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteMessage(Number(b.dataset.del)); });
  el.querySelectorAll('[data-reply]').forEach((b) => { b.onclick = () => startReply(Number(b.dataset.reply)); });
  el.querySelectorAll('[data-fwd]').forEach((b) => { b.onclick = () => openForward(Number(b.dataset.fwd)); });
  el.querySelectorAll('[data-pin]').forEach((b) => { b.onclick = () => pinMessage(Number(b.dataset.pin)); });
  el.querySelectorAll('[data-react]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); showReactionPicker(Number(b.dataset.react), b); };
  });
  el.querySelectorAll('[data-react-msg]').forEach((b) => {
    b.onclick = () => toggleReaction(Number(b.dataset.reactMsg), b.dataset.emoji);
  });
  el.querySelectorAll('[data-lightbox]').forEach((img) => {
    img.onclick = () => {
      $('lightbox-img').src = img.dataset.lightbox;
      $('lightbox').classList.remove('hidden');
    };
  });
  el.querySelectorAll('[data-jump]').forEach((r) => {
    r.onclick = () => {
      const target = el.querySelector(`[data-msg="${r.dataset.jump}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
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
  state.drafts.delete(state.activeChatId);

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
  const replyTo = state.replyToId;
  const replyMsg = replyTo
    ? (state.messages.get(chatId) || []).find((x) => x.id === replyTo) : null;
  cancelReply();

  const tempId = 't' + Date.now() + Math.random().toString(36).slice(2);
  const temp = {
    id: 0, tempId, chatId, senderId: state.me.id, senderName: state.me.name,
    kind: 'text', text, createdAt: Date.now(), deleted: false, editedAt: null,
    reactions: [], file: null, forwardFrom: null,
    replyTo: replyMsg ? {
      id: replyMsg.id, senderName: replyMsg.senderName,
      kind: replyMsg.kind, text: replyMsg.text, deleted: false,
    } : null,
  };
  state.messages.get(chatId).push(temp);
  renderMessages();
  scrollToBottom();

  if (!wsSend({ type: 'message', chatId, text, tempId, replyTo })) {
    try {
      const data = await api('POST', `/api/chats/${chatId}/messages`, { text, replyTo });
      confirmTempMessage(tempId, normalizeMsg(data.message));
    } catch (err) {
      alert('Не удалось отправить: ' + err.message);
    }
  }
}

async function sendFileMessage(file) {
  const chatId = state.activeChatId;
  if (!chatId) return;
  const replyTo = state.replyToId;
  cancelReply();
  try {
    const uploaded = await uploadFile(file);
    const kind = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video' : 'file';
    const caption = $('message-input').value.trim();
    $('message-input').value = '';
    const data = await api('POST', `/api/chats/${chatId}/messages`, {
      kind, fileId: uploaded.id, text: caption, replyTo,
    });
    if (chatId === state.activeChatId) {
      appendMessage(normalizeMsg(data.message));
      scrollToBottom();
    }
    refreshChats();
  } catch (err) {
    alert(err.message);
  }
}

function startEdit(messageId) {
  const list = state.messages.get(state.activeChatId) || [];
  const m = list.find((x) => x.id === messageId);
  if (!m) return;
  cancelReply();
  state.editingMessageId = messageId;
  $('edit-banner').classList.remove('hidden');
  const input = $('message-input');
  input.value = m.text;
  input.focus();
}

function cancelEdit() {
  if (state.editingMessageId) $('message-input').value = '';
  state.editingMessageId = null;
  $('edit-banner').classList.add('hidden');
}

function startReply(messageId) {
  const list = state.messages.get(state.activeChatId) || [];
  const m = list.find((x) => x.id === messageId);
  if (!m) return;
  cancelEdit();
  state.replyToId = messageId;
  $('reply-banner').classList.remove('hidden');
  $('reply-banner-text').textContent = `↩️ ${m.senderName}: ${previewText(m).slice(0, 60)}`;
  $('message-input').focus();
}

function cancelReply() {
  state.replyToId = null;
  $('reply-banner').classList.add('hidden');
}

async function deleteMessage(messageId) {
  if (!confirm('Удалить сообщение?')) return;
  try {
    await api('DELETE', `/api/messages/${messageId}`);
    const list = state.messages.get(state.activeChatId);
    const m = list && list.find((x) => x.id === messageId);
    if (m) { m.deleted = true; m.text = ''; m.file = null; }
    renderMessages();
    refreshChats();
  } catch (err) {
    alert(err.message);
  }
}

async function pinMessage(messageId) {
  try {
    await api('POST', `/api/chats/${state.activeChatId}/pin`, { messageId });
    await refreshChats();
    renderPinnedBar();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Реакции ----------

function showReactionPicker(messageId, anchor) {
  document.querySelectorAll('.reaction-picker').forEach((p) => p.remove());
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  picker.innerHTML = REACTION_EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
  anchor.closest('.msg').appendChild(picker);
  picker.querySelectorAll('button').forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      picker.remove();
      toggleReaction(messageId, b.dataset.e);
    };
  });
  setTimeout(() => {
    document.addEventListener('click', () => picker.remove(), { once: true });
  }, 0);
}

async function toggleReaction(messageId, emoji) {
  try {
    const data = await api('POST', `/api/messages/${messageId}/reactions`, { emoji });
    replaceMessage(normalizeMsg(data.message));
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Пересылка ----------

function openForward(messageId) {
  state.forwardMessageId = messageId;
  const list = state.chats.filter((c) => canPost(c));
  $('forward-list').innerHTML = list.map((c) => `
    <div class="chat-item" data-fwd-chat="${c.id}">
      ${avatarHtml(c.title, c.type === 'direct' ? (c.peer ? c.peer.id : 0) : c.id + 100, 'small', false, c.avatar)}
      <div class="chat-item-body"><div class="chat-item-title">${chatIcon(c)}${esc(c.title)}</div></div>
    </div>`).join('');
  $('forward-list').querySelectorAll('[data-fwd-chat]').forEach((item) => {
    item.onclick = async () => {
      const chatId = Number(item.dataset.fwdChat);
      $('forward-modal').classList.add('hidden');
      try {
        await api('POST', `/api/messages/${state.forwardMessageId}/forward`, { chatId });
        await refreshChats();
        openChat(chatId);
      } catch (err) {
        alert(err.message);
      }
    };
  });
  $('forward-modal').classList.remove('hidden');
}

// ---------- Голосовые сообщения ----------

async function toggleVoiceRecording() {
  if (state.recorder) {
    state.recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      state.recorder = null;
      $('voice-btn').classList.remove('recording');
      $('voice-btn').textContent = '🎤';
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 1000) return; // случайное нажатие
      const file = new File([blob], 'Голосовое сообщение.webm', { type: blob.type });
      const chatId = state.activeChatId;
      try {
        const uploaded = await uploadFile(file);
        const data = await api('POST', `/api/chats/${chatId}/messages`, {
          kind: 'voice', fileId: uploaded.id, text: '',
        });
        if (chatId === state.activeChatId) {
          appendMessage(normalizeMsg(data.message));
          scrollToBottom();
        }
        refreshChats();
      } catch (err) {
        alert(err.message);
      }
    };
    rec.start();
    state.recorder = rec;
    $('voice-btn').classList.add('recording');
    $('voice-btn').textContent = '⏹';
  } catch {
    alert('Нет доступа к микрофону');
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
  const [usersRes, msgsRes] = await Promise.all([
    api('GET', '/api/users?q=' + encodeURIComponent(q)),
    api('GET', '/api/search?q=' + encodeURIComponent(q)),
  ]);
  const el = $('search-results');
  el.classList.remove('hidden');
  $('chat-list').classList.add('hidden');

  let html = '<div class="list-section">Пользователи</div>';
  html += usersRes.users.length
    ? usersRes.users.map((u) => `
        <div class="chat-item" data-user="${u.id}">
          ${avatarHtml(u.name, u.id, '', u.online, u.avatar)}
          <div class="chat-item-body">
            <div class="chat-item-top"><span class="chat-item-title">${esc(u.name)}</span></div>
            <div class="chat-item-bottom"><span class="chat-item-preview">@${esc(u.username)}</span></div>
          </div>
        </div>`).join('')
    : '<div class="list-section">Никого не нашлось</div>';

  if (msgsRes.messages.length) {
    html += '<div class="list-section">Сообщения</div>';
    html += msgsRes.messages.map((m) => {
      const chat = chatById(m.chatId);
      return `
        <div class="chat-item" data-goto-chat="${m.chatId}">
          ${avatarHtml(m.senderName, m.senderId, '', false, m.senderAvatar)}
          <div class="chat-item-body">
            <div class="chat-item-top">
              <span class="chat-item-title">${esc(chat ? chat.title : m.senderName)}</span>
              <span class="chat-item-time">${fmtChatTime(m.createdAt)}</span>
            </div>
            <div class="chat-item-bottom">
              <span class="chat-item-preview">${esc(m.senderName)}: ${esc(m.text.slice(0, 80))}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }
  el.innerHTML = html;

  el.querySelectorAll('[data-user]').forEach((item) => {
    item.onclick = async () => {
      const data2 = await api('POST', '/api/chats', {
        type: 'direct', memberIds: [Number(item.dataset.user)],
      });
      await refreshChats();
      openChat(data2.chat.id);
    };
  });
  el.querySelectorAll('[data-goto-chat]').forEach((item) => {
    item.onclick = () => openChat(Number(item.dataset.gotoChat));
  });
}

// ---------- Группы и каналы ----------

let groupSearchTimer = 0;

function openGroupModal(type) {
  state.groupType = type;
  state.groupSelected.clear();
  $('group-modal-title').textContent = type === 'channel' ? 'Новый канал' : 'Новая группа';
  $('group-title').value = '';
  $('group-description').value = '';
  $('group-search').value = '';
  $('group-search').placeholder = type === 'channel' ? 'Поиск подписчиков' : 'Поиск участников';
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
      ${avatarHtml(u.name, u.id, 'small', false, u.avatar)}
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
  if (!title) { alert('Укажите название'); return; }
  if (state.groupType === 'group' && !state.groupSelected.size) {
    alert('Добавьте участников');
    return;
  }
  try {
    const data = await api('POST', '/api/chats', {
      type: state.groupType,
      title,
      description: $('group-description').value.trim(),
      memberIds: [...state.groupSelected.keys()],
    });
    $('group-modal').classList.add('hidden');
    await refreshChats();
    openChat(data.chat.id);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Панель информации ----------

function closeInfoPanel() {
  $('info-panel').classList.add('hidden');
}

function renderInfoPanel() {
  const chat = chatById(state.activeChatId);
  if (!chat || $('info-panel').classList.contains('hidden')) return;

  const isDirect = chat.type === 'direct';
  const target = isDirect ? chat.peer : chat;
  $('info-avatar-wrap').innerHTML = avatarHtml(
    chat.title, isDirect ? (chat.peer ? chat.peer.id : 0) : chat.id + 100, '', false, chat.avatar
  );
  $('info-title').textContent = chat.title;
  $('info-subtitle').textContent = isDirect
    ? '@' + (chat.peer ? chat.peer.username : '')
    : (chat.type === 'channel'
      ? `${chat.members.length} подписчиков` : `${chat.members.length} участников`);
  $('info-description').textContent = isDirect
    ? (chat.peer ? chat.peer.bio : '') : (chat.description || '');

  $('mute-toggle').checked = !!chat.muted;
  const admin = isAdminOf(chat);
  $('edit-chat-btn').classList.toggle('hidden', isDirect || !admin);
  $('chat-avatar-btn').classList.toggle('hidden', isDirect || !admin);
  $('add-member-btn').classList.toggle('hidden', isDirect);
  $('leave-chat-btn').classList.toggle('hidden', isDirect || chat.myRole === 'owner');

  $('info-members-title').textContent = isDirect ? ''
    : (chat.type === 'channel' ? 'Подписчики' : 'Участники');
  if (isDirect) {
    $('info-members').innerHTML = '';
  } else {
    const owner = chat.myRole === 'owner';
    $('info-members').innerHTML = chat.members.map((u) => {
      const roleLabel = u.role === 'owner' ? '<span class="member-role">владелец</span>'
        : u.role === 'admin' ? '<span class="member-role">админ</span>' : '';
      const acts = [];
      if (owner && u.role !== 'owner') {
        acts.push(`<button class="icon-btn" data-toggle-admin="${u.id}" data-is-admin="${u.role === 'admin'}"
          title="${u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}">⭐</button>`);
      }
      if (admin && u.role !== 'owner' && u.id !== state.me.id) {
        acts.push(`<button class="icon-btn" data-kick="${u.id}" title="Удалить">✕</button>`);
      }
      return `
        <div class="chat-item">
          ${avatarHtml(u.name, u.id, 'small', getPresence(u).online, u.avatar)}
          <div class="chat-item-body">
            <div class="chat-item-title">${esc(u.name)}${u.id === state.me.id ? ' (вы)' : ''}${roleLabel}</div>
            <div class="chat-item-preview">@${esc(u.username)}</div>
          </div>
          <div class="member-actions">${acts.join('')}</div>
        </div>`;
    }).join('');

    $('info-members').querySelectorAll('[data-kick]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Удалить участника?')) return;
        try {
          await api('DELETE', `/api/chats/${chat.id}/members/${b.dataset.kick}`);
          await refreshChats();
          renderInfoPanel();
        } catch (err) { alert(err.message); }
      };
    });
    $('info-members').querySelectorAll('[data-toggle-admin]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api('POST', `/api/chats/${chat.id}/admins`, {
            userId: Number(b.dataset.toggleAdmin),
            admin: b.dataset.isAdmin !== 'true',
          });
          await refreshChats();
          renderInfoPanel();
        } catch (err) { alert(err.message); }
      };
    });
  }
}

let addMemberTimer = 0;

async function addMemberSearch(q) {
  if (q.length < 2) { $('add-member-results').innerHTML = ''; return; }
  const chat = chatById(state.activeChatId);
  const data = await api('GET', '/api/users?q=' + encodeURIComponent(q));
  const existing = new Set(chat.members.map((m) => m.id));
  $('add-member-results').innerHTML = data.users.filter((u) => !existing.has(u.id)).map((u) => `
    <div class="chat-item" data-invite="${u.id}">
      ${avatarHtml(u.name, u.id, 'small', false, u.avatar)}
      <div class="chat-item-body">
        <div class="chat-item-title">${esc(u.name)}</div>
        <div class="chat-item-preview">@${esc(u.username)}</div>
      </div>
    </div>`).join('');
  $('add-member-results').querySelectorAll('[data-invite]').forEach((item) => {
    item.onclick = async () => {
      try {
        await api('POST', `/api/chats/${chat.id}/members`, {
          userIds: [Number(item.dataset.invite)],
        });
        item.remove();
        await refreshChats();
        renderInfoPanel();
      } catch (err) { alert(err.message); }
    };
  });
}

// ---------- Профиль ----------

let profileAvatarFileId; // undefined = не менять, null = удалить, число = новый файл

function openProfileModal() {
  $('menu-dropdown').classList.add('hidden');
  profileAvatarFileId = undefined;
  $('profile-avatar').innerHTML = avatarHtml(state.me.name, state.me.id, '', false, state.me.avatar);
  $('profile-name').value = state.me.name;
  $('profile-bio').value = state.me.bio || '';
  $('profile-modal').classList.remove('hidden');
}

async function saveProfile() {
  try {
    const body = {
      name: $('profile-name').value.trim(),
      bio: $('profile-bio').value.trim(),
    };
    if (profileAvatarFileId !== undefined) body.avatarFileId = profileAvatarFileId;
    const data = await api('PUT', '/api/me', body);
    state.me = data.user;
    $('profile-modal').classList.add('hidden');
    renderMenuMe();
    refreshChats();
  } catch (err) {
    alert(err.message);
  }
}

function renderMenuMe() {
  $('menu-avatar').outerHTML = avatarHtml(state.me.name, state.me.id, 'small', false, state.me.avatar)
    .replace('class="avatar', 'id="menu-avatar" class="avatar');
  $('menu-name').textContent = state.me.name;
  $('menu-username').textContent = '@' + state.me.username;
}

// ---------- Звонки (WebRTC, 1-на-1) ----------

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function callUI(visible, status) {
  $('call-modal').classList.toggle('hidden', !visible);
  if (status) $('call-status').textContent = status;
}

async function startCall(video) {
  const chat = chatById(state.activeChatId);
  if (!chat || chat.type !== 'direct' || !chat.peer) return;
  if (state.call) { alert('Звонок уже идёт'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.call = { pc, peerId: chat.peer.id, stream, incoming: false };
    setupPeer(pc, chat.peer.id, stream);
    callUI(true, `Звоним: ${chat.peer.name}…`);
    $('call-accept').classList.add('hidden');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: 'call', action: 'offer', to: chat.peer.id, video, payload: offer });
  } catch {
    alert('Нет доступа к камере/микрофону');
    endCall(false);
  }
}

function setupPeer(pc, peerId, stream) {
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  $('local-video').srcObject = stream;
  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: 'call', action: 'ice', to: peerId, payload: e.candidate });
  };
  pc.ontrack = (e) => {
    $('remote-video').srcObject = e.streams[0];
    callUI(true, 'Разговор');
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && state.call) {
      endCall(false);
    }
  };
}

async function handleCallEvent(ev) {
  if (ev.action === 'offer') {
    if (state.call) {
      wsSend({ type: 'call', action: 'reject', to: ev.from });
      return;
    }
    state.call = { peerId: ev.from, incoming: true, pendingOffer: ev.payload, video: ev.video, pendingIce: [] };
    callUI(true, `${ev.fromName} ${ev.video ? 'видеозвонок' : 'звонит'}…`);
    $('call-accept').classList.remove('hidden');
    return;
  }
  if (!state.call || ev.from !== state.call.peerId) return;

  if (ev.action === 'answer' && state.call.pc) {
    await state.call.pc.setRemoteDescription(ev.payload);
  } else if (ev.action === 'ice') {
    if (state.call.pc && state.call.pc.remoteDescription) {
      await state.call.pc.addIceCandidate(ev.payload).catch(() => {});
    } else if (state.call.pendingIce) {
      state.call.pendingIce.push(ev.payload);
    }
  } else if (ev.action === 'hangup' || ev.action === 'reject') {
    endCall(false);
  }
}

async function acceptCall() {
  const call = state.call;
  if (!call || !call.incoming) return;
  $('call-accept').classList.add('hidden');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!call.video });
    const pc = new RTCPeerConnection(RTC_CONFIG);
    call.pc = pc;
    call.stream = stream;
    setupPeer(pc, call.peerId, stream);
    await pc.setRemoteDescription(call.pendingOffer);
    for (const ice of call.pendingIce || []) {
      await pc.addIceCandidate(ice).catch(() => {});
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type: 'call', action: 'answer', to: call.peerId, payload: answer });
    callUI(true, 'Соединение…');
  } catch {
    alert('Нет доступа к камере/микрофону');
    endCall(true);
  }
}

function endCall(notifyPeer = true) {
  const call = state.call;
  if (!call) {
    callUI(false);
    return;
  }
  if (notifyPeer) wsSend({ type: 'call', action: 'hangup', to: call.peerId });
  if (call.pc) call.pc.close();
  if (call.stream) call.stream.getTracks().forEach((t) => t.stop());
  $('local-video').srcObject = null;
  $('remote-video').srcObject = null;
  state.call = null;
  callUI(false);
}

// ---------- Уведомления ----------

function notify(chat, m) {
  if (chat.muted || document.hasFocus() || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const n = new Notification(chat.title, {
    body: (chat.type !== 'direct' ? m.senderName + ': ' : '') + previewText(m),
  });
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
  renderMenuMe();
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
  $('profile-btn').onclick = openProfileModal;
  $('new-group-btn').onclick = () => openGroupModal('group');
  $('new-channel-btn').onclick = () => openGroupModal('channel');
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
    if (e.key === 'Escape') {
      cancelEdit();
      cancelReply();
    }
  };
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    sendTyping();
  };
  $('send-btn').onclick = sendMessage;
  $('edit-cancel').onclick = cancelEdit;
  $('reply-cancel').onclick = cancelReply;

  $('attach-btn').onclick = () => $('file-input').click();
  $('file-input').onchange = async (e) => {
    for (const file of e.target.files) await sendFileMessage(file);
    e.target.value = '';
  };
  $('voice-btn').onclick = toggleVoiceRecording;

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

  // Группы/каналы
  $('group-cancel').onclick = () => $('group-modal').classList.add('hidden');
  $('group-create').onclick = createGroup;
  $('group-search').oninput = (e) => {
    clearTimeout(groupSearchTimer);
    const q = e.target.value.trim();
    groupSearchTimer = setTimeout(() => groupSearch(q).catch(() => {}), 300);
  };

  // Пересылка
  $('forward-cancel').onclick = () => $('forward-modal').classList.add('hidden');

  // Информация о чате
  $('info-btn').onclick = () => {
    $('info-panel').classList.toggle('hidden');
    renderInfoPanel();
  };
  $('chat-header-main').onclick = () => {
    $('info-panel').classList.remove('hidden');
    renderInfoPanel();
  };
  $('info-close').onclick = closeInfoPanel;
  $('mute-toggle').onchange = async (e) => {
    const chat = chatById(state.activeChatId);
    if (!chat) return;
    await api('POST', `/api/chats/${chat.id}/mute`, { muted: e.target.checked }).catch(() => {});
    chat.muted = e.target.checked;
    renderChatList();
  };
  $('leave-chat-btn').onclick = async () => {
    const chat = chatById(state.activeChatId);
    if (!chat || !confirm('Покинуть чат?')) return;
    try {
      await api('DELETE', `/api/chats/${chat.id}/members/${state.me.id}`);
      state.chats = state.chats.filter((c) => c.id !== chat.id);
      state.activeChatId = null;
      $('chat-view').classList.add('hidden');
      $('empty-state').classList.remove('hidden');
      closeInfoPanel();
      renderChatList();
    } catch (err) { alert(err.message); }
  };
  $('add-member-btn').onclick = () => {
    $('add-member-search').value = '';
    $('add-member-results').innerHTML = '';
    $('add-member-modal').classList.remove('hidden');
    $('add-member-search').focus();
  };
  $('add-member-cancel').onclick = () => $('add-member-modal').classList.add('hidden');
  $('add-member-search').oninput = (e) => {
    clearTimeout(addMemberTimer);
    const q = e.target.value.trim();
    addMemberTimer = setTimeout(() => addMemberSearch(q).catch(() => {}), 300);
  };

  // Редактирование чата
  $('edit-chat-btn').onclick = () => {
    const chat = chatById(state.activeChatId);
    if (!chat) return;
    $('edit-chat-title').value = chat.title;
    $('edit-chat-description').value = chat.description || '';
    $('edit-chat-modal').classList.remove('hidden');
  };
  $('edit-chat-cancel').onclick = () => $('edit-chat-modal').classList.add('hidden');
  $('edit-chat-save').onclick = async () => {
    const chat = chatById(state.activeChatId);
    try {
      await api('PUT', `/api/chats/${chat.id}`, {
        title: $('edit-chat-title').value.trim(),
        description: $('edit-chat-description').value.trim(),
      });
      $('edit-chat-modal').classList.add('hidden');
      await refreshChats();
      renderInfoPanel();
    } catch (err) { alert(err.message); }
  };
  $('chat-avatar-btn').onclick = () => $('chat-avatar-input').click();
  $('chat-avatar-input').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const chat = chatById(state.activeChatId);
    try {
      const uploaded = await uploadFile(file);
      await api('PUT', `/api/chats/${chat.id}`, { avatarFileId: uploaded.id });
      await refreshChats();
      renderInfoPanel();
    } catch (err) { alert(err.message); }
  };

  // Профиль
  $('profile-cancel').onclick = () => $('profile-modal').classList.add('hidden');
  $('profile-save').onclick = saveProfile;
  $('profile-avatar-btn').onclick = () => $('profile-avatar-input').click();
  $('profile-avatar-input').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadFile(file);
      profileAvatarFileId = uploaded.id;
      $('profile-avatar').innerHTML =
        avatarHtml(state.me.name, state.me.id, '', false, uploaded.url);
    } catch (err) { alert(err.message); }
  };

  // Закреплённые
  $('unpin-btn').onclick = async () => {
    await api('POST', `/api/chats/${state.activeChatId}/pin`, { messageId: null }).catch(() => {});
    await refreshChats();
    renderPinnedBar();
  };

  // Звонки
  $('call-audio-btn').onclick = () => startCall(false);
  $('call-video-btn').onclick = () => startCall(true);
  $('call-accept').onclick = acceptCall;
  $('call-hangup').onclick = () => endCall(true);

  // Лайтбокс
  $('lightbox').onclick = () => $('lightbox').classList.add('hidden');

  // Перетаскивание файлов в чат
  const messagesEl = $('messages');
  messagesEl.ondragover = (e) => e.preventDefault();
  messagesEl.ondrop = async (e) => {
    e.preventDefault();
    const chat = chatById(state.activeChatId);
    if (!chat || !canPost(chat)) return;
    for (const file of e.dataTransfer.files) await sendFileMessage(file);
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

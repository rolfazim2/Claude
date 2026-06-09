'use strict';

// REST API. Маршрутизация без фреймворков: метод + шаблон пути.

const auth = require('./auth');
const hub = require('./hub');
const { users, chats, messages } = require('./db');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    lastSeen: Number(u.last_seen || 0),
    online: hub.isOnline(Number(u.id)),
  };
}

function publicMessage(m) {
  return {
    id: Number(m.id),
    chatId: Number(m.chat_id),
    senderId: Number(m.sender_id),
    senderName: m.sender_name,
    senderUsername: m.sender_username,
    text: m.deleted ? '' : m.text,
    createdAt: Number(m.created_at),
    editedAt: m.edited_at ? Number(m.edited_at) : null,
    deleted: !!m.deleted,
  };
}

function chatView(chat, forUserId) {
  const members = chats.members(chat.id).map(publicUser);
  let title = chat.title;
  let peer = null;
  if (chat.type === 'direct') {
    peer = members.find((m) => m.id !== forUserId) || members[0];
    title = peer ? peer.name : 'Удалённый аккаунт';
  }
  const last = messages.last(chat.id);
  return {
    id: Number(chat.id),
    type: chat.type,
    title,
    peer,
    members,
    unread: Number(chat.unread || 0),
    lastMessage: last ? publicMessage(last) : null,
    readByOthersUpTo: chats.readByOthersUpTo(chat.id, forUserId),
  };
}

const routes = [];
const route = (method, pattern, handler) => {
  // pattern вида '/api/chats/:id/messages' -> регулярное выражение с группами
  const names = [];
  const re = new RegExp(
    '^' + pattern.replace(/:[a-zA-Z]+/g, (m) => {
      names.push(m.slice(1));
      return '([^/]+)';
    }) + '$'
  );
  routes.push({ method, re, names, handler });
};

function requireAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = auth.verify(token);
  if (!payload) throw new ApiError(401, 'Требуется авторизация');
  const user = users.byId(payload.uid);
  if (!user) throw new ApiError(401, 'Пользователь не найден');
  return Number(user.id);
}

// ---- Аккаунт ----

route('POST', '/api/register', (req) => {
  const { username, name, password } = req.body || {};
  if (!USERNAME_RE.test(String(username || ''))) {
    throw new ApiError(400, 'Логин: 3–32 символа, латиница, цифры и _');
  }
  if (!name || String(name).trim().length < 1 || String(name).length > 64) {
    throw new ApiError(400, 'Укажите имя (до 64 символов)');
  }
  if (!password || String(password).length < 6) {
    throw new ApiError(400, 'Пароль должен быть не короче 6 символов');
  }
  if (users.byUsername(username)) {
    throw new ApiError(409, 'Этот логин уже занят');
  }
  users.create(username, String(name).trim(), auth.hashPassword(String(password)));
  const user = users.byUsername(username);
  return { token: auth.sign({ uid: Number(user.id) }), user: publicUser(user) };
});

route('POST', '/api/login', (req) => {
  const { username, password } = req.body || {};
  const user = users.byUsername(String(username || ''));
  if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
    throw new ApiError(401, 'Неверный логин или пароль');
  }
  return { token: auth.sign({ uid: Number(user.id) }), user: publicUser(user) };
});

route('GET', '/api/me', (req) => {
  const uid = requireAuth(req);
  return { user: publicUser(users.byId(uid)) };
});

route('GET', '/api/users', (req) => {
  const uid = requireAuth(req);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return { users: [] };
  return { users: users.search(q, uid).map(publicUser) };
});

// ---- Чаты ----

route('GET', '/api/chats', (req) => {
  const uid = requireAuth(req);
  const list = chats.listForUser(uid)
    .map((c) => chatView(c, uid))
    .sort((a, b) => {
      const ta = a.lastMessage ? a.lastMessage.createdAt : 0;
      const tb = b.lastMessage ? b.lastMessage.createdAt : 0;
      return tb - ta;
    });
  return { chats: list };
});

route('POST', '/api/chats', (req) => {
  const uid = requireAuth(req);
  const { type, memberIds, title } = req.body || {};
  const ids = [...new Set((memberIds || []).map(Number).filter((n) => n > 0 && n !== uid))];
  for (const id of ids) {
    if (!users.byId(id)) throw new ApiError(400, `Пользователь ${id} не найден`);
  }

  if (type === 'direct') {
    if (ids.length !== 1) throw new ApiError(400, 'Личный чат — ровно один собеседник');
    const existing = chats.findDirect(uid, ids[0]);
    if (existing) {
      const chat = chats.byId(existing.id);
      return { chat: chatView(chat, uid), existing: true };
    }
    const chatId = chats.create('direct', null, uid);
    chats.addMember(chatId, uid);
    chats.addMember(chatId, ids[0]);
    const view = chatView(chats.byId(chatId), uid);
    hub.sendTo(ids[0], { type: 'chat', chat: chatView(chats.byId(chatId), ids[0]) });
    return { chat: view };
  }

  if (type === 'group') {
    const t = String(title || '').trim();
    if (!t || t.length > 64) throw new ApiError(400, 'Укажите название группы (до 64 символов)');
    if (ids.length < 1) throw new ApiError(400, 'Добавьте хотя бы одного участника');
    const chatId = chats.create('group', t, uid);
    chats.addMember(chatId, uid);
    for (const id of ids) chats.addMember(chatId, id);
    for (const id of ids) {
      hub.sendTo(id, { type: 'chat', chat: chatView(chats.byId(chatId), id) });
    }
    return { chat: chatView(chats.byId(chatId), uid) };
  }

  throw new ApiError(400, 'Неизвестный тип чата');
});

route('GET', '/api/chats/:id/messages', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  if (!chats.isMember(chatId, uid)) throw new ApiError(403, 'Нет доступа к чату');
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  return { messages: messages.list(chatId, before, limit).map(publicMessage) };
});

route('POST', '/api/chats/:id/messages', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  if (!chats.isMember(chatId, uid)) throw new ApiError(403, 'Нет доступа к чату');
  const text = String((req.body || {}).text || '').trim();
  if (!text || text.length > 4096) throw new ApiError(400, 'Текст сообщения: 1–4096 символов');
  const message = messages.create(chatId, uid, text);
  hub.broadcastToChat(chatId, { type: 'message', message: publicMessage(message) }, uid);
  return { message: publicMessage(message) };
});

route('POST', '/api/chats/:id/read', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  if (!chats.isMember(chatId, uid)) throw new ApiError(403, 'Нет доступа к чату');
  const messageId = Number((req.body || {}).messageId);
  if (!messageId) throw new ApiError(400, 'Не указан messageId');
  chats.setLastRead(chatId, uid, messageId);
  hub.broadcastToChat(chatId, { type: 'read', chatId, userId: uid, messageId }, uid);
  return { ok: true };
});

// ---- Сообщения ----

route('PUT', '/api/messages/:id', (req, params) => {
  const uid = requireAuth(req);
  const m = messages.byId(Number(params.id));
  if (!m || m.deleted) throw new ApiError(404, 'Сообщение не найдено');
  if (Number(m.sender_id) !== uid) throw new ApiError(403, 'Можно править только свои сообщения');
  const text = String((req.body || {}).text || '').trim();
  if (!text || text.length > 4096) throw new ApiError(400, 'Текст сообщения: 1–4096 символов');
  messages.edit(m.id, text);
  const updated = publicMessage(messages.byId(m.id));
  hub.broadcastToChat(Number(m.chat_id), { type: 'message_edited', message: updated });
  return { message: updated };
});

route('DELETE', '/api/messages/:id', (req, params) => {
  const uid = requireAuth(req);
  const m = messages.byId(Number(params.id));
  if (!m || m.deleted) throw new ApiError(404, 'Сообщение не найдено');
  if (Number(m.sender_id) !== uid) throw new ApiError(403, 'Можно удалять только свои сообщения');
  messages.remove(m.id);
  hub.broadcastToChat(Number(m.chat_id), {
    type: 'message_deleted', chatId: Number(m.chat_id), messageId: Number(m.id),
  });
  return { ok: true };
});

function dispatch(req) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.re.exec(req.pathname);
    if (!match) continue;
    const params = {};
    r.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
    return r.handler(req, params);
  }
  throw new ApiError(404, 'Не найдено');
}

module.exports = { dispatch, ApiError };

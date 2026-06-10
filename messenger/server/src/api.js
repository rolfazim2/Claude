'use strict';

// REST API. Маршрутизация без фреймворков: метод + шаблон пути.

const auth = require('./auth');
const hub = require('./hub');
const { users, files, chats, messages, reactions } = require('./db');
const { publicUser, publicMessage, chatView } = require('./format');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const MSG_KINDS = ['text', 'image', 'video', 'voice', 'file'];

// Право публиковать: в каналах пишут только владелец и админы
function canPost(chat, membership) {
  if (chat.type !== 'channel') return true;
  return membership && (membership.role === 'owner' || membership.role === 'admin');
}

function isAdmin(membership) {
  return membership && (membership.role === 'owner' || membership.role === 'admin');
}

function pushChatUpdate(chatId, exceptUserId = null) {
  const chat = chats.byId(chatId);
  for (const uid of chats.memberIds(chatId)) {
    if (uid !== exceptUserId) {
      hub.sendTo(uid, { type: 'chat_updated', chat: chatView(chat, uid) });
    }
  }
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

function requireMembership(chatId, uid) {
  const chat = chats.byId(chatId);
  if (!chat) throw new ApiError(404, 'Чат не найден');
  const membership = chats.member(chatId, uid);
  if (!membership) throw new ApiError(403, 'Нет доступа к чату');
  return { chat, membership };
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

route('PUT', '/api/me', (req) => {
  const uid = requireAuth(req);
  const current = users.byId(uid);
  const { name, bio, avatarFileId } = req.body || {};
  const newName = String(name ?? current.name).trim();
  if (!newName || newName.length > 64) throw new ApiError(400, 'Имя: 1–64 символа');
  const newBio = String(bio ?? current.bio ?? '').slice(0, 256);
  let avatar = current.avatar_file;
  if (avatarFileId !== undefined) {
    if (avatarFileId === null) avatar = null;
    else {
      const f = files.byId(Number(avatarFileId));
      if (!f) throw new ApiError(400, 'Файл аватара не найден');
      avatar = Number(avatarFileId);
    }
  }
  users.update(uid, { name: newName, bio: newBio, avatarFile: avatar });
  return { user: publicUser(users.byId(uid)) };
});

route('GET', '/api/users', (req) => {
  const uid = requireAuth(req);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return { users: [] };
  return { users: users.search(q, uid).map(publicUser) };
});

// ---- Поиск по сообщениям ----

route('GET', '/api/search', (req) => {
  const uid = requireAuth(req);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return { messages: [] };
  return { messages: messages.search(uid, q).map(publicMessage) };
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
  const { type, memberIds, title, description } = req.body || {};
  const ids = [...new Set((memberIds || []).map(Number).filter((n) => n > 0 && n !== uid))];
  for (const id of ids) {
    if (!users.byId(id)) throw new ApiError(400, `Пользователь ${id} не найден`);
  }

  if (type === 'direct') {
    if (ids.length !== 1) throw new ApiError(400, 'Личный чат — ровно один собеседник');
    const existing = chats.findDirect(uid, ids[0]);
    if (existing) {
      return { chat: chatView(chats.byId(existing.id), uid), existing: true };
    }
    const chatId = chats.create('direct', null, uid);
    chats.addMember(chatId, uid);
    chats.addMember(chatId, ids[0]);
    hub.sendTo(ids[0], { type: 'chat', chat: chatView(chats.byId(chatId), ids[0]) });
    return { chat: chatView(chats.byId(chatId), uid) };
  }

  if (type === 'group' || type === 'channel') {
    const t = String(title || '').trim();
    if (!t || t.length > 64) throw new ApiError(400, 'Укажите название (до 64 символов)');
    if (type === 'group' && ids.length < 1) {
      throw new ApiError(400, 'Добавьте хотя бы одного участника');
    }
    const chatId = chats.create(type, t, uid);
    if (description) {
      chats.update(chatId, {
        title: t, description: String(description).slice(0, 512), avatarFile: null,
      });
    }
    chats.addMember(chatId, uid, 'owner');
    for (const id of ids) chats.addMember(chatId, id);
    for (const id of ids) {
      hub.sendTo(id, { type: 'chat', chat: chatView(chats.byId(chatId), id) });
    }
    return { chat: chatView(chats.byId(chatId), uid) };
  }

  throw new ApiError(400, 'Неизвестный тип чата');
});

route('PUT', '/api/chats/:id', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  const { chat, membership } = requireMembership(chatId, uid);
  if (chat.type === 'direct') throw new ApiError(400, 'Личный чат нельзя редактировать');
  if (!isAdmin(membership)) throw new ApiError(403, 'Только администратор может менять чат');
  const { title, description, avatarFileId } = req.body || {};
  const newTitle = String(title ?? chat.title).trim();
  if (!newTitle || newTitle.length > 64) throw new ApiError(400, 'Название: 1–64 символа');
  let avatar = chat.avatar_file;
  if (avatarFileId !== undefined) {
    avatar = avatarFileId === null ? null : Number(avatarFileId);
    if (avatar && !files.byId(avatar)) throw new ApiError(400, 'Файл не найден');
  }
  chats.update(chatId, {
    title: newTitle,
    description: String(description ?? chat.description ?? '').slice(0, 512),
    avatarFile: avatar,
  });
  pushChatUpdate(chatId);
  return { chat: chatView(chats.byId(chatId), uid) };
});

// ---- Участники ----

route('POST', '/api/chats/:id/members', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  const { chat } = requireMembership(chatId, uid);
  if (chat.type === 'direct') throw new ApiError(400, 'В личный чат нельзя добавлять участников');
  const ids = [...new Set(((req.body || {}).userIds || []).map(Number))];
  for (const id of ids) {
    if (!users.byId(id)) throw new ApiError(400, `Пользователь ${id} не найден`);
  }
  for (const id of ids) {
    chats.addMember(chatId, id);
    hub.sendTo(id, { type: 'chat', chat: chatView(chats.byId(chatId), id) });
  }
  pushChatUpdate(chatId);
  return { chat: chatView(chats.byId(chatId), uid) };
});

route('DELETE', '/api/chats/:id/members/:userId', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  const targetId = Number(params.userId);
  const { chat, membership } = requireMembership(chatId, uid);
  if (chat.type === 'direct') throw new ApiError(400, 'Из личного чата нельзя удалять');
  if (targetId !== uid && !isAdmin(membership)) {
    throw new ApiError(403, 'Удалять участников может только администратор');
  }
  const target = chats.member(chatId, targetId);
  if (!target) throw new ApiError(404, 'Участник не найден');
  if (target.role === 'owner') throw new ApiError(403, 'Владельца нельзя удалить');
  chats.removeMember(chatId, targetId);
  hub.sendTo(targetId, { type: 'chat_removed', chatId });
  pushChatUpdate(chatId);
  return { ok: true };
});

route('POST', '/api/chats/:id/admins', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  const { membership } = requireMembership(chatId, uid);
  if (membership.role !== 'owner') throw new ApiError(403, 'Назначать админов может только владелец');
  const targetId = Number((req.body || {}).userId);
  const makeAdmin = !!(req.body || {}).admin;
  const target = chats.member(chatId, targetId);
  if (!target) throw new ApiError(404, 'Участник не найден');
  if (target.role === 'owner') throw new ApiError(400, 'Владелец уже имеет все права');
  chats.setRole(chatId, targetId, makeAdmin ? 'admin' : 'member');
  pushChatUpdate(chatId);
  return { ok: true };
});

route('POST', '/api/chats/:id/mute', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  requireMembership(chatId, uid);
  const muted = !!(req.body || {}).muted;
  chats.setMuted(chatId, uid, muted);
  return { ok: true, muted };
});

// ---- Закреплённые сообщения ----

route('POST', '/api/chats/:id/pin', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  const { chat, membership } = requireMembership(chatId, uid);
  if (chat.type !== 'direct' && !isAdmin(membership)) {
    throw new ApiError(403, 'Закреплять может только администратор');
  }
  const messageId = (req.body || {}).messageId;
  if (messageId !== null) {
    const m = messages.byId(Number(messageId));
    if (!m || Number(m.chat_id) !== chatId || m.deleted) {
      throw new ApiError(404, 'Сообщение не найдено');
    }
  }
  chats.setPinned(chatId, messageId === null ? null : Number(messageId));
  pushChatUpdate(chatId);
  return { ok: true };
});

// ---- Сообщения ----

route('GET', '/api/chats/:id/messages', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  requireMembership(chatId, uid);
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  return { messages: messages.list(chatId, before, limit).map(publicMessage) };
});

function validateNewMessage(body, chat, membership, uid) {
  if (!canPost(chat, membership)) {
    throw new ApiError(403, 'В этом канале публикуют только администраторы');
  }
  const kind = MSG_KINDS.includes(body.kind) ? body.kind : 'text';
  const text = String(body.text || '').trim();
  let fileId = null;
  if (kind !== 'text') {
    const f = files.byId(Number(body.fileId));
    if (!f) throw new ApiError(400, 'Файл не найден');
    fileId = Number(body.fileId);
  } else if (!text) {
    throw new ApiError(400, 'Пустое сообщение');
  }
  if (text.length > 4096) throw new ApiError(400, 'Текст сообщения: до 4096 символов');
  let replyTo = null;
  if (body.replyTo) {
    const r = messages.byId(Number(body.replyTo));
    if (r && Number(r.chat_id) === Number(chat.id)) replyTo = Number(body.replyTo);
  }
  const forwardFrom = body.forwardFrom ? String(body.forwardFrom).slice(0, 64) : null;
  return { kind, text, fileId, replyTo, forwardFrom };
}

route('POST', '/api/chats/:id/messages', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  const { chat, membership } = requireMembership(chatId, uid);
  const data = validateNewMessage(req.body || {}, chat, membership, uid);
  const message = publicMessage(messages.create(chatId, uid, data));
  hub.broadcastToChat(chatId, { type: 'message', message }, uid);
  require('./bots').onNewMessage(message);
  return { message };
});

// Пересылка сообщения в другой чат
route('POST', '/api/messages/:id/forward', (req, params) => {
  const uid = requireAuth(req);
  const m = messages.byId(Number(params.id));
  if (!m || m.deleted) throw new ApiError(404, 'Сообщение не найдено');
  requireMembership(Number(m.chat_id), uid);
  const targetChatId = Number((req.body || {}).chatId);
  const { chat, membership } = requireMembership(targetChatId, uid);
  if (!canPost(chat, membership)) {
    throw new ApiError(403, 'В этом канале публикуют только администраторы');
  }
  const message = publicMessage(messages.create(targetChatId, uid, {
    kind: m.kind,
    text: m.text,
    fileId: m.file_id ? Number(m.file_id) : null,
    forwardFrom: m.sender_name,
  }));
  hub.broadcastToChat(targetChatId, { type: 'message', message }, uid);
  require('./bots').onNewMessage(message);
  return { message };
});

// Реакции: повторная отправка той же реакции снимает её
route('POST', '/api/messages/:id/reactions', (req, params) => {
  const uid = requireAuth(req);
  const m = messages.byId(Number(params.id));
  if (!m || m.deleted) throw new ApiError(404, 'Сообщение не найдено');
  requireMembership(Number(m.chat_id), uid);
  const emoji = String((req.body || {}).emoji || '').slice(0, 8);
  if (!emoji) throw new ApiError(400, 'Не указана реакция');
  reactions.toggle(Number(m.id), uid, emoji);
  const updated = publicMessage(messages.byId(m.id));
  hub.broadcastToChat(Number(m.chat_id), { type: 'message_edited', message: updated });
  return { message: updated };
});

route('POST', '/api/chats/:id/read', (req, params) => {
  const uid = requireAuth(req);
  const chatId = Number(params.id);
  requireMembership(chatId, uid);
  const messageId = Number((req.body || {}).messageId);
  if (!messageId) throw new ApiError(400, 'Не указан messageId');
  chats.setLastRead(chatId, uid, messageId);
  hub.broadcastToChat(chatId, { type: 'read', chatId, userId: uid, messageId }, uid);
  return { ok: true };
});

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
  const { chat, membership } = requireMembership(Number(m.chat_id), uid);
  const own = Number(m.sender_id) === uid;
  if (!own && !(chat.type !== 'direct' && isAdmin(membership))) {
    throw new ApiError(403, 'Можно удалять только свои сообщения');
  }
  messages.remove(m.id);
  if (Number(chat.pinned_message_id || 0) === Number(m.id)) {
    chats.setPinned(Number(m.chat_id), null);
    pushChatUpdate(Number(m.chat_id));
  }
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

module.exports = { dispatch, route, requireAuth, requireMembership, canPost, ApiError };

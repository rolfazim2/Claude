'use strict';

// REST-маршруты платформы ботов:
// /api/bots/* — управление своими ботами (авторизация пользователя),
// /api/bot/*  — Bot API для внешних программ (заголовок Authorization: Bot <token>).

const { route, requireAuth, requireMembership, canPost, ApiError } = require('./api');
const { users, chats, messages, bots } = require('./db');
const { publicUser, publicMessage } = require('./format');
const botsCore = require('./bots');
const hub = require('./hub');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function botView(b) {
  return {
    userId: Number(b.user_id),
    username: b.username,
    name: b.name,
    token: b.token,
    webhookUrl: b.webhook_url || null,
  };
}

function requireBotToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bot ') ? header.slice(4) : null;
  const bot = token ? bots.byToken(token) : null;
  if (!bot) throw new ApiError(401, 'Неверный токен бота');
  return Number(bot.user_id);
}

// ---- Управление ботами (от имени владельца) ----

route('GET', '/api/bots', (req) => {
  const uid = requireAuth(req);
  return { bots: bots.listByOwner(uid).map(botView) };
});

route('POST', '/api/bots', (req) => {
  const uid = requireAuth(req);
  const { username, name } = req.body || {};
  if (!USERNAME_RE.test(String(username || '')) || !String(username).toLowerCase().endsWith('bot')) {
    throw new ApiError(400, 'Логин бота: 3–32 символа (латиница, цифры, _) и оканчивается на "bot"');
  }
  if (!name || String(name).trim().length < 1 || String(name).length > 64) {
    throw new ApiError(400, 'Укажите имя бота (до 64 символов)');
  }
  if (users.byUsername(username)) throw new ApiError(409, 'Этот логин уже занят');

  users.create(username, String(name).trim(), 'x:bot', 1);
  const user = users.byUsername(username);
  const userId = Number(user.id);
  bots.create(userId, uid, botsCore.newToken(userId));
  const created = bots.listByOwner(uid).find((b) => Number(b.user_id) === userId);
  return { bot: botView(created) };
});

route('POST', '/api/bots/:id/webhook', (req, params) => {
  const uid = requireAuth(req);
  const bot = bots.byUserId(Number(params.id));
  if (!bot || Number(bot.owner_id) !== uid) throw new ApiError(404, 'Бот не найден');
  const url = (req.body || {}).url;
  if (url !== null) {
    try {
      const parsed = new URL(String(url));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new ApiError(400, 'Некорректный URL вебхука');
    }
  }
  bots.setWebhook(Number(params.id), url === null ? null : String(url));
  return { ok: true };
});

route('DELETE', '/api/bots/:id', (req, params) => {
  const uid = requireAuth(req);
  const bot = bots.byUserId(Number(params.id));
  if (!bot || Number(bot.owner_id) !== uid) throw new ApiError(404, 'Бот не найден');
  if (bot.builtin) throw new ApiError(400, 'Встроенного бота нельзя удалить');
  bots.remove(Number(params.id));
  return { ok: true };
});

// Узнать аккаунт встроенного AI-бота (для кнопки «Gram AI» в меню)
route('GET', '/api/ai-bot', (req) => {
  requireAuth(req);
  const id = botsCore.aiBotUserId();
  if (!id) throw new ApiError(404, 'AI-бот не настроен');
  return { user: publicUser(users.byId(id)) };
});

// ---- Bot API (для внешних программ с токеном) ----

route('GET', '/api/bot/me', (req) => {
  const botId = requireBotToken(req);
  return { user: publicUser(users.byId(botId)) };
});

route('GET', '/api/bot/updates', (req) => {
  const botId = requireBotToken(req);
  const offset = Number(req.query.offset) || 0;
  return { updates: botsCore.getUpdates(botId, offset) };
});

route('POST', '/api/bot/messages', (req) => {
  const botId = requireBotToken(req);
  const chatId = Number((req.body || {}).chatId);
  const { chat, membership } = requireMembership(chatId, botId);
  if (!canPost(chat, membership)) {
    throw new ApiError(403, 'В этом канале публикуют только администраторы');
  }
  const text = String((req.body || {}).text || '').trim();
  if (!text || text.length > 4096) throw new ApiError(400, 'Текст сообщения: 1–4096 символов');
  const message = publicMessage(messages.create(chatId, botId, { text }));
  hub.broadcastToChat(chatId, { type: 'message', message });
  return { message };
});

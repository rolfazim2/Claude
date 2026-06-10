'use strict';

// Платформа ботов: встроенный AI-ассистент (@gram_ai), пользовательские боты
// с токенами, очередью обновлений (getUpdates) и вебхуками.

const crypto = require('node:crypto');
const hub = require('./hub');
const ai = require('./ai');
const { users, chats, messages, bots } = require('./db');
const { publicMessage } = require('./format');

const AI_USERNAME = 'gram_ai';

// Очереди обновлений для внешних ботов: botUserId -> [{updateId, message}]
const updateQueues = new Map();
let nextUpdateId = 1;

function ensureBuiltinBots() {
  if (!bots.byBuiltin('ai')) {
    if (!users.byUsername(AI_USERNAME)) {
      // Пароль-заглушка: вход под аккаунтом бота невозможен
      users.create(AI_USERNAME, 'Gram AI', 'x:bot', 1);
    }
    const user = users.byUsername(AI_USERNAME);
    bots.create(Number(user.id), null, 'builtin:' + crypto.randomBytes(24).toString('hex'), 'ai');
  }
  const aiUser = users.byUsername(AI_USERNAME);
  if (aiUser) {
    users.update(Number(aiUser.id), {
      name: 'Gram AI',
      bio: ai.isConfigured()
        ? `AI-ассистент на базе Claude (${ai.MODEL}). Пишите в личку или упоминайте @${AI_USERNAME} в группах.`
        : 'AI-ассистент. Требуется настройка ANTHROPIC_API_KEY на сервере.',
      avatarFile: aiUser.avatar_file,
    });
  }
  return Number(users.byUsername(AI_USERNAME).id);
}

function aiBotUserId() {
  const u = users.byUsername(AI_USERNAME);
  return u ? Number(u.id) : null;
}

function queueUpdate(botUserId, message) {
  if (!updateQueues.has(botUserId)) updateQueues.set(botUserId, []);
  const queue = updateQueues.get(botUserId);
  queue.push({ updateId: nextUpdateId++, message });
  if (queue.length > 500) queue.splice(0, queue.length - 500);
}

function getUpdates(botUserId, offset) {
  const queue = updateQueues.get(botUserId) || [];
  return queue.filter((u) => u.updateId > offset);
}

function postWebhook(url, payload) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* бот недоступен — обновление останется в очереди getUpdates */ });
}

function sendBotMessage(botUserId, chatId, text) {
  const message = publicMessage(messages.create(chatId, botUserId, { text }));
  hub.broadcastToChat(chatId, { type: 'message', message });
  return message;
}

// Контекст для AI: последние сообщения чата в формате истории диалога
function buildAiHistory(chatId, botUserId) {
  return messages.list(chatId, Number.MAX_SAFE_INTEGER, 24)
    .filter((m) => !m.deleted && m.text)
    .map((m) => ({
      senderName: m.sender_name,
      isBot: Number(m.sender_id) === botUserId,
      text: String(m.text).slice(0, 4000),
    }));
}

async function maybeAiReply(chat, msg, botUserId) {
  const mentioned = msg.text && msg.text.toLowerCase().includes('@' + AI_USERNAME);
  if (chat.type !== 'direct' && !mentioned) return;
  if (msg.kind !== 'text' || !msg.text) return;

  // Показываем «печатает…», пока модель думает
  hub.broadcastToChat(Number(chat.id), {
    type: 'typing', chatId: Number(chat.id), userId: botUserId,
  });
  const keepTyping = setInterval(() => {
    hub.broadcastToChat(Number(chat.id), {
      type: 'typing', chatId: Number(chat.id), userId: botUserId,
    });
  }, 3500);

  try {
    const text = await ai.reply(buildAiHistory(Number(chat.id), botUserId));
    // Длинные ответы режем на сообщения по 3500 символов
    for (let i = 0; i < text.length; i += 3500) {
      sendBotMessage(botUserId, Number(chat.id), text.slice(i, i + 3500));
    }
  } catch (err) {
    console.error('AI bot error:', err.message);
    sendBotMessage(botUserId, Number(chat.id),
      'Не удалось получить ответ от Claude API: ' + err.message);
  } finally {
    clearInterval(keepTyping);
  }
}

// Вызывается после создания любого сообщения (REST и WebSocket)
function onNewMessage(msg) {
  setImmediate(() => {
    try {
      const chat = chats.byId(msg.chatId);
      if (!chat) return;
      const senderIsBot = !!(users.byId(msg.senderId) || {}).is_bot;

      for (const member of chats.members(msg.chatId)) {
        const memberId = Number(member.id);
        if (!member.is_bot || memberId === msg.senderId) continue;
        const bot = bots.byUserId(memberId);
        if (!bot) continue;

        if (bot.builtin === 'ai') {
          if (!senderIsBot) maybeAiReply(chat, msg, memberId);
          continue;
        }
        // Внешние боты: очередь getUpdates + вебхук
        queueUpdate(memberId, msg);
        if (bot.webhook_url) {
          postWebhook(bot.webhook_url, { type: 'message', message: msg });
        }
      }
    } catch (err) {
      console.error('Bot dispatch error:', err.message);
    }
  });
}

const newToken = (userId) => `${userId}:${crypto.randomBytes(24).toString('hex')}`;

module.exports = {
  ensureBuiltinBots, aiBotUserId, onNewMessage,
  getUpdates, sendBotMessage, newToken, AI_USERNAME,
};

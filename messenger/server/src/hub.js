'use strict';

// Реестр WebSocket-подключений: рассылка событий участникам чатов,
// статусы «в сети» и индикатор набора текста.

const { WebSocketServer } = require('ws');
const auth = require('./auth');
const { users, chats, messages } = require('./db');

const sockets = new Map(); // userId -> Set<WebSocket>

const isOnline = (userId) => sockets.has(userId);

function sendTo(userId, event) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastToChat(chatId, event, exceptUserId = null) {
  for (const uid of chats.memberIds(chatId)) {
    if (uid !== exceptUserId) sendTo(uid, event);
  }
}

// Сообщаем всем собеседникам пользователя о смене его статуса
function broadcastPresence(userId, online) {
  const seen = new Set();
  for (const { id: chatId } of chats.listForUser(userId)) {
    for (const uid of chats.memberIds(chatId)) {
      if (uid !== userId && !seen.has(uid)) {
        seen.add(uid);
        sendTo(uid, { type: 'presence', userId, online, lastSeen: Date.now() });
      }
    }
  }
}

function handleClientEvent(userId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const chatId = Number(msg.chatId);

  if (msg.type === 'typing') {
    if (!chats.isMember(chatId, userId)) return;
    broadcastToChat(chatId, { type: 'typing', chatId, userId }, userId);
    return;
  }

  if (msg.type === 'message') {
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text || text.length > 4096 || !chats.isMember(chatId, userId)) return;
    const message = messages.create(chatId, userId, text);
    broadcastToChat(chatId, { type: 'message', message });
    // Подтверждение отправителю: связываем с временным id на клиенте
    if (msg.tempId) sendTo(userId, { type: 'ack', tempId: msg.tempId, message });
    return;
  }

  if (msg.type === 'read') {
    const messageId = Number(msg.messageId);
    if (!messageId || !chats.isMember(chatId, userId)) return;
    chats.setLastRead(chatId, userId, messageId);
    broadcastToChat(chatId, { type: 'read', chatId, userId, messageId }, userId);
  }
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const payload = auth.verify(url.searchParams.get('token'));
    if (!payload) {
      ws.close(4401, 'unauthorized');
      return;
    }
    const userId = payload.uid;

    const firstSocket = !sockets.has(userId);
    if (firstSocket) sockets.set(userId, new Set());
    sockets.get(userId).add(ws);
    users.touch(userId);
    if (firstSocket) broadcastPresence(userId, true);

    ws.on('message', (raw) => handleClientEvent(userId, raw));

    ws.on('close', () => {
      const set = sockets.get(userId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) {
        sockets.delete(userId);
        users.touch(userId);
        broadcastPresence(userId, false);
      }
    });

    ws.send(JSON.stringify({ type: 'hello', userId }));
  });

  // Heartbeat: закрываем зависшие соединения
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  interval.unref(); // не удерживаем процесс ради heartbeat
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });
  wss.on('close', () => clearInterval(interval));

  return wss;
}

module.exports = { attach, sendTo, broadcastToChat, isOnline };

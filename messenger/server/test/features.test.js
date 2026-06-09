'use strict';

process.env.GRAM_DB = ':memory:';
process.env.GRAM_SECRET = 'test-secret';
process.env.GRAM_DATA_DIR = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'gram-test-')
);

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');

const { server } = require('../src/index');

let base;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const ctx = {};

test('подготовка пользователей', async () => {
  for (const [key, username, name] of [
    ['alice', 'alice', 'Алиса'], ['bob', 'bob', 'Боб'], ['eve', 'eve', 'Ева'],
  ]) {
    const r = await call('POST', '/api/register', { username, name, password: 'secret123' });
    assert.equal(r.status, 200);
    ctx[key] = r.data;
  }
  const c = await call('POST', '/api/chats', {
    type: 'direct', memberIds: [ctx.bob.user.id],
  }, ctx.alice.token);
  ctx.chatId = c.data.chat.id;
});

test('загрузка файла и сообщение с изображением', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const res = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ctx.alice.token,
      'Content-Type': 'image/png',
      'X-File-Name': encodeURIComponent('фото.png'),
    },
    body: png,
  });
  assert.equal(res.status, 200);
  const { file } = await res.json();
  assert.equal(file.name, 'фото.png');
  assert.equal(file.size, png.length);

  // Без авторизации загрузка запрещена
  const denied = await fetch(base + '/api/upload', { method: 'POST', body: png });
  assert.equal(denied.status, 401);

  // Файл скачивается с правильным mime
  const dl = await fetch(base + file.url);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'image/png');
  assert.equal((await dl.arrayBuffer()).byteLength, png.length);

  // Сообщение-картинка с подписью
  const sent = await call('POST', `/api/chats/${ctx.chatId}/messages`, {
    kind: 'image', fileId: file.id, text: 'Смотри!',
  }, ctx.alice.token);
  assert.equal(sent.status, 200);
  assert.equal(sent.data.message.kind, 'image');
  assert.equal(sent.data.message.file.name, 'фото.png');
  ctx.imageMsg = sent.data.message;
});

test('ответ на сообщение (reply)', async () => {
  const r = await call('POST', `/api/chats/${ctx.chatId}/messages`, {
    text: 'Отвечаю на картинку', replyTo: ctx.imageMsg.id,
  }, ctx.bob.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.message.replyTo.id, ctx.imageMsg.id);
  assert.equal(r.data.message.replyTo.senderName, 'Алиса');
  assert.equal(r.data.message.replyTo.kind, 'image');
});

test('реакции: добавление и снятие', async () => {
  const add = await call('POST', `/api/messages/${ctx.imageMsg.id}/reactions`, {
    emoji: '👍',
  }, ctx.bob.token);
  assert.equal(add.status, 200);
  assert.equal(add.data.message.reactions.length, 1);
  assert.equal(add.data.message.reactions[0].count, 1);

  const add2 = await call('POST', `/api/messages/${ctx.imageMsg.id}/reactions`, {
    emoji: '👍',
  }, ctx.alice.token);
  assert.equal(add2.data.message.reactions[0].count, 2);

  const toggle = await call('POST', `/api/messages/${ctx.imageMsg.id}/reactions`, {
    emoji: '👍',
  }, ctx.bob.token);
  assert.equal(toggle.data.message.reactions[0].count, 1, 'повторная реакция снимается');
});

test('пересылка сообщения', async () => {
  const g = await call('POST', '/api/chats', {
    type: 'group', title: 'Группа', memberIds: [ctx.eve.user.id],
  }, ctx.alice.token);
  ctx.groupId = g.data.chat.id;

  const fwd = await call('POST', `/api/messages/${ctx.imageMsg.id}/forward`, {
    chatId: ctx.groupId,
  }, ctx.alice.token);
  assert.equal(fwd.status, 200);
  assert.equal(fwd.data.message.forwardFrom, 'Алиса');
  assert.equal(fwd.data.message.kind, 'image');
  assert.equal(fwd.data.message.chatId, ctx.groupId);

  // Ева не участник личного чата — пересылать из него не может
  const denied = await call('POST', `/api/messages/${ctx.imageMsg.id}/forward`, {
    chatId: ctx.groupId,
  }, ctx.eve.token);
  assert.equal(denied.status, 403);
});

test('каналы: подписчики не публикуют', async () => {
  const ch = await call('POST', '/api/chats', {
    type: 'channel', title: 'Новости', description: 'Корпоративные новости',
    memberIds: [ctx.bob.user.id],
  }, ctx.alice.token);
  assert.equal(ch.status, 200);
  assert.equal(ch.data.chat.type, 'channel');
  assert.equal(ch.data.chat.myRole, 'owner');
  ctx.channelId = ch.data.chat.id;

  const ok = await call('POST', `/api/chats/${ctx.channelId}/messages`, {
    text: 'Первый пост',
  }, ctx.alice.token);
  assert.equal(ok.status, 200);

  const denied = await call('POST', `/api/chats/${ctx.channelId}/messages`, {
    text: 'А я подписчик',
  }, ctx.bob.token);
  assert.equal(denied.status, 403);

  // Назначаем Боба админом — теперь может публиковать
  const promote = await call('POST', `/api/chats/${ctx.channelId}/admins`, {
    userId: ctx.bob.user.id, admin: true,
  }, ctx.alice.token);
  assert.equal(promote.status, 200);
  const nowOk = await call('POST', `/api/chats/${ctx.channelId}/messages`, {
    text: 'Теперь я админ',
  }, ctx.bob.token);
  assert.equal(nowOk.status, 200);
});

test('управление участниками', async () => {
  // Добавление участника в группу
  const add = await call('POST', `/api/chats/${ctx.groupId}/members`, {
    userIds: [ctx.bob.user.id],
  }, ctx.alice.token);
  assert.equal(add.status, 200);
  assert.equal(add.data.chat.members.length, 3);

  // Обычный участник не может удалить другого
  const denied = await call('DELETE',
    `/api/chats/${ctx.groupId}/members/${ctx.eve.user.id}`, null, ctx.bob.token);
  assert.equal(denied.status, 403);

  // Владелец может
  const removed = await call('DELETE',
    `/api/chats/${ctx.groupId}/members/${ctx.eve.user.id}`, null, ctx.alice.token);
  assert.equal(removed.status, 200);

  // Участник может выйти сам
  const left = await call('DELETE',
    `/api/chats/${ctx.groupId}/members/${ctx.bob.user.id}`, null, ctx.bob.token);
  assert.equal(left.status, 200);

  // Владельца удалить нельзя
  const ownerDenied = await call('DELETE',
    `/api/chats/${ctx.channelId}/members/${ctx.alice.user.id}`, null, ctx.bob.token);
  assert.equal(ownerDenied.status, 403);
});

test('закреплённые сообщения', async () => {
  const sent = await call('POST', `/api/chats/${ctx.chatId}/messages`, {
    text: 'Важное сообщение',
  }, ctx.alice.token);
  const pin = await call('POST', `/api/chats/${ctx.chatId}/pin`, {
    messageId: sent.data.message.id,
  }, ctx.alice.token);
  assert.equal(pin.status, 200);

  const chatsList = await call('GET', '/api/chats', null, ctx.bob.token);
  const chat = chatsList.data.chats.find((c) => c.id === ctx.chatId);
  assert.equal(chat.pinnedMessage.text, 'Важное сообщение');

  const unpin = await call('POST', `/api/chats/${ctx.chatId}/pin`, {
    messageId: null,
  }, ctx.alice.token);
  assert.equal(unpin.status, 200);
});

test('поиск по сообщениям', async () => {
  const res = await call('GET', '/api/search?q=важное', null, ctx.alice.token);
  assert.equal(res.status, 200);
  assert.ok(res.data.messages.length >= 1);
  assert.match(res.data.messages[0].text, /Важное/);

  // Ева не видит чужих сообщений в поиске
  const eve = await call('GET', '/api/search?q=важное', null, ctx.eve.token);
  assert.equal(eve.data.messages.length, 0);
});

test('профиль: имя, био, аватар', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ctx.alice.token,
      'Content-Type': 'image/png',
      'X-File-Name': 'avatar.png',
    },
    body: png,
  });
  const { file } = await up.json();

  const res = await call('PUT', '/api/me', {
    name: 'Алиса Иванова', bio: 'Отдел разработки', avatarFileId: file.id,
  }, ctx.alice.token);
  assert.equal(res.status, 200);
  assert.equal(res.data.user.name, 'Алиса Иванова');
  assert.equal(res.data.user.bio, 'Отдел разработки');
  assert.equal(res.data.user.avatar, `/files/${file.id}`);
});

test('mute чата', async () => {
  const res = await call('POST', `/api/chats/${ctx.chatId}/mute`, {
    muted: true,
  }, ctx.bob.token);
  assert.equal(res.status, 200);
  const list = await call('GET', '/api/chats', null, ctx.bob.token);
  assert.equal(list.data.chats.find((c) => c.id === ctx.chatId).muted, true);
});

test('редактирование группы админом', async () => {
  const res = await call('PUT', `/api/chats/${ctx.groupId}`, {
    title: 'Группа 2.0', description: 'Описание',
  }, ctx.alice.token);
  assert.equal(res.status, 200);
  assert.equal(res.data.chat.title, 'Группа 2.0');
});

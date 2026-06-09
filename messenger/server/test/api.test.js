'use strict';

process.env.GRAM_DB = ':memory:';
process.env.GRAM_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');
const WebSocket = require('ws');

const { server } = require('../src/index');

let base;
let wsBase;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
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

test('регистрация пользователей', async () => {
  const a = await call('POST', '/api/register', {
    username: 'alice', name: 'Алиса', password: 'secret123',
  });
  assert.equal(a.status, 200);
  assert.ok(a.data.token);
  ctx.alice = a.data;

  const b = await call('POST', '/api/register', {
    username: 'bob', name: 'Боб', password: 'secret123',
  });
  assert.equal(b.status, 200);
  ctx.bob = b.data;

  const dup = await call('POST', '/api/register', {
    username: 'ALICE', name: 'Другая', password: 'secret123',
  });
  assert.equal(dup.status, 409, 'логин без учёта регистра занят');

  const bad = await call('POST', '/api/register', {
    username: 'x', name: 'X', password: '123',
  });
  assert.equal(bad.status, 400);
});

test('вход и /api/me', async () => {
  const ok = await call('POST', '/api/login', { username: 'alice', password: 'secret123' });
  assert.equal(ok.status, 200);

  const bad = await call('POST', '/api/login', { username: 'alice', password: 'wrong' });
  assert.equal(bad.status, 401);

  const me = await call('GET', '/api/me', null, ctx.alice.token);
  assert.equal(me.data.user.username, 'alice');

  const noAuth = await call('GET', '/api/me');
  assert.equal(noAuth.status, 401);
});

test('поиск пользователей', async () => {
  const res = await call('GET', '/api/users?q=бо', null, ctx.alice.token);
  assert.equal(res.status, 200);
  assert.equal(res.data.users.length, 1);
  assert.equal(res.data.users[0].username, 'bob');
});

test('личный чат: создание и дедупликация', async () => {
  const c1 = await call('POST', '/api/chats', {
    type: 'direct', memberIds: [ctx.bob.user.id],
  }, ctx.alice.token);
  assert.equal(c1.status, 200);
  assert.equal(c1.data.chat.type, 'direct');
  assert.equal(c1.data.chat.title, 'Боб', 'личный чат называется именем собеседника');
  ctx.chatId = c1.data.chat.id;

  const c2 = await call('POST', '/api/chats', {
    type: 'direct', memberIds: [ctx.bob.user.id],
  }, ctx.alice.token);
  assert.equal(c2.data.chat.id, ctx.chatId, 'повторное создание возвращает тот же чат');
  assert.equal(c2.data.existing, true);
});

test('отправка и история сообщений', async () => {
  const sent = await call('POST', `/api/chats/${ctx.chatId}/messages`, {
    text: 'Привет, Боб!',
  }, ctx.alice.token);
  assert.equal(sent.status, 200);
  ctx.msgId = sent.data.message.id;

  const history = await call('GET', `/api/chats/${ctx.chatId}/messages`, null, ctx.bob.token);
  assert.equal(history.data.messages.length, 1);
  assert.equal(history.data.messages[0].text, 'Привет, Боб!');

  // Посторонний не имеет доступа
  const eve = await call('POST', '/api/register', {
    username: 'eve', name: 'Ева', password: 'secret123',
  });
  const denied = await call('GET', `/api/chats/${ctx.chatId}/messages`, null, eve.data.token);
  assert.equal(denied.status, 403);
  ctx.eve = eve.data;
});

test('непрочитанные и отметка о прочтении', async () => {
  let chats = await call('GET', '/api/chats', null, ctx.bob.token);
  assert.equal(chats.data.chats[0].unread, 1);

  const read = await call('POST', `/api/chats/${ctx.chatId}/read`, {
    messageId: ctx.msgId,
  }, ctx.bob.token);
  assert.equal(read.status, 200);

  chats = await call('GET', '/api/chats', null, ctx.bob.token);
  assert.equal(chats.data.chats[0].unread, 0);

  // Алиса видит, что её сообщение прочитано
  const aliceChats = await call('GET', '/api/chats', null, ctx.alice.token);
  assert.ok(aliceChats.data.chats[0].readByOthersUpTo >= ctx.msgId);
});

test('редактирование и удаление сообщений', async () => {
  const edited = await call('PUT', `/api/messages/${ctx.msgId}`, {
    text: 'Привет (исправлено)',
  }, ctx.alice.token);
  assert.equal(edited.status, 200);
  assert.ok(edited.data.message.editedAt);

  const foreign = await call('PUT', `/api/messages/${ctx.msgId}`, {
    text: 'взлом',
  }, ctx.bob.token);
  assert.equal(foreign.status, 403, 'чужое сообщение редактировать нельзя');

  const del = await call('DELETE', `/api/messages/${ctx.msgId}`, null, ctx.alice.token);
  assert.equal(del.status, 200);

  const history = await call('GET', `/api/chats/${ctx.chatId}/messages`, null, ctx.bob.token);
  assert.equal(history.data.messages[0].deleted, true);
  assert.equal(history.data.messages[0].text, '');
});

test('групповой чат', async () => {
  const g = await call('POST', '/api/chats', {
    type: 'group', title: 'Команда', memberIds: [ctx.bob.user.id, ctx.eve.user.id],
  }, ctx.alice.token);
  assert.equal(g.status, 200);
  assert.equal(g.data.chat.members.length, 3);

  const sent = await call('POST', `/api/chats/${g.data.chat.id}/messages`, {
    text: 'Всем привет',
  }, ctx.eve.token);
  assert.equal(sent.status, 200);

  const chats = await call('GET', '/api/chats', null, ctx.bob.token);
  const group = chats.data.chats.find((c) => c.type === 'group');
  assert.equal(group.title, 'Команда');
  assert.equal(group.unread, 1);
});

test('WebSocket: доставка в реальном времени, ack и typing', async () => {
  const connect = (token) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
    ws.on('error', reject);
    ws.events = [];
    ws.waiters = [];
    ws.on('message', (raw) => {
      const ev = JSON.parse(raw);
      const i = ws.waiters.findIndex((w) => w.match(ev));
      if (i >= 0) ws.waiters.splice(i, 1)[0].resolve(ev);
      else ws.events.push(ev);
    });
    ws.expect = (match, ms = 3000) => {
      const i = ws.events.findIndex(match);
      if (i >= 0) return Promise.resolve(ws.events.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('timeout waiting for event')), ms);
        ws.waiters.push({ match, resolve: (ev) => { clearTimeout(timer); res(ev); } });
      });
    };
    ws.on('open', () => resolve(ws));
  });

  const wsAlice = await connect(ctx.alice.token);
  const wsBob = await connect(ctx.bob.token);
  await wsAlice.expect((e) => e.type === 'hello');
  await wsBob.expect((e) => e.type === 'hello');

  // Сообщение через WS: Боб получает событие, Алиса — подтверждение
  wsAlice.send(JSON.stringify({
    type: 'message', chatId: ctx.chatId, text: 'через сокет', tempId: 't1',
  }));
  const [delivered, ack] = await Promise.all([
    wsBob.expect((e) => e.type === 'message'),
    wsAlice.expect((e) => e.type === 'ack' && e.tempId === 't1'),
  ]);
  assert.equal(delivered.message.text, 'через сокет');
  assert.equal(ack.message.text, 'через сокет');

  // Индикатор набора
  wsBob.send(JSON.stringify({ type: 'typing', chatId: ctx.chatId }));
  const typing = await wsAlice.expect((e) => e.type === 'typing');
  assert.equal(typing.userId, ctx.bob.user.id);

  // Неавторизованное подключение отклоняется
  const badWs = new WebSocket(`${wsBase}/ws?token=bad`);
  const [code] = await once(badWs, 'close');
  assert.equal(code, 4401);

  wsAlice.close();
  wsBob.close();
});

test('статика веб-клиента отдаётся', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Gram/);
});

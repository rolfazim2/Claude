'use strict';

process.env.GRAM_DB = ':memory:';
process.env.GRAM_SECRET = 'test-secret';
process.env.GRAM_DATA_DIR = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'gram-platform-')
);
delete process.env.ANTHROPIC_API_KEY; // AI-бот в режиме без ключа

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

async function call(method, path, body, token, scheme = 'Bearer') {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `${scheme} ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = {};

test('подготовка пользователей', async () => {
  for (const [key, username, name] of [['alice', 'alice', 'Алиса'], ['bob', 'bob', 'Боб']]) {
    const r = await call('POST', '/api/register', { username, name, password: 'secret123' });
    assert.equal(r.status, 200);
    ctx[key] = r.data;
  }
});

test('встроенный AI-бот существует и отвечает в личке', async () => {
  const bot = await call('GET', '/api/ai-bot', null, ctx.alice.token);
  assert.equal(bot.status, 200);
  assert.equal(bot.data.user.username, 'gram_ai');
  assert.equal(bot.data.user.isBot, true);
  ctx.aiBotId = bot.data.user.id;

  const chat = await call('POST', '/api/chats', {
    type: 'direct', memberIds: [ctx.aiBotId],
  }, ctx.alice.token);
  assert.equal(chat.status, 200);
  const chatId = chat.data.chat.id;

  const sent = await call('POST', `/api/chats/${chatId}/messages`, {
    text: 'Привет! Что ты умеешь?',
  }, ctx.alice.token);
  assert.equal(sent.status, 200);

  // Ответ приходит асинхронно — ждём появления сообщения от бота
  let botReply = null;
  for (let i = 0; i < 30 && !botReply; i++) {
    await sleep(100);
    const history = await call('GET', `/api/chats/${chatId}/messages`, null, ctx.alice.token);
    botReply = history.data.messages.find((m) => m.senderId === ctx.aiBotId);
  }
  assert.ok(botReply, 'AI-бот должен ответить');
  assert.match(botReply.text, /ANTHROPIC_API_KEY/, 'без ключа бот объясняет настройку');
});

test('в группе AI-бот отвечает только на упоминание', async () => {
  const g = await call('POST', '/api/chats', {
    type: 'group', title: 'Команда', memberIds: [ctx.bob.user.id, ctx.aiBotId],
  }, ctx.alice.token);
  const chatId = g.data.chat.id;

  await call('POST', `/api/chats/${chatId}/messages`, {
    text: 'Просто болтаем без бота',
  }, ctx.alice.token);
  await sleep(400);
  let history = await call('GET', `/api/chats/${chatId}/messages`, null, ctx.alice.token);
  assert.ok(!history.data.messages.some((m) => m.senderId === ctx.aiBotId),
    'без упоминания бот молчит');

  await call('POST', `/api/chats/${chatId}/messages`, {
    text: '@gram_ai подскажи что-нибудь',
  }, ctx.bob.token);
  let botReply = null;
  for (let i = 0; i < 30 && !botReply; i++) {
    await sleep(100);
    history = await call('GET', `/api/chats/${chatId}/messages`, null, ctx.alice.token);
    botReply = history.data.messages.find((m) => m.senderId === ctx.aiBotId);
  }
  assert.ok(botReply, 'на упоминание бот отвечает');
});

test('создание своего бота и Bot API', async () => {
  const bad = await call('POST', '/api/bots', {
    username: 'mycoolthing', name: 'X',
  }, ctx.alice.token);
  assert.equal(bad.status, 400, 'логин бота должен оканчиваться на bot');

  const created = await call('POST', '/api/bots', {
    username: 'deploybot', name: 'Деплой-бот',
  }, ctx.alice.token);
  assert.equal(created.status, 200);
  assert.ok(created.data.bot.token.includes(':'));
  ctx.bot = created.data.bot;

  const list = await call('GET', '/api/bots', null, ctx.alice.token);
  assert.equal(list.data.bots.length, 1);

  // Бот ищется как пользователь и добавляется в группу
  const found = await call('GET', '/api/users?q=deploybot', null, ctx.bob.token);
  assert.equal(found.data.users[0].isBot, true);

  const g = await call('POST', '/api/chats', {
    type: 'group', title: 'CI/CD', memberIds: [ctx.bot.userId],
  }, ctx.alice.token);
  ctx.botChatId = g.data.chat.id;

  // Bot API: бот пишет в чат по токену
  const sent = await call('POST', '/api/bot/messages', {
    chatId: ctx.botChatId, text: 'Деплой v1.2.3 завершён ✅',
  }, ctx.bot.token, 'Bot');
  assert.equal(sent.status, 200);
  assert.equal(sent.data.message.senderName, 'Деплой-бот');

  const badToken = await call('POST', '/api/bot/messages', {
    chatId: ctx.botChatId, text: 'хак',
  }, 'wrong-token', 'Bot');
  assert.equal(badToken.status, 401);

  // Сообщения пользователей попадают в очередь getUpdates
  await call('POST', `/api/chats/${ctx.botChatId}/messages`, {
    text: 'deploy прод',
  }, ctx.alice.token);
  await sleep(300);
  const updates = await call('GET', '/api/bot/updates?offset=0', null, ctx.bot.token, 'Bot');
  assert.equal(updates.status, 200);
  assert.ok(updates.data.updates.some((u) => u.message.text === 'deploy прод'));

  // Вебхук сохраняется
  const wh = await call('POST', `/api/bots/${ctx.bot.userId}/webhook`, {
    url: 'https://example.com/hook',
  }, ctx.alice.token);
  assert.equal(wh.status, 200);

  // Чужой бот недоступен
  const foreign = await call('DELETE', `/api/bots/${ctx.bot.userId}`, null, ctx.bob.token);
  assert.equal(foreign.status, 404);
});

test('пространства: создание, доступ, участники', async () => {
  const s = await call('POST', '/api/spaces', {
    name: 'Разработка', description: 'Спринт 12', memberIds: [ctx.bob.user.id],
  }, ctx.alice.token);
  assert.equal(s.status, 200);
  assert.equal(s.data.space.myRole, 'owner');
  assert.equal(s.data.space.members.length, 2);
  ctx.spaceId = s.data.space.id;

  const bobList = await call('GET', '/api/spaces', null, ctx.bob.token);
  assert.equal(bobList.data.spaces.length, 1);
  assert.equal(bobList.data.spaces[0].myRole, 'member');

  // Не владелец не может переименовать
  const denied = await call('PUT', `/api/spaces/${ctx.spaceId}`, {
    name: 'Захват',
  }, ctx.bob.token);
  assert.equal(denied.status, 403);

  // Ева не участник — доступа нет
  const eve = await call('POST', '/api/register', {
    username: 'eve2', name: 'Ева', password: 'secret123',
  });
  ctx.eve = eve.data;
  const noAccess = await call('GET', `/api/spaces/${ctx.spaceId}/tasks`, null, ctx.eve.token);
  assert.equal(noAccess.status, 403);
});

test('задачи: CRUD, статусы, исполнители', async () => {
  const t1 = await call('POST', `/api/spaces/${ctx.spaceId}/tasks`, {
    title: 'Сверстать экран входа', priority: 'high', assigneeId: ctx.bob.user.id,
    dueAt: Date.now() + 86400000,
  }, ctx.alice.token);
  assert.equal(t1.status, 200);
  assert.equal(t1.data.task.status, 'todo');
  assert.equal(t1.data.task.assigneeName, 'Боб');
  ctx.taskId = t1.data.task.id;

  await call('POST', `/api/spaces/${ctx.spaceId}/tasks`, {
    title: 'Настроить CI', status: 'doing',
  }, ctx.bob.token);

  // Исполнитель должен быть участником пространства
  const badAssignee = await call('POST', `/api/spaces/${ctx.spaceId}/tasks`, {
    title: 'X', assigneeId: ctx.eve.user.id,
  }, ctx.alice.token);
  assert.equal(badAssignee.status, 400);

  // Перенос задачи по доске (статус) и правка полей
  const moved = await call('PUT', `/api/tasks/${ctx.taskId}`, {
    status: 'done', description: 'Готово, проверено на стейдже',
  }, ctx.bob.token);
  assert.equal(moved.status, 200);
  assert.equal(moved.data.task.status, 'done');

  const board = await call('GET', `/api/spaces/${ctx.spaceId}/tasks`, null, ctx.alice.token);
  assert.equal(board.data.tasks.length, 2);
  assert.equal(board.data.tasks.filter((t) => t.status === 'done').length, 1);

  // Счётчик открытых задач в списке пространств
  const list = await call('GET', '/api/spaces', null, ctx.alice.token);
  assert.equal(list.data.spaces[0].openTasks, 1);

  const del = await call('DELETE', `/api/tasks/${ctx.taskId}`, null, ctx.alice.token);
  assert.equal(del.status, 200);
});

test('выход и удаление пространства', async () => {
  // Боб выходит сам
  const left = await call('DELETE',
    `/api/spaces/${ctx.spaceId}/members/${ctx.bob.user.id}`, null, ctx.bob.token);
  assert.equal(left.status, 200);

  // Удалить может только владелец
  const denied = await call('DELETE', `/api/spaces/${ctx.spaceId}`, null, ctx.eve.token);
  assert.equal(denied.status, 403);
  const removed = await call('DELETE', `/api/spaces/${ctx.spaceId}`, null, ctx.alice.token);
  assert.equal(removed.status, 200);

  const list = await call('GET', '/api/spaces', null, ctx.alice.token);
  assert.equal(list.data.spaces.length, 0);
});

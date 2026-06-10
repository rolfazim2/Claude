'use strict';

// Наполняет базу демо-данными: пользователи, переписка, группа, канал,
// диалог с Gram AI и пространство с kanban-доской.
// Запуск: GRAM_DATA_DIR=./data-demo node seed-demo.js
// Печатает токен пользователя anna для входа без пароля (localStorage gram_token).

const { db, users, chats, messages, reactions, spaces, tasks } = require('./src/db');
const auth = require('./src/auth');
const bots = require('./src/bots');

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;
const now = Date.now();

function user(username, name, bio) {
  if (!users.byUsername(username)) {
    users.create(username, name, auth.hashPassword('demo123'));
    const u = users.byUsername(username);
    users.update(Number(u.id), { name, bio, avatarFile: null });
  }
  return Number(users.byUsername(username).id);
}

function msg(chatId, senderId, text, agoMs, opts = {}) {
  const m = messages.create(chatId, senderId, { text, ...opts });
  db.prepare('UPDATE messages SET created_at = ? WHERE id = ?')
    .run(now - agoMs, Number(m.id));
  return Number(m.id);
}

// ---- Пользователи ----
const anna = user('anna', 'Анна Соколова', 'Продакт-менеджер');
const boris = user('boris', 'Борис Ким', 'Backend-разработчик');
const vera = user('vera', 'Вера Лебедева', 'Продуктовый дизайнер');
const maks = user('maks', 'Макс Орлов', 'iOS-разработчик');
const aiBot = bots.ensureBuiltinBots();

// ---- Личный чат Анна ↔ Борис ----
const direct = chats.create('direct', null, anna);
chats.addMember(direct, anna);
chats.addMember(direct, boris);

msg(direct, boris, 'Привет! Посмотрел макеты онбординга — выглядит отлично 🔥', 52 * MIN);
const m2 = msg(direct, anna, 'Спасибо! Вера вчера закончила. Когда сможем взять в спринт?', 49 * MIN);
msg(direct, boris, 'API уже готов, осталось собрать экраны. Думаю, к пятнице будет на стейдже', 45 * MIN);
const m4 = msg(direct, anna, 'Супер. Тогда демо для команды в пятницу в 16:00?', 41 * MIN);
const m5 = msg(direct, boris, 'Договорились 👌 Заодно покажу новые групповые звонки', 38 * MIN);
msg(direct, anna, 'Отлично, добавила встречу в календарь. Позови ещё Макса', 2 * MIN);
reactions.toggle(m4, boris, '👍');
reactions.toggle(m5, anna, '🔥');
// Борис прочитал всё, Анна — всё
const lastDirect = Number(messages.last(direct).id);
chats.setLastRead(direct, boris, lastDirect);
chats.setLastRead(direct, anna, lastDirect);

// ---- Группа «Продукт и дизайн» ----
const group = chats.create('group', 'Продукт и дизайн', anna);
chats.update(group, { title: 'Продукт и дизайн', description: 'Команда запуска Gram 3.0', avatarFile: null });
chats.addMember(group, anna, 'owner');
chats.addMember(group, boris);
chats.addMember(group, vera);
chats.addMember(group, maks);

const g1 = msg(group, anna, 'Команда, запуск Gram 3.0 — 24 июня. Финальный чек-лист в пространстве «Запуск Gram 3.0», посмотрите свои задачи 🚀', 26 * HOUR);
msg(group, vera, 'Дизайн онбординга загрузила в Figma, ссылка в задаче', 25 * HOUR);
const g3 = msg(group, maks, 'Пуш-уведомления для iOS почти готовы, осталось протестировать на проде', 24 * HOUR);
msg(group, boris, 'Класс! Я сегодня выкатил реакции и голосовые на стейдж — можно тыкать', 90 * MIN);
const g5 = msg(group, vera, 'Уже потыкала — голосовые работают идеально 🎤', 75 * MIN, { replyTo: g3 ? undefined : undefined });
msg(group, anna, '@gram_ai сделай выжимку обсуждения для тех, кто пропустил', 70 * MIN);
msg(group, aiBot, 'Краткая выжимка: запуск Gram 3.0 назначен на 24 июня. Дизайн онбординга готов и лежит в Figma. Пуш-уведомления для iOS — на финальном тестировании. Реакции и голосовые сообщения уже на стейдже, команда проверила — работают. Полный чек-лист задач — в пространстве «Запуск Gram 3.0».', 69 * MIN);
reactions.toggle(g5, boris, '❤️');
reactions.toggle(g1, vera, '🚀');
reactions.toggle(g1, boris, '🚀');
reactions.toggle(g1, maks, '👍');
chats.setPinned(group, g1);
const lastGroup = Number(messages.last(group).id);
for (const uid of [anna, boris, vera, maks]) chats.setLastRead(group, uid, lastGroup);

// ---- Канал «Новости Gram» ----
const channel = chats.create('channel', 'Новости Gram', anna);
chats.update(channel, { title: 'Новости Gram', description: 'Официальные анонсы команды', avatarFile: null });
chats.addMember(channel, anna, 'owner');
chats.addMember(channel, boris);
chats.addMember(channel, vera);
chats.addMember(channel, maks);
msg(channel, anna, '🎉 В Gram появились пространства — полноценный таск-менеджер с kanban-досками прямо в мессенджере. Создавайте пространства, назначайте задачи и двигайте их по статусам.', 5 * HOUR);
msg(channel, anna, '🤖 Знакомьтесь: Gram AI. Ассистент на базе Claude отвечает в личке и по упоминанию @gram_ai в группах: выжимки переписки, тексты, код, планирование.', 3 * HOUR);
// у Анны канал прочитан, новости «не прочитаны» для остальных — неважно для скриншотов
chats.setLastRead(channel, anna, Number(messages.last(channel).id));

// ---- Диалог с Gram AI ----
const aiChat = chats.create('direct', null, anna);
chats.addMember(aiChat, anna);
chats.addMember(aiChat, aiBot);
msg(aiChat, anna, 'Привет! Составь план запуска фичи «Пространства» на следующую неделю', 32 * MIN);
msg(aiChat, aiBot,
  'План запуска «Пространств» на неделю:\n\n' +
  'Пн — финальное ревью: пройтись по доске «Запуск Gram 3.0», закрыть блокеры, заморозить скоуп.\n' +
  'Вт — QA-прогон: чек-лист по созданию пространств, задачам, drag-and-drop и правам участников.\n' +
  'Ср — бета для команды: включить фичу внутренней группе, собрать обратную связь в отдельный чат.\n' +
  'Чт — правки по фидбеку и подготовка анонса в канале «Новости Gram».\n' +
  'Пт — релиз к 12:00, мониторинг метрик, вечером — ретро.\n\n' +
  'Могу расписать QA-чек-лист подробнее или набросать текст анонса — скажи, что нужнее.', 31 * MIN);
msg(aiChat, anna, 'Набросай текст анонса, коротко и живо', 29 * MIN);
msg(aiChat, aiBot,
  '🚀 Встречайте «Пространства» в Gram!\n\n' +
  'Теперь задачи живут там же, где обсуждения. Создайте пространство для команды, ' +
  'накидайте задачи на kanban-доску и двигайте их от «Надо сделать» до «Готово» — ' +
  'без переключения в сторонние трекеры.\n\n' +
  '• Доски с приоритетами, дедлайнами и исполнителями\n' +
  '• Обновления в реальном времени у всей команды\n' +
  '• Работает в вебе и в приложении для macOS\n\n' +
  'Откройте вкладку «Пространства» и попробуйте 👇', 28 * MIN);
chats.setLastRead(aiChat, anna, Number(messages.last(aiChat).id));

// ---- Чат с Верой (непрочитанные у Анны) ----
const direct2 = chats.create('direct', null, vera);
chats.addMember(direct2, vera);
chats.addMember(direct2, anna);
msg(direct2, vera, 'Анна, глянь пожалуйста финальные иконки для пространств', 12 * MIN);
msg(direct2, vera, 'И ещё вопрос по цвету бейджей приоритета 🎨', 11 * MIN);

// ---- Пространство с задачами ----
const space = spaces.create('Запуск Gram 3.0', 'Релиз 24 июня', anna);
spaces.addMember(space, anna, 'owner');
spaces.addMember(space, boris);
spaces.addMember(space, vera);
spaces.addMember(space, maks);

const day = 24 * HOUR;
tasks.create(space, anna, { title: 'Дизайн онбординга', description: 'Макеты в Figma, 6 экранов', status: 'todo', priority: 'high', assigneeId: vera, dueAt: now + 2 * day });
tasks.create(space, anna, { title: 'Пуш-уведомления для iOS', status: 'todo', priority: 'medium', assigneeId: maks, dueAt: now + 4 * day });
tasks.create(space, boris, { title: 'Обновить документацию Bot API', status: 'todo', priority: 'low', dueAt: now + 6 * day });
tasks.create(space, anna, { title: 'Нагрузочное тестирование WebSocket', status: 'todo', priority: 'medium', assigneeId: boris });
tasks.create(space, anna, { title: 'Групповые звонки до 8 человек', description: 'WebRTC mesh, деградация качества при слабой сети', status: 'doing', priority: 'high', assigneeId: boris, dueAt: now + day });
tasks.create(space, vera, { title: 'Тёмная тема для досок задач', status: 'doing', priority: 'medium', assigneeId: vera, dueAt: now - day });
tasks.create(space, anna, { title: 'Реакции на сообщения', status: 'done', priority: 'high', assigneeId: boris });
tasks.create(space, anna, { title: 'Голосовые сообщения', status: 'done', priority: 'medium', assigneeId: boris });
tasks.create(space, anna, { title: 'Бейдж непрочитанных в доке macOS', status: 'done', priority: 'low', assigneeId: maks });

console.log('Демо-данные созданы.');
console.log('TOKEN_ANNA=' + auth.sign({ uid: anna }));
console.log('TOKEN_BORIS=' + auth.sign({ uid: boris }));

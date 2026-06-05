// TaskFlow Telegram-бот (grammY).
// Возможности: авторизация на сайте через /start <код>, просмотр задач,
// напоминания приходят сюда же (их шлёт API). Запуск: BOT_TOKEN=... pnpm dev:bot
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { STATUS_META, KANBAN_COLUMNS } from '@taskflow/shared';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан. Укажите токен бота в переменных окружения.');
  process.exit(1);
}

const API_URL = process.env.API_URL || 'http://localhost:3001';
const BOT_SECRET = process.env.BOT_SHARED_SECRET || 'dev-secret';

const bot = new Bot(token);

const mainMenu = new Keyboard().text('📋 Мои задачи').text('❓ Помощь').resized();

async function api(path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-bot-secret': BOT_SECRET, ...(init?.headers || {}) },
  });
}

// /start [код] — если есть код, подтверждаем вход на сайте.
bot.command('start', async (ctx) => {
  const code = ctx.match?.trim();
  if (code) {
    const res = await api('/auth/telegram/confirm', {
      method: 'POST',
      body: JSON.stringify({
        code,
        tgId: ctx.from?.id,
        firstName: ctx.from?.first_name,
        username: ctx.from?.username,
      }),
    });
    if (res.ok) {
      await ctx.reply('✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.', { reply_markup: mainMenu });
    } else {
      const err = (await res.json().catch(() => ({}))) as any;
      await ctx.reply(`⚠️ Не удалось подтвердить вход: ${err.error || 'код истёк'}. Запросите новый код на сайте.`);
    }
    return;
  }
  await ctx.reply(
    'Привет! Это <b>TaskFlow</b>.\n\nЧтобы войти на сайте — нажмите «Войти через Telegram» там и откройте полученную ссылку.\nЗдесь вы будете получать напоминания и видеть свои задачи.',
    { parse_mode: 'HTML', reply_markup: mainMenu },
  );
});

// /link <код> — привязать текущую группу к проекту (стиль UTasks).
bot.command('link', async (ctx) => {
  const code = ctx.match?.trim();
  if (!code) {
    await ctx.reply('Использование: /link <код>. Код возьмите на сайте: проект → «Привязать группу».');
    return;
  }
  const res = await api('/projects/telegram/confirm', {
    method: 'POST',
    body: JSON.stringify({ code, chatId: ctx.chat?.id, title: (ctx.chat as any)?.title }),
  });
  if (res.ok) {
    const d = (await res.json()) as { projectName: string };
    await ctx.reply(`✅ Группа привязана к проекту «${d.projectName}». Сюда будут приходить события задач.`);
  } else {
    const e = (await res.json().catch(() => ({}))) as any;
    await ctx.reply(`⚠️ ${e.error || 'Не удалось привязать'}. Запросите новый код на сайте.`);
  }
});

// Незавершённые действия пользователя (ожидание текста для комментария/доказательства).
const pending = new Map<number, { action: 'comment' | 'proof'; taskId: string }>();

function taskKeyboard(taskId: string) {
  return new InlineKeyboard()
    .text('✅ Готово', `done:${taskId}`)
    .text('🔄 Статус', `status:${taskId}`)
    .row()
    .text('💬 Коммент', `cmt:${taskId}`)
    .text('📎 Док-во', `proof:${taskId}`);
}

async function showTasks(ctx: any) {
  const res = await api(`/bot/tasks?tgId=${ctx.from?.id}`);
  if (res.status === 404) {
    await ctx.reply('Аккаунт ещё не привязан. Войдите на сайте через Telegram.');
    return;
  }
  if (!res.ok) {
    await ctx.reply('Не удалось получить задачи. Попробуйте позже.');
    return;
  }
  const data = (await res.json()) as { user: { fullName: string }; tasks: any[] };
  if (!data.tasks.length) {
    await ctx.reply('Активных задач нет 🎉');
    return;
  }
  await ctx.reply(`Ваши задачи (${data.tasks.length}):`);
  for (const t of data.tasks.slice(0, 10)) {
    const due = t.dueAt ? ` — до ${new Date(t.dueAt).toLocaleDateString('ru-RU')}` : '';
    const label = STATUS_META[t.status as keyof typeof STATUS_META]?.label ?? t.status;
    await ctx.reply(`${label} • <b>${t.title}</b>${due}`, { parse_mode: 'HTML', reply_markup: taskKeyboard(t.id) });
  }
}

bot.hears('📋 Мои задачи', showTasks);
bot.command('tasks', showTasks);
bot.hears('❓ Помощь', (ctx) =>
  ctx.reply('Команды:\n/start — вход/привязка\n/tasks — мои задачи\n\nУ каждой задачи есть кнопки: ✅ готово, 🔄 статус, 💬 комментарий, 📎 доказательство.\nНапоминания приходят за 1 день и за 1 час до срока (МСК).'),
);
bot.command('help', (ctx) => ctx.reply('/start — вход, /tasks — мои задачи. У задач есть кнопки действий.'));

async function botAction(path: string, body: object) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

// ✅ Готово
bot.callbackQuery(/^done:(.+)$/, async (ctx) => {
  const taskId = ctx.match[1];
  const res = await botAction(`/bot/tasks/${taskId}/status`, { tgId: ctx.from?.id, status: 'done' });
  if (res.ok) {
    await ctx.answerCallbackQuery({ text: 'Задача выполнена ✅' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  } else {
    const e = (await res.json().catch(() => ({}))) as any;
    if (e.error === 'needs_proof') {
      await ctx.answerCallbackQuery({ text: 'Нужно доказательство — нажмите 📎', show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: e.error || 'Ошибка', show_alert: true });
    }
  }
});

// 🔄 Статус → меню
bot.callbackQuery(/^status:(.+)$/, async (ctx) => {
  const kb = new InlineKeyboard();
  for (const s of KANBAN_COLUMNS) kb.text(STATUS_META[s].label, `set:${ctx.match[1]}:${s}`).row();
  await ctx.reply('Выберите статус:', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^set:([^:]+):(.+)$/, async (ctx) => {
  const [, taskId, status] = ctx.match;
  const res = await botAction(`/bot/tasks/${taskId}/status`, { tgId: ctx.from?.id, status });
  if (res.ok) {
    await ctx.answerCallbackQuery({ text: 'Статус обновлён' });
    await ctx.editMessageText(`Статус → ${STATUS_META[status as keyof typeof STATUS_META]?.label ?? status} ✅`);
  } else {
    const e = (await res.json().catch(() => ({}))) as any;
    await ctx.answerCallbackQuery({ text: e.error === 'needs_proof' ? 'Нужно доказательство' : e.error || 'Ошибка', show_alert: true });
  }
});

// 💬 Комментарий / 📎 Доказательство — запрашиваем текст
bot.callbackQuery(/^cmt:(.+)$/, async (ctx) => {
  pending.set(ctx.from!.id, { action: 'comment', taskId: ctx.match[1] });
  await ctx.reply('Напишите комментарий одним сообщением:');
  await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^proof:(.+)$/, async (ctx) => {
  pending.set(ctx.from!.id, { action: 'proof', taskId: ctx.match[1] });
  await ctx.reply('Отправьте доказательство — текст или ссылку:');
  await ctx.answerCallbackQuery();
});

// Текстовые сообщения, ожидаемые после нажатия 💬/📎.
bot.on('message:text', async (ctx) => {
  const p = pending.get(ctx.from.id);
  if (!p) return;
  pending.delete(ctx.from.id);
  const text = ctx.message.text.trim();
  if (p.action === 'comment') {
    const res = await botAction(`/bot/tasks/${p.taskId}/comment`, { tgId: ctx.from.id, body: text });
    await ctx.reply(res.ok ? '💬 Комментарий добавлен.' : '⚠️ Не удалось добавить комментарий.');
  } else {
    const res = await botAction(`/bot/tasks/${p.taskId}/proof`, { tgId: ctx.from.id, value: text });
    await ctx.reply(res.ok ? '📎 Доказательство приложено. Теперь можно закрыть задачу.' : '⚠️ Не удалось приложить доказательство.');
  }
});

bot.start();
console.log(`TaskFlow bot запущен. API: ${API_URL}`);

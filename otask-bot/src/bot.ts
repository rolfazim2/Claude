import { Bot, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { OtaskClient, OtaskError } from './otask/client.js';
import type { CreateTaskInput, Priority } from './otask/types.js';
import { store } from './store.js';
import {
  formatTaskCard,
  formatTaskList,
  isOverdue,
} from './format.js';

export const bot = new Bot(config.botToken);

/** Получить клиент otask для чата или объяснить, что нужно привязать ключ. */
async function clientFor(chatId: number): Promise<OtaskClient | null> {
  const key = await store.getApiKey(chatId);
  if (!key) return null;
  return new OtaskClient(key);
}

async function needKeyMessage(): Promise<string> {
  return [
    'Сначала привяжите ваш API-ключ otask:',
    '<code>/link ВАШ_КЛЮЧ</code>',
    '',
    'Ключ можно получить в настройках профиля otask.ru → API.',
  ].join('\n');
}

function reportError(e: unknown): string {
  if (e instanceof OtaskError) return `⚠️ ${e.message}`;
  return `⚠️ Непредвиденная ошибка: ${(e as Error).message}`;
}

// ── In-memory состояние мастера создания задачи ────────────────────────────
type WizardStep = 'title' | 'description' | 'deadline' | 'priority';
interface Wizard {
  step: WizardStep;
  draft: CreateTaskInput;
}
const wizards = new Map<number, Wizard>();

// ── Команды ────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    [
      '👋 Привет! Я бот для <b>otask.ru</b>.',
      '',
      'Что умею:',
      '• /tasks — мои назначенные задачи',
      '• /overdue — просроченные',
      '• /soon — у которых скоро дедлайн',
      '• /task <i>id</i> — карточка задачи',
      '• /new — поставить задачу (мастер)',
      '• /reminders <i>on|off</i> — напоминания о дедлайнах',
      '• /link <i>ключ</i> — привязать API-ключ otask',
      '',
      'Начните с привязки ключа: <code>/link ВАШ_КЛЮЧ</code>',
    ].join('\n'),
    { parse_mode: 'HTML' },
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Команды:',
      '/tasks — назначенные задачи',
      '/overdue — просроченные задачи',
      '/soon — задачи с близким дедлайном',
      '/task id — карточка конкретной задачи',
      '/new — поставить задачу пошагово',
      '/new Заголовок | описание | 2026-06-10 18:00 | high — одной строкой',
      '/reminders on | off — вкл/выкл напоминания',
      '/link ключ — привязать ваш API-ключ otask',
      '/unlink — отвязать ключ',
    ].join('\n'),
  );
});

bot.command('link', async (ctx) => {
  const key = ctx.match.trim();
  if (!key) {
    await ctx.reply('Использование: <code>/link ВАШ_API_КЛЮЧ</code>', { parse_mode: 'HTML' });
    return;
  }
  // Пробуем ключ перед сохранением.
  try {
    await new OtaskClient(key).ping();
  } catch (e) {
    await ctx.reply(`Не удалось проверить ключ.\n${reportError(e)}`);
    return;
  }
  await store.setApiKey(ctx.chat.id, key);
  // Подчищаем сообщение с ключом из истории чата (best-effort).
  try {
    await ctx.deleteMessage();
  } catch {
    /* нет прав на удаление — не критично */
  }
  await ctx.reply('✅ Ключ привязан и проверен. Напоминания включены. Команда /tasks покажет ваши задачи.');
});

bot.command('unlink', async (ctx) => {
  await store.clearApiKey(ctx.chat.id);
  await ctx.reply('Ключ отвязан. Привяжите новый через /link, когда понадобится.');
});

bot.command('reminders', async (ctx) => {
  const arg = ctx.match.trim().toLowerCase();
  if (arg !== 'on' && arg !== 'off') {
    await ctx.reply('Использование: <code>/reminders on</code> или <code>/reminders off</code>', {
      parse_mode: 'HTML',
    });
    return;
  }
  await store.setReminders(ctx.chat.id, arg === 'on');
  await ctx.reply(arg === 'on' ? '🔔 Напоминания включены.' : '🔕 Напоминания выключены.');
});

bot.command('tasks', async (ctx) => {
  const client = await clientFor(ctx.chat.id);
  if (!client) return void ctx.reply(await needKeyMessage(), { parse_mode: 'HTML' });
  try {
    const tasks = (await client.listAssignedTasks()).filter((t) => !t.done);
    for (const msg of formatTaskList('📋 Назначенные задачи', tasks)) {
      await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }
  } catch (e) {
    await ctx.reply(reportError(e));
  }
});

bot.command('overdue', async (ctx) => {
  const client = await clientFor(ctx.chat.id);
  if (!client) return void ctx.reply(await needKeyMessage(), { parse_mode: 'HTML' });
  try {
    const now = new Date();
    const tasks = (await client.listAssignedTasks()).filter((t) => isOverdue(t, now));
    for (const msg of formatTaskList('⚠️ Просроченные задачи', tasks, now)) {
      await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }
  } catch (e) {
    await ctx.reply(reportError(e));
  }
});

bot.command('soon', async (ctx) => {
  const client = await clientFor(ctx.chat.id);
  if (!client) return void ctx.reply(await needKeyMessage(), { parse_mode: 'HTML' });
  try {
    const now = new Date();
    const horizon = now.getTime() + config.reminderLeadHours * 3600_000;
    const tasks = (await client.listAssignedTasks()).filter(
      (t) => !t.done && t.deadline && !isOverdue(t, now) && new Date(t.deadline).getTime() <= horizon,
    );
    const title = `⏰ Дедлайн в ближайшие ${config.reminderLeadHours} ч`;
    for (const msg of formatTaskList(title, tasks, now)) {
      await ctx.reply(msg, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }
  } catch (e) {
    await ctx.reply(reportError(e));
  }
});

bot.command('task', async (ctx) => {
  const id = ctx.match.trim();
  if (!id) return void ctx.reply('Использование: <code>/task ID_задачи</code>', { parse_mode: 'HTML' });
  const client = await clientFor(ctx.chat.id);
  if (!client) return void ctx.reply(await needKeyMessage(), { parse_mode: 'HTML' });
  try {
    const task = await client.getTask(id);
    await ctx.reply(formatTaskCard(task), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    await ctx.reply(reportError(e));
  }
});

// ── Создание задачи ─────────────────────────────────────────────────────────

bot.command('new', async (ctx) => {
  const client = await clientFor(ctx.chat.id);
  if (!client) return void ctx.reply(await needKeyMessage(), { parse_mode: 'HTML' });

  const inline = ctx.match.trim();
  if (inline) {
    // Однострочный синтаксис: Заголовок | описание | срок | приоритет
    const parsed = parseInlineTask(inline);
    if (!parsed.title) {
      await ctx.reply('Нужен хотя бы заголовок: <code>/new Сделать отчёт</code>', { parse_mode: 'HTML' });
      return;
    }
    await submitTask(ctx.chat.id, parsed, (text, kb) =>
      ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } }),
    );
    return;
  }

  wizards.set(ctx.chat.id, { step: 'title', draft: { title: '' } });
  await ctx.reply('📝 Новая задача. Введите <b>заголовок</b> (или /cancel для отмены):', {
    parse_mode: 'HTML',
  });
});

bot.command('cancel', async (ctx) => {
  if (wizards.delete(ctx.chat.id)) await ctx.reply('Отменено.');
  else await ctx.reply('Нечего отменять.');
});

// Шаги мастера обрабатываем как обычный текст.
bot.on('message:text', async (ctx) => {
  const wiz = wizards.get(ctx.chat.id);
  if (!wiz) return; // не в мастере — игнорируем
  const text = ctx.message.text.trim();

  switch (wiz.step) {
    case 'title':
      wiz.draft.title = text;
      wiz.step = 'description';
      await ctx.reply('Введите <b>описание</b> (или «-» чтобы пропустить):', { parse_mode: 'HTML' });
      break;
    case 'description':
      if (text !== '-') wiz.draft.description = text;
      wiz.step = 'deadline';
      await ctx.reply(
        'Укажите <b>срок</b> в формате <code>ГГГГ-ММ-ДД ЧЧ:ММ</code> (или «-» чтобы пропустить):',
        { parse_mode: 'HTML' },
      );
      break;
    case 'deadline': {
      if (text !== '-') {
        const iso = parseDeadline(text);
        if (!iso) {
          await ctx.reply('Не понял дату. Пример: <code>2026-06-10 18:00</code>. Попробуйте ещё раз или «-».', {
            parse_mode: 'HTML',
          });
          return;
        }
        wiz.draft.deadline = iso;
      }
      wiz.step = 'priority';
      await ctx.reply('Приоритет: low / normal / high / critical (или «-» для обычного):');
      break;
    }
    case 'priority': {
      if (text !== '-') wiz.draft.priority = parsePriority(text);
      wizards.delete(ctx.chat.id);
      await submitTask(ctx.chat.id, wiz.draft, (t, kb) =>
        ctx.reply(t, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } }),
      );
      break;
    }
  }
});

async function submitTask(
  chatId: number,
  draft: CreateTaskInput,
  reply: (text: string, kb?: InlineKeyboard) => Promise<unknown>,
): Promise<void> {
  const client = await clientFor(chatId);
  if (!client) {
    await reply(await needKeyMessage());
    return;
  }
  try {
    const task = await client.createTask(draft);
    const kb = task.url ? new InlineKeyboard().url('Открыть в otask', task.url) : undefined;
    await reply(`✅ Задача создана:\n\n${formatTaskCard(task)}`, kb);
  } catch (e) {
    await reply(reportError(e));
  }
}

// ── Парсинг пользовательского ввода ─────────────────────────────────────────

function parseInlineTask(s: string): CreateTaskInput {
  const [title, description, deadline, priority] = s.split('|').map((p) => p.trim());
  const draft: CreateTaskInput = { title: title || '' };
  if (description) draft.description = description;
  if (deadline) {
    const iso = parseDeadline(deadline);
    if (iso) draft.deadline = iso;
  }
  if (priority) draft.priority = parsePriority(priority);
  return draft;
}

function parsePriority(s: string): Priority {
  const v = s.toLowerCase().trim();
  if (['critical', 'критич', 'urgent', 'срочно'].some((k) => v.includes(k))) return 'critical';
  if (['high', 'высок', 'важн'].some((k) => v.includes(k))) return 'high';
  if (['low', 'низк'].some((k) => v.includes(k))) return 'low';
  return 'normal';
}

/** Принимает «2026-06-10 18:00», «2026-06-10», «10.06.2026 18:00». Возвращает ISO или undefined. */
function parseDeadline(s: string): string | undefined {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h = '09', mi = '00'] = m;
    return buildIso(+y, +mo, +d, +h, +mi);
  }
  m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (m) {
    const [, d, mo, y, h = '09', mi = '00'] = m;
    return buildIso(+y, +mo, +d, +h, +mi);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function buildIso(y: number, mo: number, d: number, h: number, mi: number): string | undefined {
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

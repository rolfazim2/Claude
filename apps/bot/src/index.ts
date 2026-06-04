// TaskFlow Telegram-бот — скелет (grammY).
// Основной канал работы: меню, задачи, смена статуса, доказательства, напоминания.
// Дальше: связь с API, авторизация, материализация повторений, проект = группа/канал (UTasks).
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { STATUS_META, KANBAN_COLUMNS } from '@taskflow/shared';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан. Укажите токен бота в переменных окружения.');
  process.exit(1);
}

const bot = new Bot(token);

// Главное меню (дублирует функционал сайта в упрощённом виде).
const mainMenu = new Keyboard()
  .text('📋 Мои задачи').text('📥 Входящие').row()
  .text('➕ Создать задачу').text('💬 Комментарий')
  .resized();

bot.command('start', (ctx) =>
  ctx.reply('Привет! Это TaskFlow. Управляйте задачами прямо из Telegram.', {
    reply_markup: mainMenu,
  }),
);

bot.hears('📋 Мои задачи', (ctx) => ctx.reply('Список ваших задач (заглушка). Подключим API.'));
bot.hears('📥 Входящие', (ctx) => ctx.reply('Ваши уведомления (заглушка).'));
bot.hears('➕ Создать задачу', (ctx) => ctx.reply('Мастер создания задачи (заглушка).'));

// Пример инлайн-кнопок действий по задаче.
function taskActions(taskId: string) {
  const kb = new InlineKeyboard()
    .text('✅ Выполнено', `done:${taskId}`)
    .text('🔄 Сменить статус', `status:${taskId}`).row()
    .text('📅 Перенести', `move:${taskId}`)
    .text('📎 Доказательство', `proof:${taskId}`);
  return kb;
}

bot.callbackQuery(/^status:(.+)$/, async (ctx) => {
  const kb = new InlineKeyboard();
  for (const s of KANBAN_COLUMNS) kb.text(STATUS_META[s].label, `set:${ctx.match[1]}:${s}`).row();
  await ctx.reply('Выберите статус:', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

export { bot, taskActions };

bot.start();
console.log('TaskFlow bot запущен.');

import { bot } from './bot.js';
import { startReminders } from './reminders.js';

async function main() {
  // Планировщик напоминаний работает в фоне рядом с поллингом бота.
  const stopReminders = startReminders(bot);

  bot.catch((err) => {
    console.error('[bot] ошибка обработчика:', err.error);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nПолучен ${signal}, останавливаюсь…`);
    stopReminders();
    await bot.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('otask-bot запущен. Ожидаю сообщения…');
  await bot.start({
    onStart: (info) => console.log(`Авторизован как @${info.username}`),
    allowed_updates: ['message', 'callback_query'],
  });
}

main().catch((e) => {
  console.error('Фатальная ошибка запуска:', e);
  process.exit(1);
});

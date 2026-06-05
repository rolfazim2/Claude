// Отправка сообщений в Telegram напрямую через Bot API (для уведомлений/напоминаний).
// Работает, если задан BOT_TOKEN и есть сетевой доступ к api.telegram.org.
const TOKEN = process.env.BOT_TOKEN;

export function telegramEnabled(): boolean {
  return !!TOKEN;
}

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  if (!TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('sendTelegram error', e);
  }
}

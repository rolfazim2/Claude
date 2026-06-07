import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Не задана обязательная переменная окружения ${name} (см. .env.example)`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  apiBase: (process.env.OTASK_API_BASE || 'https://api.otask.ru').replace(/\/+$/, ''),
  /** Общий ключ по умолчанию (необязательно). Пустая строка означает «нет». */
  defaultApiKey: process.env.OTASK_API_KEY || '',
  dataDir: process.env.DATA_DIR || './data',
  reminderLeadHours: num('REMINDER_LEAD_HOURS', 24),
  reminderPollMinutes: num('REMINDER_POLL_MINUTES', 15),
};

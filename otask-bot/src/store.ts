import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';

/**
 * Простое файловое хранилище (JSON). Достаточно для одного инстанса бота.
 * Для прод-нагрузки замените на БД, сохранив интерфейс.
 */
interface UserRecord {
  /** API-ключ otask, привязанный пользователем через /link. */
  apiKey?: string;
  /** Получать ли напоминания о дедлайнах. */
  remindersEnabled: boolean;
  /** id задач, по которым напоминание о дедлайне уже отправлено. */
  remindedDeadline: string[];
  /** id задач, по которым уже сообщили о просрочке. */
  remindedOverdue: string[];
}

interface DbShape {
  users: Record<string, UserRecord>;
}

const filePath = join(config.dataDir, 'store.json');
let db: DbShape = { users: {} };
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await readFile(filePath, 'utf8');
    db = JSON.parse(raw) as DbShape;
    if (!db.users) db.users = {};
  } catch {
    db = { users: {} };
  }
  loaded = true;
}

function persist(): Promise<void> {
  // Сериализуем записи, чтобы не было гонок при параллельных обновлениях.
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(db, null, 2), 'utf8');
  });
  return writeQueue;
}

function blankUser(): UserRecord {
  return { remindersEnabled: true, remindedDeadline: [], remindedOverdue: [] };
}

async function getOrCreate(chatId: number): Promise<UserRecord> {
  await ensureLoaded();
  const key = String(chatId);
  if (!db.users[key]) db.users[key] = blankUser();
  return db.users[key];
}

export const store = {
  /** Эффективный API-ключ: личный ключ пользователя или общий из конфига. */
  async getApiKey(chatId: number): Promise<string | undefined> {
    const u = await getOrCreate(chatId);
    return u.apiKey || config.defaultApiKey || undefined;
  },

  async hasOwnKey(chatId: number): Promise<boolean> {
    const u = await getOrCreate(chatId);
    return Boolean(u.apiKey);
  },

  async setApiKey(chatId: number, apiKey: string): Promise<void> {
    const u = await getOrCreate(chatId);
    u.apiKey = apiKey;
    await persist();
  },

  async clearApiKey(chatId: number): Promise<void> {
    const u = await getOrCreate(chatId);
    delete u.apiKey;
    await persist();
  },

  async setReminders(chatId: number, enabled: boolean): Promise<void> {
    const u = await getOrCreate(chatId);
    u.remindersEnabled = enabled;
    await persist();
  },

  /** Все чаты, у которых включены напоминания и есть доступ к API. */
  async chatsForReminders(): Promise<number[]> {
    await ensureLoaded();
    const out: number[] = [];
    for (const [key, u] of Object.entries(db.users)) {
      if (u.remindersEnabled && (u.apiKey || config.defaultApiKey)) out.push(Number(key));
    }
    return out;
  },

  /** Помечаем напоминание отправленным; возвращает true, если это новое (ещё не слали). */
  async markReminded(chatId: number, taskId: string, kind: 'deadline' | 'overdue'): Promise<boolean> {
    const u = await getOrCreate(chatId);
    const list = kind === 'deadline' ? u.remindedDeadline : u.remindedOverdue;
    if (list.includes(taskId)) return false;
    list.push(taskId);
    // Не даём спискам расти бесконечно.
    if (list.length > 1000) list.splice(0, list.length - 1000);
    await persist();
    return true;
  },

  /** Сброс отметки (например, когда дедлайн задачи изменился и снова в будущем). */
  async clearReminded(chatId: number, taskId: string, kind: 'deadline' | 'overdue'): Promise<void> {
    const u = await getOrCreate(chatId);
    const list = kind === 'deadline' ? u.remindedDeadline : u.remindedOverdue;
    const i = list.indexOf(taskId);
    if (i >= 0) {
      list.splice(i, 1);
      await persist();
    }
  },
};

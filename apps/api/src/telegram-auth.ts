// Telegram-авторизация: одноразовые коды входа.
// Веб создаёт код → пользователь открывает бота по deep-link → бот подтверждает
// код через защищённый секретом эндпоинт → веб опрашивает статус и логинится.
// Сессии хранятся в памяти (для прод-многоинстансовости вынести в Redis/БД).
import { randomBytes } from 'node:crypto';

export type LoginSession = {
  code: string;
  status: 'pending' | 'confirmed';
  userId?: string;
  createdAt: number;
};

const sessions = new Map<string, LoginSession>();
const TTL_MS = 5 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [code, s] of sessions) if (now - s.createdAt > TTL_MS) sessions.delete(code);
}

export function createLoginSession(): string {
  gc();
  const code = randomBytes(4).toString('hex'); // 8 hex-символов
  sessions.set(code, { code, status: 'pending', createdAt: Date.now() });
  return code;
}

export function getLoginSession(code: string): LoginSession | null {
  const s = sessions.get(code);
  if (!s) return null;
  if (Date.now() - s.createdAt > TTL_MS) {
    sessions.delete(code);
    return null;
  }
  return s;
}

export function confirmLoginSession(code: string, userId: string): boolean {
  const s = getLoginSession(code);
  if (!s) return false;
  s.status = 'confirmed';
  s.userId = userId;
  return true;
}

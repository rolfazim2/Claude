// Авторизация по подписанным токенам (HMAC-SHA256, формат userId.exp.signature).
// Токен выдаётся при входе (через Telegram или демо-вход) и передаётся в
// Authorization: Bearer. Заголовок X-User-Id принимается только вне production
// (удобство локальной отладки curl'ом) — в проде он отключён.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';

const SECRET = process.env.APP_SECRET || 'dev-app-secret-change-me';
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 дней

if (process.env.NODE_ENV === 'production' && !process.env.APP_SECRET) {
  console.warn('⚠️  APP_SECRET не задан — используется небезопасный дефолт. Задайте APP_SECRET в окружении.');
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function signToken(userId: string): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const expected = sign(`${userId}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now()) return null;
  return userId;
}

export async function getCurrentUser(req: FastifyRequest) {
  // 1) Bearer-токен — основной путь.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const userId = verifyToken(authHeader.slice(7).trim());
    if (userId) return prisma.user.findUnique({ where: { id: userId } });
  }
  // 2) X-User-Id — только вне production (локальная отладка).
  if (process.env.NODE_ENV !== 'production') {
    const id = (req.headers['x-user-id'] as string | undefined)?.trim();
    if (id) return prisma.user.findUnique({ where: { id } });
  }
  return null;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await getCurrentUser(req);
  if (!user) {
    reply.code(401).send({ error: 'Не авторизован' });
    return null;
  }
  return user;
}

// Временная авторизация: текущий пользователь определяется заголовком X-User-Id
// (вход-выбор сотрудника). В финале заменяется на вход через Telegram + JWT.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';

export async function getCurrentUser(req: FastifyRequest) {
  const id = (req.headers['x-user-id'] as string | undefined)?.trim();
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await getCurrentUser(req);
  if (!user) {
    reply.code(401).send({ error: 'Не авторизован' });
    return null;
  }
  return user;
}

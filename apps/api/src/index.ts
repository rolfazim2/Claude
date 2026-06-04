// TaskFlow API (Fastify + Prisma + PostgreSQL).
// Реальные CRUD, права/видимость по ролям, запрет удаления, real-time через WebSocket.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { prisma } from './db.js';
import { getCurrentUser, requireUser } from './auth.js';
import { canCreateForOthers, taskVisibilityWhere } from './visibility.js';
import { addClient, broadcast } from './realtime.js';
import { nextOccurrence, startScheduler } from './scheduler.js';
import { generateDescription } from './ai.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(websocket);

const taskInclude = {
  participants: true,
  comments: { orderBy: { createdAt: 'asc' as const } },
  attachments: { orderBy: { createdAt: 'asc' as const } },
};

function serializeTask(t: any) {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? undefined,
    projectId: t.projectId,
    functionId: t.functionId ?? undefined,
    parentTaskId: t.parentTaskId ?? null,
    assigneeId: t.assigneeId ?? undefined,
    creatorId: t.creatorId,
    participantIds: (t.participants ?? []).map((p: any) => p.userId),
    priority: t.priority,
    status: t.status,
    dueAt: t.dueAt ? t.dueAt.toISOString() : undefined,
    recurrence:
      t.recurrenceFreq && t.recurrenceFreq !== 'none'
        ? {
            freq: t.recurrenceFreq,
            interval: t.recurrenceInterval ?? undefined,
            timeOfDay: t.recurrenceTime ?? undefined,
            date: t.recurrenceDate ? t.recurrenceDate.toISOString() : undefined,
          }
        : undefined,
    proofRequired: t.proofRequired,
    customFields: t.customFields ?? {},
    comments: (t.comments ?? []).map((c: any) => ({
      id: c.id,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    attachments: (t.attachments ?? []).map((a: any) => ({
      id: a.id,
      kind: a.kind,
      format: a.format,
      value: a.value,
      authorId: a.authorId,
      createdAt: a.createdAt.toISOString(),
    })),
    activity: [],
    createdAt: t.createdAt.toISOString(),
    archived: t.archived,
  };
}

app.get('/health', async () => ({ ok: true, service: 'taskflow-api' }));

// --- Auth (временный вход-выбор) ---
app.get('/auth/users', async () => {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { fullName: 'asc' } });
  return users;
});

app.get('/me', async (req, reply) => {
  const me = await getCurrentUser(req);
  if (!me) return reply.code(401).send({ error: 'Не авторизован' });
  return me;
});

// Всё необходимое для оболочки приложения.
app.get('/bootstrap', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const [users, functions, projects] = await Promise.all([
    prisma.user.findMany({ orderBy: { fullName: 'asc' } }),
    prisma.function.findMany({ where: { archived: false } }),
    prisma.project.findMany({ where: { archived: false }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { me, users, functions, projects };
});

// --- Tasks ---
app.get('/tasks', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { projectId } = req.query as { projectId?: string };
  const where = taskVisibilityWhere(me.id, me.role);
  const tasks = await prisma.task.findMany({
    where: { AND: [where, { archived: false }, projectId ? { projectId } : {}] },
    include: taskInclude,
    orderBy: { createdAt: 'desc' },
  });
  return tasks.map(serializeTask);
});

app.get('/tasks/:id', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { id } = req.params as { id: string };
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) return reply.code(404).send({ error: 'Не найдено' });
  return serializeTask(task);
});

app.post('/tasks', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const b = req.body as any;
  const assigneeId = b.assigneeId ?? me.id;
  // Право: задачу другим/в проект может ставить только админ/руководитель.
  if (assigneeId !== me.id && !canCreateForOthers(me.role)) {
    return reply.code(403).send({ error: 'Недостаточно прав ставить задачи другим' });
  }
  const task = await prisma.task.create({
    data: {
      title: b.title,
      description: b.description ?? null,
      projectId: b.projectId,
      functionId: b.functionId ?? null,
      parentTaskId: b.parentTaskId ?? null,
      assigneeId,
      creatorId: me.id,
      priority: b.priority ?? 'medium',
      status: b.status ?? 'to_do',
      dueAt: b.dueAt ? new Date(b.dueAt) : null,
      proofRequired: !!b.proofRequired,
      recurrenceFreq: b.recurrenceFreq ?? 'none',
      participants: b.participantIds?.length
        ? { create: b.participantIds.map((userId: string) => ({ userId })) }
        : undefined,
    },
    include: taskInclude,
  });
  await prisma.activityEntry.create({
    data: { taskId: task.id, actorId: me.id, action: 'создал задачу' },
  });
  if (assigneeId !== me.id) {
    await prisma.notification.create({
      data: { userId: assigneeId, taskId: task.id, type: 'assigned' },
    });
    broadcast({ type: 'notification.created', userId: assigneeId });
  }
  broadcast({ type: 'task.created', taskId: task.id });
  return serializeTask(task);
});

app.patch('/tasks/:id', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { id } = req.params as { id: string };
  const b = req.body as any;
  const existing = await prisma.task.findUnique({ where: { id }, include: { attachments: true } });
  if (!existing) return reply.code(404).send({ error: 'Не найдено' });

  // Запрет закрытия без доказательства, если требуется.
  if (b.status === 'done' && existing.proofRequired) {
    const hasProof = existing.attachments.some((a) => a.kind === 'completion_proof');
    if (!hasProof) {
      return reply.code(422).send({ error: 'Нельзя закрыть: требуется доказательство выполнения' });
    }
  }

  const data: any = {};
  for (const k of ['title', 'description', 'priority', 'functionId', 'proofRequired', 'archived'] as const) {
    if (k in b) data[k] = b[k];
  }
  if ('assigneeId' in b) data.assigneeId = b.assigneeId;
  if ('dueAt' in b) data.dueAt = b.dueAt ? new Date(b.dueAt) : null;
  if ('status' in b) data.status = b.status;

  const task = await prisma.task.update({ where: { id }, data, include: taskInclude });

  if (b.status && b.status !== existing.status) {
    await prisma.activityEntry.create({
      data: { taskId: id, actorId: me.id, action: `статус → ${b.status}` },
    });
    if (existing.assigneeId && existing.assigneeId !== me.id) {
      await prisma.notification.create({
        data: { userId: existing.assigneeId, taskId: id, type: 'status_changed' },
      });
      broadcast({ type: 'notification.created', userId: existing.assigneeId });
    }

    // Повторяющаяся задача закрыта → создаём следующий экземпляр.
    if (b.status === 'done' && existing.recurrenceFreq && existing.recurrenceFreq !== 'none') {
      const base = existing.dueAt ?? new Date();
      const due = nextOccurrence(existing.recurrenceFreq, base, existing.recurrenceInterval ?? 1);
      if (due) {
        const next = await prisma.task.create({
          data: {
            title: existing.title,
            description: existing.description,
            projectId: existing.projectId,
            functionId: existing.functionId,
            assigneeId: existing.assigneeId,
            creatorId: existing.creatorId,
            priority: existing.priority,
            status: 'to_do',
            dueAt: due,
            proofRequired: existing.proofRequired,
            recurrenceFreq: existing.recurrenceFreq,
            recurrenceInterval: existing.recurrenceInterval,
            recurrenceTime: existing.recurrenceTime,
          },
        });
        // Закрытый экземпляр больше не повторяется.
        await prisma.task.update({ where: { id }, data: { recurrenceFreq: 'none' } });
        broadcast({ type: 'task.created', taskId: next.id });
        if (existing.assigneeId) broadcast({ type: 'notification.created', userId: existing.assigneeId });
      }
    }
  }
  broadcast({ type: 'task.updated', taskId: id });
  return serializeTask(task);
});

app.post('/tasks/:id/comments', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { id } = req.params as { id: string };
  const { body } = req.body as { body: string };
  await prisma.comment.create({ data: { taskId: id, authorId: me.id, body } });
  const task = await prisma.task.findUnique({ where: { id }, include: { participants: true } });
  const recipients = new Set<string>();
  if (task?.assigneeId) recipients.add(task.assigneeId);
  if (task?.creatorId) recipients.add(task.creatorId);
  task?.participants.forEach((p) => recipients.add(p.userId));
  recipients.delete(me.id);
  for (const userId of recipients) {
    await prisma.notification.create({ data: { userId, taskId: id, type: 'commented' } });
    broadcast({ type: 'notification.created', userId });
  }
  broadcast({ type: 'task.updated', taskId: id });
  const updated = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  return serializeTask(updated);
});

app.post('/tasks/:id/attachments', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { id } = req.params as { id: string };
  const b = req.body as { kind?: string; format: string; value: string };
  await prisma.attachment.create({
    data: {
      taskId: id,
      kind: (b.kind as any) ?? 'attachment',
      format: b.format as any,
      value: b.value,
      authorId: me.id,
    },
  });
  broadcast({ type: 'task.updated', taskId: id });
  const updated = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  return serializeTask(updated);
});

// --- AI (ChatPRD/описания) ---
app.post('/ai/describe', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const b = req.body as { title: string; projectName?: string; functionName?: string };
  if (!b.title?.trim()) return reply.code(400).send({ error: 'Нужен заголовок' });
  const description = await generateDescription(b);
  return { description };
});

// --- Notifications ---
app.get('/notifications', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  return prisma.notification.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: 'desc' },
  });
});

app.post('/notifications/:id/read', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { id } = req.params as { id: string };
  await prisma.notification.update({ where: { id }, data: { read: true } });
  return { ok: true };
});

// --- Reports ---
app.get('/reports/summary', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const where = { AND: [taskVisibilityWhere(me.id, me.role), { archived: false }] };
  const tasks = await prisma.task.findMany({
    where,
    select: { status: true, dueAt: true, assigneeId: true },
  });
  const now = Date.now();
  const byStatus: Record<string, number> = {};
  const overdueByUser: Record<string, number> = {};
  let overdue = 0;
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const isOver =
      t.dueAt && t.dueAt.getTime() < now && t.status !== 'done' && t.status !== 'canceled';
    if (isOver) {
      overdue++;
      if (t.assigneeId) overdueByUser[t.assigneeId] = (overdueByUser[t.assigneeId] ?? 0) + 1;
    }
  }
  return { total: tasks.length, byStatus, overdue, overdueByUser };
});

// --- Real-time ---
app.get('/ws', { websocket: true }, (socket) => {
  addClient(socket);
});

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`API on :${port}`);
    startScheduler();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

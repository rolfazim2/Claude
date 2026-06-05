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
import { generateDescription, chatAnswer, generateSubtasks } from './ai.js';
import {
  createLoginSession,
  getLoginSession,
  confirmLoginSession,
  createProjectLinkCode,
  resolveProjectLinkCode,
} from './telegram-auth.js';
import { sendTelegram } from './telegram.js';

const STATUS_LABELS: Record<string, string> = {
  to_do: 'Взять в работу',
  in_progress: 'В работе',
  on_hold: 'Отложено',
  blocked: 'Возникли трудности',
  done: 'Выполнено',
  canceled: 'Отменено',
};

// Зеркалирование событий задачи в привязанную Telegram-группу проекта.
async function notifyProjectChat(projectId: string | null | undefined, text: string) {
  if (!projectId) return;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (project?.telegramChatId) await sendTelegram(project.telegramChatId, text);
}

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

// --- Auth через Telegram ---
const BOT_SECRET = process.env.BOT_SHARED_SECRET || 'dev-secret';

app.post('/auth/telegram/init', async () => {
  const code = createLoginSession();
  const botUsername = process.env.BOT_USERNAME || '';
  return {
    code,
    botUsername: botUsername || null,
    deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null,
  };
});

app.get('/auth/telegram/status', async (req) => {
  const { code } = req.query as { code?: string };
  const s = code ? getLoginSession(code) : null;
  if (!s) return { status: 'expired' };
  if (s.status === 'confirmed' && s.userId) {
    const user = await prisma.user.findUnique({ where: { id: s.userId } });
    return { status: 'confirmed', user };
  }
  return { status: 'pending' };
});

// Вызывается БОТОМ (защищено общим секретом).
app.post('/auth/telegram/confirm', async (req, reply) => {
  if (req.headers['x-bot-secret'] !== BOT_SECRET) return reply.code(401).send({ error: 'bad secret' });
  const b = req.body as { code: string; tgId: string | number; firstName?: string; username?: string };
  const s = getLoginSession(b.code);
  if (!s) return reply.code(400).send({ error: 'Код истёк или неверен' });

  const tgId = String(b.tgId);
  let user = await prisma.user.findUnique({ where: { telegramId: tgId } });
  if (!user) {
    const colors = ['#5e6ad2', '#27ae60', '#f2994a', '#eb5757', '#4ea7fc', '#9b51e0'];
    user = await prisma.user.create({
      data: {
        fullName: b.firstName || b.username || 'Пользователь Telegram',
        position: 'Сотрудник',
        role: 'member',
        telegramId: tgId,
        telegramUsername: b.username ?? null,
        avatarColor: colors[Math.floor(Math.random() * colors.length)],
      },
    });
  } else if (b.username && user.telegramUsername !== b.username) {
    user = await prisma.user.update({ where: { id: user.id }, data: { telegramUsername: b.username } });
  }
  confirmLoginSession(b.code, user.id);
  return { ok: true, user };
});

// --- Привязка проекта к Telegram-группе ---
app.post('/projects/:id/telegram/init', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const { id } = req.params as { id: string };
  const code = createProjectLinkCode(id);
  const botUsername = process.env.BOT_USERNAME || '';
  return { code, botUsername: botUsername || null };
});

app.get('/projects/:id/telegram/status', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { id } = req.params as { id: string };
  const project = await prisma.project.findUnique({ where: { id } });
  return { linked: !!project?.telegramChatId, chatId: project?.telegramChatId ?? null };
});

app.post('/projects/:id/telegram/unlink', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const { id } = req.params as { id: string };
  await prisma.project.update({ where: { id }, data: { telegramChatId: null } });
  return { ok: true };
});

// Вызывается БОТОМ: /link <код> в группе.
app.post('/projects/telegram/confirm', async (req, reply) => {
  if (req.headers['x-bot-secret'] !== BOT_SECRET) return reply.code(401).send({ error: 'bad secret' });
  const b = req.body as { code: string; chatId: string | number; title?: string };
  const projectId = resolveProjectLinkCode(b.code);
  if (!projectId) return reply.code(400).send({ error: 'Код истёк или неверен' });
  const project = await prisma.project.update({
    where: { id: projectId },
    data: { telegramChatId: String(b.chatId) },
  });
  return { ok: true, projectName: project.name };
});

// Бот-API: задачи пользователя по telegramId (защищено секретом).
app.get('/bot/tasks', async (req, reply) => {
  if (req.headers['x-bot-secret'] !== BOT_SECRET) return reply.code(401).send({ error: 'bad secret' });
  const { tgId } = req.query as { tgId?: string };
  const user = tgId ? await prisma.user.findUnique({ where: { telegramId: String(tgId) } }) : null;
  if (!user) return reply.code(404).send({ error: 'not linked' });
  const tasks = await prisma.task.findMany({
    where: { AND: [taskVisibilityWhere(user.id, user.role), { archived: false, status: { notIn: ['done', 'canceled'] } }] },
    orderBy: [{ dueAt: 'asc' }],
    take: 30,
  });
  return { user: { fullName: user.fullName }, tasks: tasks.map(serializeTask) };
});

// Хелперы для бот-действий.
async function userByTg(tgId: unknown) {
  if (!tgId) return null;
  return prisma.user.findUnique({ where: { telegramId: String(tgId) } });
}
function canActOnTask(user: { id: string; role: string }, task: { assigneeId: string | null; creatorId: string | null; participants?: { userId: string }[] }) {
  if (user.role === 'super_admin' || user.role === 'process_lead') return true;
  if (task.assigneeId === user.id || task.creatorId === user.id) return true;
  return !!task.participants?.some((p) => p.userId === user.id);
}

// Смена статуса задачи из бота.
app.post('/bot/tasks/:id/status', async (req, reply) => {
  if (req.headers['x-bot-secret'] !== BOT_SECRET) return reply.code(401).send({ error: 'bad secret' });
  const { id } = req.params as { id: string };
  const b = req.body as { tgId: string | number; status: string };
  const user = await userByTg(b.tgId);
  if (!user) return reply.code(404).send({ error: 'not linked' });
  const task = await prisma.task.findUnique({ where: { id }, include: { attachments: true, participants: true } });
  if (!task) return reply.code(404).send({ error: 'Не найдено' });
  if (!canActOnTask(user, task)) return reply.code(403).send({ error: 'Нет доступа к задаче' });

  if (b.status === 'done' && task.proofRequired) {
    const hasProof = task.attachments.some((a) => a.kind === 'completion_proof');
    if (!hasProof) return reply.code(400).send({ error: 'needs_proof' });
  }

  await prisma.task.update({ where: { id }, data: { status: b.status as any } });
  await prisma.activityEntry.create({ data: { taskId: id, actorId: user.id, action: `статус → ${b.status}` } });
  await notifyProjectChat(task.projectId, `🔁 <b>${task.title}</b>: статус → ${STATUS_LABELS[b.status] ?? b.status}`);
  if (task.assigneeId && task.assigneeId !== user.id) {
    await prisma.notification.create({ data: { userId: task.assigneeId, taskId: id, type: 'status_changed' } });
    broadcast({ type: 'notification.created', userId: task.assigneeId });
  }
  // Повторяющаяся задача закрыта → следующий экземпляр.
  if (b.status === 'done' && task.recurrenceFreq && task.recurrenceFreq !== 'none') {
    const due = nextOccurrence(task.recurrenceFreq, task.dueAt ?? new Date(), task.recurrenceInterval ?? 1);
    if (due) {
      const next = await prisma.task.create({
        data: {
          title: task.title, description: task.description, projectId: task.projectId, functionId: task.functionId,
          assigneeId: task.assigneeId, creatorId: task.creatorId, priority: task.priority, status: 'to_do',
          dueAt: due, proofRequired: task.proofRequired, recurrenceFreq: task.recurrenceFreq, recurrenceInterval: task.recurrenceInterval,
        },
      });
      await prisma.task.update({ where: { id }, data: { recurrenceFreq: 'none' } });
      broadcast({ type: 'task.created', taskId: next.id });
    }
  }
  broadcast({ type: 'task.updated', taskId: id });
  return { ok: true };
});

// Комментарий из бота.
app.post('/bot/tasks/:id/comment', async (req, reply) => {
  if (req.headers['x-bot-secret'] !== BOT_SECRET) return reply.code(401).send({ error: 'bad secret' });
  const { id } = req.params as { id: string };
  const b = req.body as { tgId: string | number; body: string };
  const user = await userByTg(b.tgId);
  if (!user) return reply.code(404).send({ error: 'not linked' });
  const task = await prisma.task.findUnique({ where: { id }, include: { participants: true } });
  if (!task) return reply.code(404).send({ error: 'Не найдено' });
  if (!canActOnTask(user, task)) return reply.code(403).send({ error: 'Нет доступа к задаче' });

  await prisma.comment.create({ data: { taskId: id, authorId: user.id, body: b.body } });
  const recipients = new Set<string>();
  if (task.assigneeId) recipients.add(task.assigneeId);
  if (task.creatorId) recipients.add(task.creatorId);
  task.participants.forEach((p) => recipients.add(p.userId));
  recipients.delete(user.id);
  for (const userId of recipients) {
    await prisma.notification.create({ data: { userId, taskId: id, type: 'commented' } });
    broadcast({ type: 'notification.created', userId });
  }
  await notifyProjectChat(task.projectId, `💬 ${user.fullName}: ${b.body}\n↪ ${task.title}`);
  broadcast({ type: 'task.updated', taskId: id });
  return { ok: true };
});

// Доказательство выполнения из бота.
app.post('/bot/tasks/:id/proof', async (req, reply) => {
  if (req.headers['x-bot-secret'] !== BOT_SECRET) return reply.code(401).send({ error: 'bad secret' });
  const { id } = req.params as { id: string };
  const b = req.body as { tgId: string | number; value: string };
  const user = await userByTg(b.tgId);
  if (!user) return reply.code(404).send({ error: 'not linked' });
  const task = await prisma.task.findUnique({ where: { id }, include: { participants: true } });
  if (!task) return reply.code(404).send({ error: 'Не найдено' });
  if (!canActOnTask(user, task)) return reply.code(403).send({ error: 'Нет доступа к задаче' });

  const format = /^https?:\/\//.test(b.value) ? 'link' : 'text';
  await prisma.attachment.create({
    data: { taskId: id, authorId: user.id, kind: 'completion_proof', format: format as any, value: b.value },
  });
  await prisma.activityEntry.create({ data: { taskId: id, actorId: user.id, action: 'приложено доказательство' } });
  broadcast({ type: 'task.updated', taskId: id });
  return { ok: true };
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
    prisma.project.findMany({ where: { archived: false }, orderBy: { createdAt: 'asc' }, include: { customFields: true } }),
  ]);
  return { me, users, functions, projects };
});

// --- Projects (управление) ---
app.post('/projects', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const b = req.body as any;
  return prisma.project.create({
    data: {
      type: b.type === 'process' ? 'process' : 'project',
      name: b.name,
      color: b.color ?? '#5e6ad2',
      leadId: b.leadId ?? null,
      telegramChatId: b.telegramChatId ?? null,
    },
  });
});

app.patch('/projects/:id', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const { id } = req.params as { id: string };
  const b = req.body as any;
  const data: any = {};
  for (const k of ['name', 'color', 'leadId', 'telegramChatId', 'archived'] as const) if (k in b) data[k] = b[k];
  return prisma.project.update({ where: { id }, data });
});

app.post('/projects/:id/fields', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const { id } = req.params as { id: string };
  const b = req.body as any;
  return prisma.customFieldDef.create({
    data: {
      projectId: id,
      name: b.name,
      type: b.type ?? 'text',
      options: Array.isArray(b.options) ? b.options : [],
    },
  });
});

// --- Functions (функциональная схема) ---
app.post('/functions', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const b = req.body as any;
  return prisma.function.create({
    data: {
      name: b.name,
      description: b.description ?? null,
      expectedResult: b.expectedResult ?? null,
      parentId: b.parentId ?? null,
      responsibleUserId: b.responsibleUserId ?? null,
    },
  });
});

app.patch('/functions/:id', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const { id } = req.params as { id: string };
  const b = req.body as any;
  const data: any = {};
  for (const k of ['name', 'description', 'expectedResult', 'parentId', 'responsibleUserId', 'archived'] as const)
    if (k in b) data[k] = b[k];
  return prisma.function.update({ where: { id }, data });
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
  await notifyProjectChat(task.projectId, `🆕 Новая задача: <b>${task.title}</b>`);
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
  if ('customFields' in b) data.customFields = b.customFields;

  const task = await prisma.task.update({ where: { id }, data, include: taskInclude });

  if (b.status && b.status !== existing.status) {
    await prisma.activityEntry.create({
      data: { taskId: id, actorId: me.id, action: `статус → ${b.status}` },
    });
    await notifyProjectChat(existing.projectId, `🔁 <b>${existing.title}</b>: статус → ${STATUS_LABELS[b.status] ?? b.status}`);
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
  await notifyProjectChat(task?.projectId, `💬 ${me.fullName}: ${body}\n↪ ${task?.title}`);
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

app.post('/ai/subtasks', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { title } = req.body as { title: string };
  if (!title?.trim()) return reply.code(400).send({ error: 'Нужен заголовок' });
  const subtasks = await generateSubtasks(title);
  return { subtasks };
});

app.post('/ai/chat', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  const { question } = req.body as { question: string };
  if (!question?.trim()) return reply.code(400).send({ error: 'Пустой вопрос' });
  const tasks = await prisma.task.findMany({
    where: { AND: [taskVisibilityWhere(me.id, me.role), { archived: false }] },
    select: { title: true, status: true, priority: true, dueAt: true },
    take: 200,
  });
  const answer = await chatAnswer(
    question,
    tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt ? t.dueAt.toISOString() : null })),
  );
  return { answer };
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

// --- Payments (платёжный календарь) ---
function serializePayment(p: any) {
  return {
    id: p.id,
    title: p.title,
    counterparty: p.counterparty ?? undefined,
    amount: p.amount,
    currency: p.currency,
    dueDate: p.dueDate.toISOString(),
    status: p.status,
    projectId: p.projectId ?? undefined,
    recurrenceFreq: p.recurrenceFreq,
    createdAt: p.createdAt.toISOString(),
  };
}

app.get('/payments', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  // Финансы видят только админ и руководители.
  if (me.role === 'member') return [];
  const items = await prisma.paymentEvent.findMany({ orderBy: { dueDate: 'asc' } });
  return items.map(serializePayment);
});

app.post('/payments', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const b = req.body as any;
  const p = await prisma.paymentEvent.create({
    data: {
      title: b.title,
      counterparty: b.counterparty ?? null,
      amount: Number(b.amount) || 0,
      currency: b.currency ?? 'RUB',
      dueDate: new Date(b.dueDate),
      status: b.status ?? 'planned',
      projectId: b.projectId ?? null,
      recurrenceFreq: b.recurrenceFreq ?? 'none',
    },
  });
  return serializePayment(p);
});

app.patch('/payments/:id', async (req, reply) => {
  const me = await requireUser(req, reply);
  if (!me) return;
  if (!canCreateForOthers(me.role)) return reply.code(403).send({ error: 'Недостаточно прав' });
  const { id } = req.params as { id: string };
  const b = req.body as any;
  const data: any = {};
  for (const k of ['title', 'counterparty', 'currency', 'status'] as const) if (k in b) data[k] = b[k];
  if ('amount' in b) data.amount = Number(b.amount);
  if ('dueDate' in b) data.dueDate = new Date(b.dueDate);
  const p = await prisma.paymentEvent.update({ where: { id }, data });
  return serializePayment(p);
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

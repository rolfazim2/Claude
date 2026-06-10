'use strict';

// Пространства — таск-менеджер: рабочие области с участниками
// и kanban-досками задач (todo / doing / done). Изменения рассылаются
// участникам пространства через WebSocket.

const { route, requireAuth, ApiError } = require('./api');
const { users, spaces, tasks } = require('./db');
const { publicUser } = require('./format');
const hub = require('./hub');

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

function publicTask(t) {
  return {
    id: Number(t.id),
    spaceId: Number(t.space_id),
    title: t.title,
    description: t.description || '',
    status: t.status,
    priority: t.priority,
    assigneeId: t.assignee_id ? Number(t.assignee_id) : null,
    assigneeName: t.assignee_name || null,
    assigneeAvatar: t.assignee_avatar ? `/files/${t.assignee_avatar}` : null,
    dueAt: t.due_at ? Number(t.due_at) : null,
    position: Number(t.position),
    createdBy: t.created_by ? Number(t.created_by) : null,
    createdAt: Number(t.created_at),
    updatedAt: Number(t.updated_at),
  };
}

function spaceView(s, forUserId) {
  const members = spaces.members(s.id).map(publicUser);
  const membership = spaces.member(s.id, forUserId);
  return {
    id: Number(s.id),
    name: s.name,
    description: s.description || '',
    members,
    myRole: (membership && membership.role) || s.role || 'member',
    openTasks: Number(s.open_tasks || 0),
    createdBy: s.created_by ? Number(s.created_by) : null,
  };
}

function requireSpaceMembership(spaceId, uid) {
  const space = spaces.byId(spaceId);
  if (!space) throw new ApiError(404, 'Пространство не найдено');
  const membership = spaces.member(spaceId, uid);
  if (!membership) throw new ApiError(403, 'Нет доступа к пространству');
  return { space, membership };
}

function broadcastToSpace(spaceId, event, exceptUserId = null) {
  for (const uid of spaces.memberIds(spaceId)) {
    if (uid !== exceptUserId) hub.sendTo(uid, event);
  }
}

function pushSpaceUpdate(spaceId) {
  const space = spaces.byId(spaceId);
  for (const uid of spaces.memberIds(spaceId)) {
    hub.sendTo(uid, { type: 'space_updated', space: spaceView(space, uid) });
  }
}

// ---- Пространства ----

route('GET', '/api/spaces', (req) => {
  const uid = requireAuth(req);
  return { spaces: spaces.listForUser(uid).map((s) => spaceView(s, uid)) };
});

route('POST', '/api/spaces', (req) => {
  const uid = requireAuth(req);
  const { name, description, memberIds } = req.body || {};
  const n = String(name || '').trim();
  if (!n || n.length > 64) throw new ApiError(400, 'Укажите название (до 64 символов)');
  const ids = [...new Set((memberIds || []).map(Number).filter((x) => x > 0 && x !== uid))];
  for (const id of ids) {
    if (!users.byId(id)) throw new ApiError(400, `Пользователь ${id} не найден`);
  }
  const spaceId = spaces.create(n, String(description || '').slice(0, 512), uid);
  spaces.addMember(spaceId, uid, 'owner');
  for (const id of ids) spaces.addMember(spaceId, id);
  const view = spaceView(spaces.byId(spaceId), uid);
  for (const id of ids) {
    hub.sendTo(id, { type: 'space_updated', space: spaceView(spaces.byId(spaceId), id) });
  }
  return { space: view };
});

route('PUT', '/api/spaces/:id', (req, params) => {
  const uid = requireAuth(req);
  const spaceId = Number(params.id);
  const { space, membership } = requireSpaceMembership(spaceId, uid);
  if (membership.role !== 'owner') throw new ApiError(403, 'Менять пространство может только владелец');
  const { name, description } = req.body || {};
  const n = String(name ?? space.name).trim();
  if (!n || n.length > 64) throw new ApiError(400, 'Название: 1–64 символа');
  spaces.update(spaceId, { name: n, description: String(description ?? space.description ?? '').slice(0, 512) });
  pushSpaceUpdate(spaceId);
  return { space: spaceView(spaces.byId(spaceId), uid) };
});

route('DELETE', '/api/spaces/:id', (req, params) => {
  const uid = requireAuth(req);
  const spaceId = Number(params.id);
  const { membership } = requireSpaceMembership(spaceId, uid);
  if (membership.role !== 'owner') throw new ApiError(403, 'Удалить пространство может только владелец');
  const memberIds = spaces.memberIds(spaceId);
  spaces.remove(spaceId);
  for (const id of memberIds) hub.sendTo(id, { type: 'space_removed', spaceId });
  return { ok: true };
});

// ---- Участники ----

route('POST', '/api/spaces/:id/members', (req, params) => {
  const uid = requireAuth(req);
  const spaceId = Number(params.id);
  requireSpaceMembership(spaceId, uid);
  const ids = [...new Set(((req.body || {}).userIds || []).map(Number))];
  for (const id of ids) {
    if (!users.byId(id)) throw new ApiError(400, `Пользователь ${id} не найден`);
  }
  for (const id of ids) spaces.addMember(spaceId, id);
  pushSpaceUpdate(spaceId);
  return { space: spaceView(spaces.byId(spaceId), uid) };
});

route('DELETE', '/api/spaces/:id/members/:userId', (req, params) => {
  const uid = requireAuth(req);
  const spaceId = Number(params.id);
  const targetId = Number(params.userId);
  const { membership } = requireSpaceMembership(spaceId, uid);
  if (targetId !== uid && membership.role !== 'owner') {
    throw new ApiError(403, 'Удалять участников может только владелец');
  }
  const target = spaces.member(spaceId, targetId);
  if (!target) throw new ApiError(404, 'Участник не найден');
  if (target.role === 'owner') throw new ApiError(403, 'Владельца нельзя удалить');
  spaces.removeMember(spaceId, targetId);
  hub.sendTo(targetId, { type: 'space_removed', spaceId });
  pushSpaceUpdate(spaceId);
  return { ok: true };
});

// ---- Задачи ----

route('GET', '/api/spaces/:id/tasks', (req, params) => {
  const uid = requireAuth(req);
  const spaceId = Number(params.id);
  requireSpaceMembership(spaceId, uid);
  return { tasks: tasks.listForSpace(spaceId).map(publicTask) };
});

function validateTaskFields(body, spaceId) {
  const out = {};
  if (body.title !== undefined) {
    out.title = String(body.title).trim();
    if (!out.title || out.title.length > 128) throw new ApiError(400, 'Название задачи: 1–128 символов');
  }
  if (body.description !== undefined) out.description = String(body.description).slice(0, 4096);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new ApiError(400, 'Статус: todo, doing или done');
    out.status = body.status;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) throw new ApiError(400, 'Приоритет: low, medium или high');
    out.priority = body.priority;
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId === null) out.assigneeId = null;
    else {
      const id = Number(body.assigneeId);
      if (!spaces.member(spaceId, id)) throw new ApiError(400, 'Исполнитель должен быть участником пространства');
      out.assigneeId = id;
    }
  }
  if (body.dueAt !== undefined) out.dueAt = body.dueAt === null ? null : Number(body.dueAt);
  if (body.position !== undefined) out.position = Number(body.position);
  return out;
}

route('POST', '/api/spaces/:id/tasks', (req, params) => {
  const uid = requireAuth(req);
  const spaceId = Number(params.id);
  requireSpaceMembership(spaceId, uid);
  const fields = validateTaskFields(req.body || {}, spaceId);
  if (!fields.title) throw new ApiError(400, 'Укажите название задачи');
  const task = publicTask(tasks.create(spaceId, uid, fields));
  broadcastToSpace(spaceId, { type: 'task_created', task }, uid);
  return { task };
});

route('PUT', '/api/tasks/:id', (req, params) => {
  const uid = requireAuth(req);
  const existing = tasks.byId(Number(params.id));
  if (!existing) throw new ApiError(404, 'Задача не найдена');
  const spaceId = Number(existing.space_id);
  requireSpaceMembership(spaceId, uid);
  const fields = validateTaskFields(req.body || {}, spaceId);
  const task = publicTask(tasks.update(Number(params.id), fields));
  broadcastToSpace(spaceId, { type: 'task_updated', task }, uid);
  return { task };
});

route('DELETE', '/api/tasks/:id', (req, params) => {
  const uid = requireAuth(req);
  const existing = tasks.byId(Number(params.id));
  if (!existing) throw new ApiError(404, 'Задача не найдена');
  const spaceId = Number(existing.space_id);
  requireSpaceMembership(spaceId, uid);
  tasks.remove(Number(params.id));
  broadcastToSpace(spaceId, {
    type: 'task_deleted', spaceId, taskId: Number(params.id),
  }, uid);
  return { ok: true };
});

'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.GRAM_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.GRAM_DB === ':memory:'
  ? ':memory:'
  : path.join(DATA_DIR, 'gram.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar_file   INTEGER,
    created_at    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK (type IN ('direct', 'group', 'channel')),
    title       TEXT,
    description TEXT NOT NULL DEFAULT '',
    avatar_file INTEGER,
    pinned_message_id INTEGER,
    created_by  INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id   INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    muted     INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    last_read INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id    INTEGER NOT NULL REFERENCES users(id),
    kind         TEXT NOT NULL DEFAULT 'text'
                 CHECK (kind IN ('text', 'image', 'video', 'voice', 'file')),
    text         TEXT NOT NULL DEFAULT '',
    file_id      INTEGER REFERENCES files(id),
    reply_to     INTEGER,
    forward_from TEXT,
    created_at   INTEGER NOT NULL,
    edited_at    INTEGER,
    deleted      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS bots (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_id    INTEGER REFERENCES users(id),
    token       TEXT NOT NULL UNIQUE,
    webhook_url TEXT,
    builtin     TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spaces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS space_members (
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    added_at INTEGER NOT NULL,
    PRIMARY KEY (space_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id    INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    assignee_id INTEGER REFERENCES users(id),
    due_at      INTEGER,
    position    REAL NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_space ON tasks(space_id, status, position);
  CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(message_id);
`);

// Лёгкая миграция: добавляем недостающие колонки в базы, созданные ранней версией
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('users', 'bio', "bio TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'avatar_file', 'avatar_file INTEGER');
ensureColumn('chats', 'description', "description TEXT NOT NULL DEFAULT ''");
ensureColumn('chats', 'avatar_file', 'avatar_file INTEGER');
ensureColumn('chats', 'pinned_message_id', 'pinned_message_id INTEGER');
ensureColumn('chat_members', 'role', "role TEXT NOT NULL DEFAULT 'member'");
ensureColumn('chat_members', 'muted', 'muted INTEGER NOT NULL DEFAULT 0');
ensureColumn('messages', 'kind', "kind TEXT NOT NULL DEFAULT 'text'");
ensureColumn('messages', 'file_id', 'file_id INTEGER');
ensureColumn('messages', 'reply_to', 'reply_to INTEGER');
ensureColumn('messages', 'forward_from', 'forward_from TEXT');
ensureColumn('users', 'is_bot', 'is_bot INTEGER NOT NULL DEFAULT 0');

const now = () => Date.now();

const MSG_SELECT = `
  SELECT m.*, u.username AS sender_username, u.name AS sender_name,
         u.avatar_file AS sender_avatar, u.is_bot AS sender_is_bot,
         f.name AS file_name, f.mime AS file_mime, f.size AS file_size
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN files f ON f.id = m.file_id
`;

const users = {
  create: (username, name, passwordHash, isBot = 0) =>
    db.prepare(
      'INSERT INTO users (username, name, password_hash, created_at, is_bot) VALUES (?, ?, ?, ?, ?)'
    ).run(username, name, passwordHash, now(), isBot ? 1 : 0),

  byUsername: (username) =>
    db.prepare('SELECT * FROM users WHERE username = ?').get(username),

  byId: (id) =>
    db.prepare(
      'SELECT id, username, name, bio, avatar_file, last_seen, is_bot FROM users WHERE id = ?'
    ).get(id),

  // Фильтрация в JS: LIKE в SQLite не учитывает регистр кириллицы
  search: (q, excludeId) => {
    const needle = String(q).toLowerCase();
    return db.prepare(
      'SELECT id, username, name, bio, avatar_file, last_seen, is_bot FROM users WHERE id != ? ORDER BY username'
    ).all(excludeId).filter((u) =>
      u.username.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle)
    ).slice(0, 20);
  },

  update: (id, { name, bio, avatarFile }) =>
    db.prepare('UPDATE users SET name = ?, bio = ?, avatar_file = ? WHERE id = ?')
      .run(name, bio, avatarFile, id),

  touch: (id) =>
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), id),
};

const files = {
  create: (ownerId, name, mime, size) => {
    const res = db.prepare(
      'INSERT INTO files (owner_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(ownerId, name, mime, size, now());
    return Number(res.lastInsertRowid);
  },

  byId: (id) => db.prepare('SELECT * FROM files WHERE id = ?').get(id),
};

const chats = {
  create: (type, title, createdBy) => {
    const res = db.prepare(
      'INSERT INTO chats (type, title, created_by, created_at) VALUES (?, ?, ?, ?)'
    ).run(type, title, createdBy, now());
    return Number(res.lastInsertRowid);
  },

  byId: (id) => db.prepare('SELECT * FROM chats WHERE id = ?').get(id),

  update: (id, { title, description, avatarFile }) =>
    db.prepare('UPDATE chats SET title = ?, description = ?, avatar_file = ? WHERE id = ?')
      .run(title, description, avatarFile, id),

  setPinned: (id, messageId) =>
    db.prepare('UPDATE chats SET pinned_message_id = ? WHERE id = ?').run(messageId, id),

  addMember: (chatId, userId, role = 'member') =>
    db.prepare(
      'INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(chatId, userId, role, now()),

  removeMember: (chatId, userId) =>
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?')
      .run(chatId, userId),

  setRole: (chatId, userId, role) =>
    db.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?')
      .run(role, chatId, userId),

  setMuted: (chatId, userId, muted) =>
    db.prepare('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?')
      .run(muted ? 1 : 0, chatId, userId),

  members: (chatId) =>
    db.prepare(
      `SELECT u.id, u.username, u.name, u.bio, u.avatar_file, u.last_seen, u.is_bot, m.role, m.muted
       FROM chat_members m JOIN users u ON u.id = m.user_id
       WHERE m.chat_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`
    ).all(chatId),

  memberIds: (chatId) =>
    db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
      .all(chatId).map((r) => Number(r.user_id)),

  member: (chatId, userId) =>
    db.prepare(
      'SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?'
    ).get(chatId, userId),

  isMember: (chatId, userId) => !!chats.member(chatId, userId),

  // Существующий личный чат между двумя пользователями (если есть)
  findDirect: (a, b) =>
    db.prepare(
      `SELECT c.id FROM chats c
       JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = ?
       JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = ?
       WHERE c.type = 'direct' LIMIT 1`
    ).get(a, b),

  listForUser: (userId) =>
    db.prepare(
      `SELECT c.id, c.type, c.title, c.description, c.avatar_file,
              c.pinned_message_id, c.created_by, m.role, m.muted,
              (SELECT COUNT(*) FROM messages msg
                WHERE msg.chat_id = c.id AND msg.deleted = 0
                  AND msg.id > m.last_read AND msg.sender_id != ?) AS unread
       FROM chats c JOIN chat_members m ON m.chat_id = c.id
       WHERE m.user_id = ?`
    ).all(userId, userId),

  setLastRead: (chatId, userId, messageId) =>
    db.prepare(
      'UPDATE chat_members SET last_read = MAX(last_read, ?) WHERE chat_id = ? AND user_id = ?'
    ).run(messageId, chatId, userId),

  // Минимальный last_read среди остальных участников — до этого id сообщения «прочитано всеми»
  readByOthersUpTo: (chatId, userId) => {
    const row = db.prepare(
      'SELECT MIN(last_read) AS x FROM chat_members WHERE chat_id = ? AND user_id != ?'
    ).get(chatId, userId);
    return row && row.x != null ? Number(row.x) : 0;
  },
};

const messages = {
  create: (chatId, senderId, { kind = 'text', text = '', fileId = null, replyTo = null, forwardFrom = null }) => {
    const res = db.prepare(
      `INSERT INTO messages (chat_id, sender_id, kind, text, file_id, reply_to, forward_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(chatId, senderId, kind, text, fileId, replyTo, forwardFrom, now());
    return messages.byId(Number(res.lastInsertRowid));
  },

  byId: (id) => db.prepare(MSG_SELECT + ' WHERE m.id = ?').get(id),

  list: (chatId, before, limit) =>
    db.prepare(
      MSG_SELECT + ' WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?'
    ).all(chatId, before, limit).reverse(),

  last: (chatId) =>
    db.prepare(
      MSG_SELECT + ' WHERE m.chat_id = ? AND m.deleted = 0 ORDER BY m.id DESC LIMIT 1'
    ).get(chatId),

  // Поиск по тексту во всех чатах пользователя (регистронезависимо для юникода — в JS)
  search: (userId, q, limit = 30) => {
    const needle = String(q).toLowerCase();
    const rows = db.prepare(
      MSG_SELECT + `
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
       WHERE m.deleted = 0 AND m.text != ''
       ORDER BY m.id DESC LIMIT 2000`
    ).all(userId);
    return rows.filter((m) => m.text.toLowerCase().includes(needle)).slice(0, limit);
  },

  edit: (id, text) =>
    db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?')
      .run(text, now(), id),

  remove: (id) =>
    db.prepare("UPDATE messages SET deleted = 1, text = '', file_id = NULL WHERE id = ?").run(id),
};

const reactions = {
  // Возвращает true, если реакция добавлена, false — если снята
  toggle: (messageId, userId, emoji) => {
    const existing = db.prepare(
      'SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    ).get(messageId, userId, emoji);
    if (existing) {
      db.prepare(
        'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
      ).run(messageId, userId, emoji);
      return false;
    }
    db.prepare(
      'INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
    ).run(messageId, userId, emoji, now());
    return true;
  },

  forMessage: (messageId) =>
    db.prepare(
      `SELECT r.emoji, r.user_id, u.name FROM reactions r
       JOIN users u ON u.id = r.user_id WHERE r.message_id = ? ORDER BY r.created_at`
    ).all(messageId),
};

const bots = {
  create: (userId, ownerId, token, builtin = null) =>
    db.prepare(
      'INSERT INTO bots (user_id, owner_id, token, builtin, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, ownerId, token, builtin, now()),

  byUserId: (userId) =>
    db.prepare('SELECT * FROM bots WHERE user_id = ?').get(userId),

  byToken: (token) =>
    db.prepare('SELECT * FROM bots WHERE token = ?').get(token),

  byBuiltin: (builtin) =>
    db.prepare('SELECT * FROM bots WHERE builtin = ?').get(builtin),

  listByOwner: (ownerId) =>
    db.prepare(
      `SELECT b.*, u.username, u.name FROM bots b
       JOIN users u ON u.id = b.user_id WHERE b.owner_id = ?`
    ).all(ownerId),

  setWebhook: (userId, url) =>
    db.prepare('UPDATE bots SET webhook_url = ? WHERE user_id = ?').run(url, userId),

  remove: (userId) => {
    db.prepare('DELETE FROM bots WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM chat_members WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  },
};

const spaces = {
  create: (name, description, createdBy) => {
    const res = db.prepare(
      'INSERT INTO spaces (name, description, created_by, created_at) VALUES (?, ?, ?, ?)'
    ).run(name, description, createdBy, now());
    return Number(res.lastInsertRowid);
  },

  byId: (id) => db.prepare('SELECT * FROM spaces WHERE id = ?').get(id),

  update: (id, { name, description }) =>
    db.prepare('UPDATE spaces SET name = ?, description = ? WHERE id = ?')
      .run(name, description, id),

  remove: (id) => db.prepare('DELETE FROM spaces WHERE id = ?').run(id),

  addMember: (spaceId, userId, role = 'member') =>
    db.prepare(
      'INSERT OR IGNORE INTO space_members (space_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
    ).run(spaceId, userId, role, now()),

  removeMember: (spaceId, userId) =>
    db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?')
      .run(spaceId, userId),

  member: (spaceId, userId) =>
    db.prepare('SELECT * FROM space_members WHERE space_id = ? AND user_id = ?')
      .get(spaceId, userId),

  members: (spaceId) =>
    db.prepare(
      `SELECT u.id, u.username, u.name, u.bio, u.avatar_file, u.last_seen, u.is_bot, m.role
       FROM space_members m JOIN users u ON u.id = m.user_id
       WHERE m.space_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name`
    ).all(spaceId),

  memberIds: (spaceId) =>
    db.prepare('SELECT user_id FROM space_members WHERE space_id = ?')
      .all(spaceId).map((r) => Number(r.user_id)),

  listForUser: (userId) =>
    db.prepare(
      `SELECT s.*, m.role,
              (SELECT COUNT(*) FROM tasks t WHERE t.space_id = s.id AND t.status != 'done') AS open_tasks
       FROM spaces s JOIN space_members m ON m.space_id = s.id
       WHERE m.user_id = ? ORDER BY s.created_at`
    ).all(userId),
};

const tasks = {
  create: (spaceId, createdBy, { title, description = '', status = 'todo', priority = 'medium', assigneeId = null, dueAt = null }) => {
    const pos = db.prepare(
      'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE space_id = ? AND status = ?'
    ).get(spaceId, status).p;
    const res = db.prepare(
      `INSERT INTO tasks (space_id, title, description, status, priority, assignee_id, due_at, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(spaceId, title, description, status, priority, assigneeId, dueAt, Number(pos), createdBy, now(), now());
    return tasks.byId(Number(res.lastInsertRowid));
  },

  byId: (id) =>
    db.prepare(
      `SELECT t.*, u.name AS assignee_name, u.avatar_file AS assignee_avatar
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`
    ).get(id),

  listForSpace: (spaceId) =>
    db.prepare(
      `SELECT t.*, u.name AS assignee_name, u.avatar_file AS assignee_avatar
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.space_id = ? ORDER BY t.status, t.position`
    ).all(spaceId),

  update: (id, fields) => {
    const t = tasks.byId(id);
    db.prepare(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
        assignee_id = ?, due_at = ?, position = ?, updated_at = ? WHERE id = ?`
    ).run(
      fields.title ?? t.title,
      fields.description ?? t.description,
      fields.status ?? t.status,
      fields.priority ?? t.priority,
      fields.assigneeId !== undefined ? fields.assigneeId : t.assignee_id,
      fields.dueAt !== undefined ? fields.dueAt : t.due_at,
      fields.position ?? t.position,
      now(), id
    );
    return tasks.byId(id);
  },

  remove: (id) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id),
};

module.exports = { db, users, files, chats, messages, reactions, bots, spaces, tasks, DB_PATH, DATA_DIR };

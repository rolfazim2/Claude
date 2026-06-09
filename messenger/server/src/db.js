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

const now = () => Date.now();

const MSG_SELECT = `
  SELECT m.*, u.username AS sender_username, u.name AS sender_name,
         u.avatar_file AS sender_avatar,
         f.name AS file_name, f.mime AS file_mime, f.size AS file_size
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN files f ON f.id = m.file_id
`;

const users = {
  create: (username, name, passwordHash) =>
    db.prepare(
      'INSERT INTO users (username, name, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, name, passwordHash, now()),

  byUsername: (username) =>
    db.prepare('SELECT * FROM users WHERE username = ?').get(username),

  byId: (id) =>
    db.prepare(
      'SELECT id, username, name, bio, avatar_file, last_seen FROM users WHERE id = ?'
    ).get(id),

  // Фильтрация в JS: LIKE в SQLite не учитывает регистр кириллицы
  search: (q, excludeId) => {
    const needle = String(q).toLowerCase();
    return db.prepare(
      'SELECT id, username, name, bio, avatar_file, last_seen FROM users WHERE id != ? ORDER BY username'
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
      `SELECT u.id, u.username, u.name, u.bio, u.avatar_file, u.last_seen, m.role, m.muted
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

module.exports = { db, users, files, chats, messages, reactions, DB_PATH, DATA_DIR };

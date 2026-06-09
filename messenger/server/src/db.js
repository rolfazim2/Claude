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
    created_at    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    title      TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id   INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    last_read INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id  INTEGER NOT NULL REFERENCES users(id),
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    edited_at  INTEGER,
    deleted    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(user_id);
`);

const now = () => Date.now();

const users = {
  create: (username, name, passwordHash) =>
    db.prepare(
      'INSERT INTO users (username, name, password_hash, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, name, passwordHash, now()),

  byUsername: (username) =>
    db.prepare('SELECT * FROM users WHERE username = ?').get(username),

  byId: (id) =>
    db.prepare('SELECT id, username, name, last_seen FROM users WHERE id = ?').get(id),

  // Фильтрация в JS: LIKE в SQLite не учитывает регистр кириллицы
  search: (q, excludeId) => {
    const needle = String(q).toLowerCase();
    return db.prepare(
      'SELECT id, username, name, last_seen FROM users WHERE id != ? ORDER BY username'
    ).all(excludeId).filter((u) =>
      u.username.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle)
    ).slice(0, 20);
  },

  touch: (id) =>
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), id),
};

const chats = {
  create: (type, title, createdBy) => {
    const res = db.prepare(
      'INSERT INTO chats (type, title, created_by, created_at) VALUES (?, ?, ?, ?)'
    ).run(type, title, createdBy, now());
    return Number(res.lastInsertRowid);
  },

  byId: (id) => db.prepare('SELECT * FROM chats WHERE id = ?').get(id),

  addMember: (chatId, userId) =>
    db.prepare(
      'INSERT OR IGNORE INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).run(chatId, userId, now()),

  members: (chatId) =>
    db.prepare(
      `SELECT u.id, u.username, u.name, u.last_seen FROM chat_members m
       JOIN users u ON u.id = m.user_id WHERE m.chat_id = ?`
    ).all(chatId),

  memberIds: (chatId) =>
    db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?')
      .all(chatId).map((r) => Number(r.user_id)),

  isMember: (chatId, userId) =>
    !!db.prepare(
      'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?'
    ).get(chatId, userId),

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
      `SELECT c.id, c.type, c.title, c.created_by,
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
  create: (chatId, senderId, text) => {
    const res = db.prepare(
      'INSERT INTO messages (chat_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)'
    ).run(chatId, senderId, text, now());
    return messages.byId(Number(res.lastInsertRowid));
  },

  byId: (id) =>
    db.prepare(
      `SELECT m.*, u.username AS sender_username, u.name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
    ).get(id),

  list: (chatId, before, limit) =>
    db.prepare(
      `SELECT m.*, u.username AS sender_username, u.name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.chat_id = ? AND m.id < ?
       ORDER BY m.id DESC LIMIT ?`
    ).all(chatId, before, limit).reverse(),

  last: (chatId) =>
    db.prepare(
      `SELECT m.*, u.username AS sender_username, u.name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.chat_id = ? AND m.deleted = 0
       ORDER BY m.id DESC LIMIT 1`
    ).get(chatId),

  edit: (id, text) =>
    db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?')
      .run(text, now(), id),

  remove: (id) =>
    db.prepare("UPDATE messages SET deleted = 1, text = '' WHERE id = ?").run(id),
};

module.exports = { db, users, chats, messages, DB_PATH };

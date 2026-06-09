'use strict';

// Пароли: scrypt из node:crypto. Токены: подписанный HMAC-SHA256 payload
// (формат как у JWT, но без внешних зависимостей).

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const SECRET = (() => {
  if (process.env.GRAM_SECRET) return process.env.GRAM_SECRET;
  // Секрет генерируется один раз и сохраняется рядом с базой,
  // чтобы токены переживали перезапуск сервера.
  const dir = process.env.GRAM_DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
})();

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, sign, verify };

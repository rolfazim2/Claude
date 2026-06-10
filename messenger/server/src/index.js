'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const api = require('./api');
require('./api-bots');   // регистрируют маршруты в api.routes
require('./api-spaces');
const bots = require('./bots');
const hub = require('./hub');
const auth = require('./auth');
const { users, files, DATA_DIR } = require('./db');

const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });
const MAX_UPLOAD = 50 * 1024 * 1024; // 50 МБ

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIR = process.env.GRAM_WEB_DIR || path.join(__dirname, '..', '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new api.ApiError(413, 'Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new api.ApiError(400, 'Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA: неизвестные пути отдают index.html
      if (!path.extname(rel)) {
        fs.readFile(path.join(WEB_DIR, 'index.html'), (err2, html) => {
          if (err2) return json(res, 404, { error: 'Не найдено' });
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
        return;
      }
      json(res, 404, { error: 'Не найдено' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// Загрузка файла: тело запроса — бинарные данные, имя в заголовке X-File-Name
function handleUpload(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = auth.verify(token);
  if (!payload || !users.byId(payload.uid)) {
    json(res, 401, { error: 'Требуется авторизация' });
    return;
  }
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) {
    json(res, 413, { error: 'Файл больше 50 МБ' });
    return;
  }
  let name = 'file';
  try {
    name = decodeURIComponent(req.headers['x-file-name'] || 'file');
  } catch { /* оставляем имя по умолчанию */ }
  name = path.basename(name).slice(0, 128) || 'file';
  const mime = req.headers['content-type'] || 'application/octet-stream';

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD) {
      json(res, 413, { error: 'Файл больше 50 МБ' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    if (!size) {
      json(res, 400, { error: 'Пустой файл' });
      return;
    }
    const buf = Buffer.concat(chunks);
    const fileId = files.create(payload.uid, name, mime, size);
    fs.writeFile(path.join(FILES_DIR, String(fileId)), buf, (err) => {
      if (err) {
        console.error(err);
        json(res, 500, { error: 'Не удалось сохранить файл' });
        return;
      }
      json(res, 200, {
        file: { id: fileId, name, mime, size, url: `/files/${fileId}` },
      });
    });
  });
}

function serveFile(req, res, fileId) {
  const meta = files.byId(Number(fileId));
  if (!meta) {
    json(res, 404, { error: 'Файл не найден' });
    return;
  }
  const filePath = path.join(FILES_DIR, String(meta.id));
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => json(res, 404, { error: 'Файл не найден' }));
  stream.on('open', () => {
    const inline = /^(image|video|audio)\//.test(meta.mime);
    res.writeHead(200, {
      'Content-Type': meta.mime,
      'Content-Length': Number(meta.size),
      'Content-Disposition': (inline ? 'inline' : 'attachment') +
        `; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // CORS — чтобы desktop-клиент мог ходить на сервер с другого origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/upload') {
    handleUpload(req, res);
    return;
  }

  const fileMatch = /^\/files\/(\d+)$/.exec(pathname);
  if (req.method === 'GET' && fileMatch) {
    serveFile(req, res, fileMatch[1]);
    return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      req.pathname = pathname;
      req.query = Object.fromEntries(url.searchParams);
      req.body = await readBody(req);
      const result = api.dispatch(req);
      json(res, 200, result);
    } catch (err) {
      if (err instanceof api.ApiError) {
        json(res, err.status, { error: err.message });
      } else {
        console.error(err);
        json(res, 500, { error: 'Внутренняя ошибка сервера' });
      }
    }
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, pathname);
    return;
  }
  json(res, 404, { error: 'Не найдено' });
});

hub.attach(server);
bots.ensureBuiltinBots();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Gram server: http://${HOST}:${PORT} (web: ${WEB_DIR})`);
  });
}

module.exports = { server };

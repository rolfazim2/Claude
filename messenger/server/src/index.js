'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const api = require('./api');
const hub = require('./hub');

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

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Gram server: http://${HOST}:${PORT} (web: ${WEB_DIR})`);
  });
}

module.exports = { server };

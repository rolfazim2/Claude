#!/usr/bin/env node
/**
 * iStore — интернет-магазин техники Apple
 * Бэкенд: чистый Node.js (без внешних зависимостей).
 * Запуск: node server.js  →  http://localhost:3000
 *
 *   Витрина:  http://localhost:3000/
 *   Админка:  http://localhost:3000/admin  (логин: admin / admin)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

/* ---------------------------------------------------------------- storage */

function loadJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJSON(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

const db = {
  products: loadJSON('products.json', []),
  categories: loadJSON('categories.json', []),
  orders: loadJSON('orders.json', []),
  settings: loadJSON('settings.json', {}),
};

/* ----------------------------------------------------------------- admin */

// Пароль хранится как sha256-хэш. По умолчанию admin/admin — сменить в data/settings.json.
const ADMIN_USER = db.settings.adminUser || 'admin';
const ADMIN_HASH = db.settings.adminPasswordHash ||
  crypto.createHash('sha256').update('admin').digest('hex');

const sessions = new Map(); // token -> { user, createdAt }
const SESSION_TTL = 8 * 60 * 60 * 1000;

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, createdAt: Date.now() });
  return token;
}

function checkAuth(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/* ---------------------------------------------------------------- helpers */

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

/* -------------------------------------------------------------------- api */

const api = {

  /* --- публичные эндпоинты --- */

  'GET /api/categories': (req, res) => {
    sendJSON(res, 200, db.categories);
  },

  'GET /api/products': (req, res, url) => {
    let items = db.products.filter((p) => p.status !== 'disabled');
    const q = url.searchParams;

    if (q.get('category')) {
      items = items.filter((p) => p.category === q.get('category'));
    }
    if (q.get('search')) {
      const s = q.get('search').toLowerCase();
      items = items.filter((p) =>
        (p.name + ' ' + (p.description || '')).toLowerCase().includes(s));
    }
    if (q.get('minPrice')) items = items.filter((p) => p.price >= +q.get('minPrice'));
    if (q.get('maxPrice')) items = items.filter((p) => p.price <= +q.get('maxPrice'));

    switch (q.get('sort')) {
      case 'price_asc': items.sort((a, b) => a.price - b.price); break;
      case 'price_desc': items.sort((a, b) => b.price - a.price); break;
      case 'name': items.sort((a, b) => a.name.localeCompare(b.name, 'ru')); break;
      case 'new': items.sort((a, b) => b.id - a.id); break;
      default: items.sort((a, b) => (b.featured === true) - (a.featured === true));
    }

    const page = Math.max(1, +q.get('page') || 1);
    const limit = Math.min(60, +q.get('limit') || 24);
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit);

    sendJSON(res, 200, { total, page, limit, items });
  },

  'GET /api/products/:id': (req, res, url, params) => {
    const product = db.products.find((p) => p.id === +params.id);
    if (!product || product.status === 'disabled') {
      return sendJSON(res, 404, { error: 'Товар не найден' });
    }
    sendJSON(res, 200, product);
  },

  'POST /api/orders': async (req, res) => {
    const body = await readBody(req);
    const { customer, items } = body;

    if (!customer || !customer.name || !customer.phone) {
      return sendJSON(res, 400, { error: 'Укажите имя и телефон' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendJSON(res, 400, { error: 'Корзина пуста' });
    }

    // Цены берём из каталога, а не из запроса клиента
    const orderItems = [];
    for (const item of items) {
      const product = db.products.find((p) => p.id === +item.id);
      if (!product) return sendJSON(res, 400, { error: `Товар ${item.id} не найден` });
      const qty = Math.max(1, Math.min(99, +item.qty || 1));
      orderItems.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty,
      });
    }

    const order = {
      id: nextId(db.orders),
      createdAt: new Date().toISOString(),
      status: 'new',
      customer: {
        name: String(customer.name).slice(0, 100),
        phone: String(customer.phone).slice(0, 30),
        email: String(customer.email || '').slice(0, 100),
        address: String(customer.address || '').slice(0, 300),
        comment: String(customer.comment || '').slice(0, 500),
        delivery: customer.delivery === 'pickup' ? 'pickup' : 'courier',
        payment: customer.payment === 'card' ? 'card' : 'cash',
      },
      items: orderItems,
      total: orderItems.reduce((sum, i) => sum + i.price * i.qty, 0),
    };

    db.orders.push(order);
    saveJSON('orders.json', db.orders);
    sendJSON(res, 201, { id: order.id, total: order.total });
  },

  /* --- админка --- */

  'POST /api/admin/login': async (req, res) => {
    const { username, password } = await readBody(req);
    const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    if (username !== ADMIN_USER || hash !== ADMIN_HASH) {
      return sendJSON(res, 401, { error: 'Неверный логин или пароль' });
    }
    sendJSON(res, 200, { token: createSession(username) });
  },

  'GET /api/admin/stats': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const totalSales = db.orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.total, 0);
    sendJSON(res, 200, {
      orders: db.orders.length,
      newOrders: db.orders.filter((o) => o.status === 'new').length,
      sales: totalSales,
      products: db.products.length,
      customers: new Set(db.orders.map((o) => o.customer.phone)).size,
      recentOrders: [...db.orders].reverse().slice(0, 8),
    });
  },

  'GET /api/admin/products': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.products);
  },

  'POST /api/admin/products': async (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const product = sanitizeProduct(body);
    if (!product.name || !(product.price > 0)) {
      return sendJSON(res, 400, { error: 'Нужны название и цена' });
    }
    product.id = nextId(db.products);
    db.products.push(product);
    saveJSON('products.json', db.products);
    sendJSON(res, 201, product);
  },

  'PUT /api/admin/products/:id': async (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.products.findIndex((p) => p.id === +params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Товар не найден' });
    const body = await readBody(req);
    const product = sanitizeProduct(body);
    product.id = +params.id;
    db.products[index] = product;
    saveJSON('products.json', db.products);
    sendJSON(res, 200, product);
  },

  'DELETE /api/admin/products/:id': (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.products.findIndex((p) => p.id === +params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Товар не найден' });
    db.products.splice(index, 1);
    saveJSON('products.json', db.products);
    sendJSON(res, 200, { ok: true });
  },

  'GET /api/admin/orders': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, [...db.orders].reverse());
  },

  'PUT /api/admin/orders/:id': async (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const order = db.orders.find((o) => o.id === +params.id);
    if (!order) return sendJSON(res, 404, { error: 'Заказ не найден' });
    const { status } = await readBody(req);
    const allowed = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
    if (!allowed.includes(status)) return sendJSON(res, 400, { error: 'Неверный статус' });
    order.status = status;
    saveJSON('orders.json', db.orders);
    sendJSON(res, 200, order);
  },

  'POST /api/admin/categories': async (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const { slug, name, icon } = await readBody(req);
    if (!slug || !name) return sendJSON(res, 400, { error: 'Нужны slug и название' });
    if (db.categories.some((c) => c.slug === slug)) {
      return sendJSON(res, 400, { error: 'Категория уже существует' });
    }
    const category = { slug: String(slug), name: String(name), icon: String(icon || '') };
    db.categories.push(category);
    saveJSON('categories.json', db.categories);
    sendJSON(res, 201, category);
  },

  'DELETE /api/admin/categories/:id': (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.categories.findIndex((c) => c.slug === params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Категория не найдена' });
    db.categories.splice(index, 1);
    saveJSON('categories.json', db.categories);
    sendJSON(res, 200, { ok: true });
  },
};

function sanitizeProduct(body) {
  return {
    name: String(body.name || '').slice(0, 200),
    category: String(body.category || '').slice(0, 50),
    price: Math.max(0, +body.price || 0),
    oldPrice: +body.oldPrice > 0 ? +body.oldPrice : null,
    image: String(body.image || '').slice(0, 300),
    description: String(body.description || '').slice(0, 2000),
    specs: typeof body.specs === 'object' && body.specs ? body.specs : {},
    colors: Array.isArray(body.colors) ? body.colors.slice(0, 10) : [],
    stock: Math.max(0, +body.stock || 0),
    featured: !!body.featured,
    badge: String(body.badge || '').slice(0, 30),
    status: body.status === 'disabled' ? 'disabled' : 'enabled',
  };
}

/* ------------------------------------------------------------ статика */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

/* ------------------------------------------------------------- routing */

function matchRoute(method, pathname) {
  for (const key of Object.keys(api)) {
    const [routeMethod, routePath] = key.split(' ');
    if (routeMethod !== method) continue;
    const routeParts = routePath.split('/');
    const pathParts = pathname.split('/');
    if (routeParts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) params[routeParts[i].slice(1)] = pathParts[i];
      else if (routeParts[i] !== pathParts[i]) { ok = false; break; }
    }
    if (ok) return { handler: api[key], params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    const route = matchRoute(req.method, pathname);
    if (!route) return sendJSON(res, 404, { error: 'Not found' });
    try {
      await route.handler(req, res, url, route.params);
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
    return;
  }

  // защита от выхода за пределы корня
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');

  let filePath;
  if (safe === '/admin' || safe === '/admin/') {
    filePath = path.join(ROOT, 'admin', 'index.html');
  } else if (safe.startsWith('/admin/')) {
    filePath = path.join(ROOT, safe);
  } else if (safe === '/' ) {
    filePath = path.join(ROOT, 'public', 'index.html');
  } else {
    filePath = path.join(ROOT, 'public', safe);
    // страницы без расширения: /catalog → catalog.html
    if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    }
  }

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`iStore запущен:  http://localhost:${PORT}`);
  console.log(`Админка:         http://localhost:${PORT}/admin  (admin / admin)`);
});

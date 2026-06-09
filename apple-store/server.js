#!/usr/bin/env node
/**
 * i:Store — интернет-магазин техники Apple
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
  banners: loadJSON('banners.json', []),
  promos: loadJSON('promos.json', []),
  reviews: loadJSON('reviews.json', []),
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

/* Рейтинг товара по одобренным отзывам */
function ratingFor(productId) {
  const approved = db.reviews.filter((r) => r.productId === productId && r.status === 'approved');
  if (!approved.length) return { rating: 0, reviewsCount: 0 };
  const avg = approved.reduce((s, r) => s + r.rating, 0) / approved.length;
  return { rating: Math.round(avg * 10) / 10, reviewsCount: approved.length };
}

function withRating(product) {
  return { ...product, ...ratingFor(product.id) };
}

/* Применение промокода: возвращает {discount, promo} либо {error} */
function applyPromo(code, total) {
  if (!code) return { discount: 0, promo: null };
  const promo = db.promos.find((p) => p.code.toLowerCase() === String(code).toLowerCase() && p.active);
  if (!promo) return { error: 'Промокод не найден или неактивен' };
  if (promo.minTotal && total < promo.minTotal) {
    return { error: `Промокод действует от ${promo.minTotal.toLocaleString('ru-RU')} ₽` };
  }
  const discount = promo.type === 'percent'
    ? Math.round(total * promo.value / 100)
    : Math.min(promo.value, total);
  return { discount, promo };
}

/* -------------------------------------------------------------------- api */

const api = {

  /* --- публичные эндпоинты --- */

  'GET /api/categories': (req, res) => {
    sendJSON(res, 200, db.categories);
  },

  'GET /api/banners': (req, res) => {
    sendJSON(res, 200, db.banners.filter((b) => b.active));
  },

  'GET /api/suggest': (req, res, url) => {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    if (q.length < 2) return sendJSON(res, 200, []);
    const found = db.products
      .filter((p) => p.status !== 'disabled' && p.name.toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({ id: p.id, name: p.name, price: p.price, image: p.image }));
    sendJSON(res, 200, found);
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
    if (q.get('inStock') === '1') items = items.filter((p) => p.stock > 0);
    if (q.get('sale') === '1') items = items.filter((p) => p.oldPrice);
    if (q.get('ids')) {
      const ids = q.get('ids').split(',').map(Number);
      items = items.filter((p) => ids.includes(p.id));
    }

    items = items.map(withRating);

    switch (q.get('sort')) {
      case 'price_asc': items.sort((a, b) => a.price - b.price); break;
      case 'price_desc': items.sort((a, b) => b.price - a.price); break;
      case 'name': items.sort((a, b) => a.name.localeCompare(b.name, 'ru')); break;
      case 'rating': items.sort((a, b) => b.rating - a.rating); break;
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
    sendJSON(res, 200, withRating(product));
  },

  'GET /api/products/:id/reviews': (req, res, url, params) => {
    const reviews = db.reviews
      .filter((r) => r.productId === +params.id && r.status === 'approved')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJSON(res, 200, reviews);
  },

  'POST /api/products/:id/reviews': async (req, res, url, params) => {
    const product = db.products.find((p) => p.id === +params.id);
    if (!product) return sendJSON(res, 404, { error: 'Товар не найден' });
    const body = await readBody(req);
    const rating = Math.min(5, Math.max(1, Math.round(+body.rating || 0)));
    if (!body.name || !body.text || !rating) {
      return sendJSON(res, 400, { error: 'Заполните имя, оценку и текст отзыва' });
    }
    const review = {
      id: nextId(db.reviews),
      productId: product.id,
      name: String(body.name).slice(0, 60),
      rating,
      text: String(body.text).slice(0, 1000),
      createdAt: new Date().toISOString(),
      status: 'pending', // публикуется после модерации в админке
    };
    db.reviews.push(review);
    saveJSON('reviews.json', db.reviews);
    sendJSON(res, 201, { ok: true, message: 'Отзыв отправлен на модерацию' });
  },

  'POST /api/promo/validate': async (req, res) => {
    const { code, total } = await readBody(req);
    const result = applyPromo(code, +total || 0);
    if (result.error) return sendJSON(res, 400, { error: result.error });
    if (!result.promo) return sendJSON(res, 400, { error: 'Укажите промокод' });
    sendJSON(res, 200, {
      code: result.promo.code,
      discount: result.discount,
      description: result.promo.description || '',
    });
  },

  'POST /api/orders': async (req, res) => {
    const body = await readBody(req);
    const { customer, items, promoCode } = body;

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

    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
    const promoResult = applyPromo(promoCode, subtotal);
    if (promoResult.error) return sendJSON(res, 400, { error: promoResult.error });

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
        payment: ['card', 'installment'].includes(customer.payment) ? customer.payment : 'cash',
      },
      items: orderItems,
      subtotal,
      promoCode: promoResult.promo ? promoResult.promo.code : null,
      discount: promoResult.discount,
      total: subtotal - promoResult.discount,
    };

    db.orders.push(order);
    saveJSON('orders.json', db.orders);
    sendJSON(res, 201, { id: order.id, total: order.total, discount: order.discount });
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
      pendingReviews: db.reviews.filter((r) => r.status === 'pending').length,
      recentOrders: [...db.orders].reverse().slice(0, 8),
    });
  },

  'GET /api/admin/products': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.products.map(withRating));
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

  /* --- баннеры --- */

  'GET /api/admin/banners': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.banners);
  },

  'POST /api/admin/banners': async (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const banner = sanitizeBanner(await readBody(req));
    if (!banner.title) return sendJSON(res, 400, { error: 'Нужен заголовок' });
    banner.id = nextId(db.banners);
    db.banners.push(banner);
    saveJSON('banners.json', db.banners);
    sendJSON(res, 201, banner);
  },

  'PUT /api/admin/banners/:id': async (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.banners.findIndex((b) => b.id === +params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Баннер не найден' });
    const banner = sanitizeBanner(await readBody(req));
    banner.id = +params.id;
    db.banners[index] = banner;
    saveJSON('banners.json', db.banners);
    sendJSON(res, 200, banner);
  },

  'DELETE /api/admin/banners/:id': (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.banners.findIndex((b) => b.id === +params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Баннер не найден' });
    db.banners.splice(index, 1);
    saveJSON('banners.json', db.banners);
    sendJSON(res, 200, { ok: true });
  },

  /* --- промокоды --- */

  'GET /api/admin/promos': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    sendJSON(res, 200, db.promos);
  },

  'POST /api/admin/promos': async (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    if (!body.code || !(+body.value > 0)) {
      return sendJSON(res, 400, { error: 'Нужны код и размер скидки' });
    }
    if (db.promos.some((p) => p.code.toLowerCase() === String(body.code).toLowerCase())) {
      return sendJSON(res, 400, { error: 'Такой промокод уже есть' });
    }
    const promo = {
      id: nextId(db.promos),
      code: String(body.code).toUpperCase().slice(0, 30),
      type: body.type === 'fixed' ? 'fixed' : 'percent',
      value: +body.value,
      minTotal: Math.max(0, +body.minTotal || 0),
      description: String(body.description || '').slice(0, 200),
      active: body.active !== false,
    };
    db.promos.push(promo);
    saveJSON('promos.json', db.promos);
    sendJSON(res, 201, promo);
  },

  'PUT /api/admin/promos/:id': async (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const promo = db.promos.find((p) => p.id === +params.id);
    if (!promo) return sendJSON(res, 404, { error: 'Промокод не найден' });
    const { active } = await readBody(req);
    promo.active = !!active;
    saveJSON('promos.json', db.promos);
    sendJSON(res, 200, promo);
  },

  'DELETE /api/admin/promos/:id': (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.promos.findIndex((p) => p.id === +params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Промокод не найден' });
    db.promos.splice(index, 1);
    saveJSON('promos.json', db.promos);
    sendJSON(res, 200, { ok: true });
  },

  /* --- модерация отзывов --- */

  'GET /api/admin/reviews': (req, res) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const reviews = [...db.reviews].reverse().map((r) => ({
      ...r,
      productName: db.products.find((p) => p.id === r.productId)?.name || '—',
    }));
    sendJSON(res, 200, reviews);
  },

  'PUT /api/admin/reviews/:id': async (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const review = db.reviews.find((r) => r.id === +params.id);
    if (!review) return sendJSON(res, 404, { error: 'Отзыв не найден' });
    const { status } = await readBody(req);
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return sendJSON(res, 400, { error: 'Неверный статус' });
    }
    review.status = status;
    saveJSON('reviews.json', db.reviews);
    sendJSON(res, 200, review);
  },

  'DELETE /api/admin/reviews/:id': (req, res, url, params) => {
    if (!checkAuth(req)) return sendJSON(res, 401, { error: 'Unauthorized' });
    const index = db.reviews.findIndex((r) => r.id === +params.id);
    if (index === -1) return sendJSON(res, 404, { error: 'Отзыв не найден' });
    db.reviews.splice(index, 1);
    saveJSON('reviews.json', db.reviews);
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

function sanitizeBanner(body) {
  return {
    title: String(body.title || '').slice(0, 100),
    subtitle: String(body.subtitle || '').slice(0, 200),
    cta: String(body.cta || 'Подробнее').slice(0, 40),
    link: String(body.link || '/catalog').slice(0, 200),
    image: String(body.image || '').slice(0, 300),
    bg: String(body.bg || 'linear-gradient(120deg,#16161a,#3a2050)').slice(0, 200),
    light: body.light !== false, // светлый текст на тёмном фоне
    active: body.active !== false,
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
  console.log(`i:Store запущен:  http://localhost:${PORT}`);
  console.log(`Админка:          http://localhost:${PORT}/admin  (admin / admin)`);
});

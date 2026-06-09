/* Админ-панель i:Store — SPA в стиле OpenCart: дашборд, товары, заказы, категории */

const app = document.getElementById('app');
let token = sessionStorage.getItem('adminToken');
let categoriesCache = [];

/* ------------------------------ api ------------------------------ */

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401 && path !== '/admin/login') {
    token = null;
    sessionStorage.removeItem('adminToken');
    renderLogin();
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmt = (n) => (+n).toLocaleString('ru-RU') + ' ₽';

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

const STATUS_LABELS = {
  new: 'Новый',
  processing: 'В обработке',
  shipped: 'Отправлен',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};

const NAV_ICONS = {
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
  products: '<svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>',
  orders: '<svg viewBox="0 0 24 24"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/></svg>',
  categories: '<svg viewBox="0 0 24 24"><path d="M3 5h7l2 3h9v11H3z"/></svg>',
};

/* ------------------------------ login ------------------------------ */

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo">i:<span>Store</span> admin</div>
        <div class="login-hint">Панель администратора</div>
        <div class="panel-body">
          <div class="login-error" id="login-error"></div>
          <form id="login-form">
            <div class="form-row" style="grid-template-columns:1fr">
              <input name="username" placeholder="Логин" value="admin" required>
            </div>
            <div class="form-row" style="grid-template-columns:1fr">
              <input name="password" type="password" placeholder="Пароль" required>
            </div>
            <button class="btn" style="width:100%;padding:10px">Войти</button>
          </form>
        </div>
      </div>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const { token: t } = await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form)),
      });
      token = t;
      sessionStorage.setItem('adminToken', t);
      navigate('dashboard');
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  });
}

/* ------------------------------ layout ------------------------------ */

function renderShell(page, title, breadcrumb, bodyHTML, headerAction = '') {
  app.innerHTML = `
    <header class="admin-header">
      <a class="brand" href="/admin">i:<span>Store</span> <small style="font-weight:400;opacity:.7">admin</small></a>
      <div class="right">
        <a class="hl" href="/" target="_blank">Открыть магазин ↗</a>
        <a class="hl" href="#" id="logout">Выйти</a>
      </div>
    </header>
    <nav class="sidebar">
      <a href="#dashboard" class="${page === 'dashboard' ? 'active' : ''}">${NAV_ICONS.dashboard}<span>Панель состояния</span></a>
      <a href="#products" class="${page === 'products' ? 'active' : ''}">${NAV_ICONS.products}<span>Товары</span></a>
      <a href="#orders" class="${page === 'orders' ? 'active' : ''}">${NAV_ICONS.orders}<span>Заказы</span></a>
      <a href="#categories" class="${page === 'categories' ? 'active' : ''}">${NAV_ICONS.categories}<span>Категории</span></a>
    </nav>
    <main class="content">
      <div class="page-header">
        <div>
          <h1>${title}</h1>
          <div class="breadcrumb">Главная / ${breadcrumb}</div>
        </div>
        <div>${headerAction}</div>
      </div>
      <div class="inner" id="page-body">${bodyHTML}</div>
    </main>`;

  document.getElementById('logout').addEventListener('click', (e) => {
    e.preventDefault();
    token = null;
    sessionStorage.removeItem('adminToken');
    renderLogin();
  });
}

/* ------------------------------ dashboard ------------------------------ */

async function renderDashboard() {
  const stats = await api('/admin/stats');
  renderShell('dashboard', 'Панель состояния', 'Панель состояния', `
    <div class="tiles">
      <div class="tile tile-blue">
        <div class="tile-icon">${NAV_ICONS.orders}</div>
        <div class="num">${stats.orders}</div>
        <div class="label">Всего заказов</div>
        <div class="foot"><a href="#orders">Подробнее →</a></div>
      </div>
      <div class="tile tile-teal">
        <div class="tile-icon">${NAV_ICONS.dashboard}</div>
        <div class="num">${fmt(stats.sales)}</div>
        <div class="label">Общие продажи</div>
        <div class="foot"><a href="#orders">Подробнее →</a></div>
      </div>
      <div class="tile tile-orange">
        <div class="tile-icon">${NAV_ICONS.products}</div>
        <div class="num">${stats.products}</div>
        <div class="label">Товаров в каталоге</div>
        <div class="foot"><a href="#products">Подробнее →</a></div>
      </div>
      <div class="tile tile-red">
        <div class="tile-icon">${NAV_ICONS.categories}</div>
        <div class="num">${stats.customers}</div>
        <div class="label">Покупателей</div>
        <div class="foot"><a href="#orders">Подробнее →</a></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-heading">Последние заказы ${stats.newOrders ? `<span class="label label-new">новых: ${stats.newOrders}</span>` : ''}</div>
      ${stats.recentOrders.length ? `
        <table>
          <tr><th>№</th><th>Дата</th><th>Покупатель</th><th>Телефон</th><th>Сумма</th><th>Статус</th></tr>
          ${stats.recentOrders.map((o) => `
            <tr>
              <td>#${o.id}</td>
              <td>${new Date(o.createdAt).toLocaleString('ru-RU')}</td>
              <td>${esc(o.customer.name)}</td>
              <td>${esc(o.customer.phone)}</td>
              <td><b>${fmt(o.total)}</b></td>
              <td><span class="label label-${o.status}">${STATUS_LABELS[o.status]}</span></td>
            </tr>`).join('')}
        </table>` : '<div class="panel-body muted">Заказов пока нет</div>'}
    </div>`);
}

/* ------------------------------ products ------------------------------ */

async function renderProducts() {
  const [products, cats] = await Promise.all([api('/admin/products'), api('/categories')]);
  categoriesCache = cats;

  renderShell('products', 'Товары', 'Каталог / Товары', `
    <div class="panel">
      <div class="panel-heading">Список товаров (${products.length})</div>
      <table>
        <tr><th></th><th>Название</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th><th class="text-right">Действия</th></tr>
        ${products.map((p) => `
          <tr>
            <td><img class="thumb" src="${esc(p.image)}" alt=""></td>
            <td><b>${esc(p.name)}</b>${p.badge ? ` <span class="label label-new">${esc(p.badge)}</span>` : ''}</td>
            <td>${esc(cats.find((c) => c.slug === p.category)?.name || p.category)}</td>
            <td>${fmt(p.price)}${p.oldPrice ? ` <span class="muted" style="text-decoration:line-through">${fmt(p.oldPrice)}</span>` : ''}</td>
            <td>${p.stock}</td>
            <td><span class="label label-${p.status}">${p.status === 'enabled' ? 'Включён' : 'Отключён'}</span></td>
            <td class="text-right">
              <button class="btn btn-sm" data-edit="${p.id}">Изменить</button>
              <button class="btn btn-sm btn-danger" data-del="${p.id}">Удалить</button>
            </td>
          </tr>`).join('')}
      </table>
    </div>`,
    '<button class="btn btn-success" id="add-product">+ Добавить товар</button>');

  document.getElementById('add-product').addEventListener('click', () => productModal());
  document.getElementById('page-body').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) productModal(products.find((p) => p.id === +edit.dataset.edit));
    if (del) {
      const p = products.find((x) => x.id === +del.dataset.del);
      if (confirm(`Удалить товар «${p.name}»?`)) {
        await api('/admin/products/' + p.id, { method: 'DELETE' });
        toast('Товар удалён');
        renderProducts();
      }
    }
  });
}

function productModal(p = null) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="panel-heading">${p ? 'Редактирование товара' : 'Новый товар'}<button data-close>×</button></div>
      <form id="product-form">
        <div class="panel-body">
          <div class="form-row"><label>Название *</label><input name="name" required value="${esc(p?.name || '')}"></div>
          <div class="form-row"><label>Категория</label>
            <select name="category">${categoriesCache.map((c) =>
              `<option value="${c.slug}" ${p?.category === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          </div>
          <div class="form-row"><label>Цена, ₽ *</label><input name="price" type="number" min="1" required value="${p?.price || ''}"></div>
          <div class="form-row"><label>Старая цена, ₽</label><input name="oldPrice" type="number" min="0" value="${p?.oldPrice || ''}"></div>
          <div class="form-row"><label>Остаток, шт.</label><input name="stock" type="number" min="0" value="${p?.stock ?? 10}"></div>
          <div class="form-row"><label>Изображение</label>
            <div>
              <input name="image" value="${esc(p?.image || '/img/iphone.svg')}">
              <div class="form-hint">Путь к файлу, например /img/iphone.svg</div>
            </div>
          </div>
          <div class="form-row"><label>Бейдж</label>
            <select name="badge">
              ${['', 'Хит', 'Новинка', 'Скидка'].map((b) =>
                `<option value="${b}" ${p?.badge === b ? 'selected' : ''}>${b || '— нет —'}</option>`).join('')}
            </select>
          </div>
          <div class="form-row"><label>Описание</label><textarea name="description">${esc(p?.description || '')}</textarea></div>
          <div class="form-row"><label>Характеристики</label>
            <div>
              <textarea name="specs" placeholder="Чип: A18 Pro&#10;Память: 256 ГБ">${p ? esc(Object.entries(p.specs || {}).map(([k, v]) => k + ': ' + v).join('\n')) : ''}</textarea>
              <div class="form-hint">По одной на строку в формате «Название: значение»</div>
            </div>
          </div>
          <div class="form-row"><label>Статус</label>
            <select name="status">
              <option value="enabled" ${p?.status !== 'disabled' ? 'selected' : ''}>Включён</option>
              <option value="disabled" ${p?.status === 'disabled' ? 'selected' : ''}>Отключён</option>
            </select>
          </div>
          <div class="form-row"><label>На главной</label>
            <input type="checkbox" name="featured" style="width:auto;margin-top:9px" ${p?.featured ? 'checked' : ''}>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-default" data-close>Отмена</button>
          <button type="submit" class="btn btn-success">Сохранить</button>
        </div>
      </form>
    </div>`;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) backdrop.remove();
  });

  backdrop.querySelector('#product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const specs = {};
    for (const line of String(form.get('specs')).split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) specs[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    const body = {
      name: form.get('name'),
      category: form.get('category'),
      price: +form.get('price'),
      oldPrice: +form.get('oldPrice') || null,
      stock: +form.get('stock'),
      image: form.get('image'),
      badge: form.get('badge'),
      description: form.get('description'),
      specs,
      colors: p?.colors || [],
      featured: form.get('featured') === 'on',
      status: form.get('status'),
    };
    try {
      if (p) await api('/admin/products/' + p.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/admin/products', { method: 'POST', body: JSON.stringify(body) });
      backdrop.remove();
      toast(p ? 'Товар обновлён' : 'Товар добавлен');
      renderProducts();
    } catch (err) {
      toast(err.message);
    }
  });

  document.body.appendChild(backdrop);
}

/* ------------------------------ orders ------------------------------ */

async function renderOrders() {
  const orders = await api('/admin/orders');
  renderShell('orders', 'Заказы', 'Продажи / Заказы', `
    <div class="panel">
      <div class="panel-heading">Список заказов (${orders.length})</div>
      ${orders.length ? `
        <table>
          <tr><th>№</th><th>Дата</th><th>Покупатель</th><th>Состав</th><th>Сумма</th><th>Статус</th><th></th></tr>
          ${orders.map((o) => `
            <tr>
              <td>#${o.id}</td>
              <td>${new Date(o.createdAt).toLocaleString('ru-RU')}</td>
              <td>${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.phone)}</span></td>
              <td>${o.items.reduce((s, i) => s + i.qty, 0)} поз.</td>
              <td><b>${fmt(o.total)}</b></td>
              <td>
                <select class="status-select" data-status="${o.id}">
                  ${Object.entries(STATUS_LABELS).map(([value, label]) =>
                    `<option value="${value}" ${o.status === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
              </td>
              <td class="text-right"><button class="btn btn-sm btn-default" data-view="${o.id}">Просмотр</button></td>
            </tr>`).join('')}
        </table>` : '<div class="panel-body muted">Заказов пока нет</div>'}
    </div>`);

  document.getElementById('page-body').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    await api('/admin/orders/' + sel.dataset.status, {
      method: 'PUT',
      body: JSON.stringify({ status: sel.value }),
    });
    toast(`Заказ #${sel.dataset.status}: статус обновлён`);
  });

  document.getElementById('page-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    const order = orders.find((o) => o.id === +btn.dataset.view);
    orderModal(order);
  });
}

function orderModal(o) {
  const c = o.customer;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="panel-heading">Заказ #${o.id} от ${new Date(o.createdAt).toLocaleString('ru-RU')}<button data-close>×</button></div>
      <div class="panel-body">
        <table class="order-details" style="margin-bottom:16px">
          <tr><td class="muted" style="width:160px">Покупатель</td><td>${esc(c.name)}</td></tr>
          <tr><td class="muted">Телефон</td><td>${esc(c.phone)}</td></tr>
          ${c.email ? `<tr><td class="muted">E-mail</td><td>${esc(c.email)}</td></tr>` : ''}
          <tr><td class="muted">Получение</td><td>${c.delivery === 'pickup' ? 'Самовывоз' : 'Курьер'}</td></tr>
          ${c.address ? `<tr><td class="muted">Адрес</td><td>${esc(c.address)}</td></tr>` : ''}
          <tr><td class="muted">Оплата</td><td>${c.payment === 'card' ? 'Картой онлайн' : 'При получении'}</td></tr>
          ${c.comment ? `<tr><td class="muted">Комментарий</td><td>${esc(c.comment)}</td></tr>` : ''}
        </table>
        <table>
          <tr><th>Товар</th><th>Цена</th><th>Кол-во</th><th class="text-right">Сумма</th></tr>
          ${o.items.map((i) => `
            <tr><td>${esc(i.name)}</td><td>${fmt(i.price)}</td><td>${i.qty}</td><td class="text-right">${fmt(i.price * i.qty)}</td></tr>`).join('')}
          <tr><td colspan="3" class="text-right"><b>Итого</b></td><td class="text-right"><b>${fmt(o.total)}</b></td></tr>
        </table>
      </div>
      <div class="modal-footer"><button class="btn btn-default" data-close>Закрыть</button></div>
    </div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) backdrop.remove();
  });
  document.body.appendChild(backdrop);
}

/* ------------------------------ categories ------------------------------ */

async function renderCategories() {
  const cats = await api('/categories');
  renderShell('categories', 'Категории', 'Каталог / Категории', `
    <div class="panel">
      <div class="panel-heading">Категории (${cats.length})</div>
      <table>
        <tr><th>Slug</th><th>Название</th><th class="text-right"></th></tr>
        ${cats.map((c) => `
          <tr>
            <td><code>${esc(c.slug)}</code></td>
            <td>${esc(c.name)}</td>
            <td class="text-right"><button class="btn btn-sm btn-danger" data-del="${esc(c.slug)}">Удалить</button></td>
          </tr>`).join('')}
      </table>
    </div>
    <div class="panel">
      <div class="panel-heading">Добавить категорию</div>
      <div class="panel-body">
        <form id="cat-form">
          <div class="form-row"><label>Slug *</label><input name="slug" required placeholder="vision" pattern="[a-z0-9-]+"></div>
          <div class="form-row"><label>Название *</label><input name="name" required placeholder="Apple Vision"></div>
          <div class="form-row"><label></label><button class="btn btn-success">Добавить</button></div>
        </form>
      </div>
    </div>`);

  document.getElementById('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api('/admin/categories', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form)),
      });
      toast('Категория добавлена');
      renderCategories();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('page-body').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    if (confirm(`Удалить категорию «${del.dataset.del}»?`)) {
      await api('/admin/categories/' + del.dataset.del, { method: 'DELETE' });
      toast('Категория удалена');
      renderCategories();
    }
  });
}

/* ------------------------------ router ------------------------------ */

const routes = {
  dashboard: renderDashboard,
  products: renderProducts,
  orders: renderOrders,
  categories: renderCategories,
};

function navigate(page) {
  location.hash = page;
  (routes[page] || renderDashboard)().catch((err) => {
    if (err.message !== 'Unauthorized') toast(err.message);
  });
}

window.addEventListener('hashchange', () => {
  if (token) navigate(location.hash.slice(1) || 'dashboard');
});

if (token) navigate(location.hash.slice(1) || 'dashboard');
else renderLogin();

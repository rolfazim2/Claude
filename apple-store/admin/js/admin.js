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
  banners: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 4-5 5 6"/></svg>',
  promos: '<svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V4h7z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  reviews: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.9z"/></svg>',
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
      <a href="#banners" class="${page === 'banners' ? 'active' : ''}">${NAV_ICONS.banners}<span>Баннеры</span></a>
      <a href="#promos" class="${page === 'promos' ? 'active' : ''}">${NAV_ICONS.promos}<span>Промокоды</span></a>
      <a href="#reviews" class="${page === 'reviews' ? 'active' : ''}">${NAV_ICONS.reviews}<span>Отзывы</span></a>
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

/* ------------------------------ banners ------------------------------ */

async function renderBanners() {
  const banners = await api('/admin/banners');
  renderShell('banners', 'Баннеры', 'Дизайн / Баннеры главной', `
    <div class="panel">
      <div class="panel-heading">Слайды карусели (${banners.length})</div>
      <table>
        <tr><th>Заголовок</th><th>Подзаголовок</th><th>Ссылка</th><th>Статус</th><th class="text-right">Действия</th></tr>
        ${banners.map((b) => `
          <tr>
            <td><b>${esc(b.title)}</b></td>
            <td class="muted">${esc(b.subtitle)}</td>
            <td><code>${esc(b.link)}</code></td>
            <td><span class="label label-${b.active ? 'enabled' : 'disabled'}">${b.active ? 'Активен' : 'Скрыт'}</span></td>
            <td class="text-right">
              <button class="btn btn-sm" data-edit="${b.id}">Изменить</button>
              <button class="btn btn-sm btn-danger" data-del="${b.id}">Удалить</button>
            </td>
          </tr>`).join('')}
      </table>
    </div>`,
    '<button class="btn btn-success" id="add-banner">+ Добавить баннер</button>');

  document.getElementById('add-banner').addEventListener('click', () => bannerModal());
  document.getElementById('page-body').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) bannerModal(banners.find((b) => b.id === +edit.dataset.edit));
    if (del && confirm('Удалить баннер?')) {
      await api('/admin/banners/' + del.dataset.del, { method: 'DELETE' });
      toast('Баннер удалён');
      renderBanners();
    }
  });
}

function bannerModal(b = null) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="panel-heading">${b ? 'Редактирование баннера' : 'Новый баннер'}<button data-close>×</button></div>
      <form id="banner-form">
        <div class="panel-body">
          <div class="form-row"><label>Заголовок *</label><input name="title" required value="${esc(b?.title || '')}"></div>
          <div class="form-row"><label>Подзаголовок</label><textarea name="subtitle">${esc(b?.subtitle || '')}</textarea></div>
          <div class="form-row"><label>Текст кнопки</label><input name="cta" value="${esc(b?.cta || 'Подробнее')}"></div>
          <div class="form-row"><label>Ссылка</label><input name="link" value="${esc(b?.link || '/catalog')}"></div>
          <div class="form-row"><label>Изображение</label><input name="image" value="${esc(b?.image || '/img/hero.svg')}"></div>
          <div class="form-row"><label>Фон (CSS)</label>
            <div>
              <input name="bg" value="${esc(b?.bg || 'linear-gradient(115deg,#141418,#38204e)')}">
              <div class="form-hint">Например: linear-gradient(115deg,#141418,#38204e) или #f5f5f7</div>
            </div>
          </div>
          <div class="form-row"><label>Светлый текст</label><input type="checkbox" name="light" style="width:auto;margin-top:9px" ${b?.light !== false ? 'checked' : ''}></div>
          <div class="form-row"><label>Активен</label><input type="checkbox" name="active" style="width:auto;margin-top:9px" ${b?.active !== false ? 'checked' : ''}></div>
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

  backdrop.querySelector('#banner-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const body = {
      title: form.get('title'),
      subtitle: form.get('subtitle'),
      cta: form.get('cta'),
      link: form.get('link'),
      image: form.get('image'),
      bg: form.get('bg'),
      light: form.get('light') === 'on',
      active: form.get('active') === 'on',
    };
    try {
      if (b) await api('/admin/banners/' + b.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/admin/banners', { method: 'POST', body: JSON.stringify(body) });
      backdrop.remove();
      toast(b ? 'Баннер обновлён' : 'Баннер добавлен');
      renderBanners();
    } catch (err) {
      toast(err.message);
    }
  });

  document.body.appendChild(backdrop);
}

/* ------------------------------ promos ------------------------------ */

async function renderPromos() {
  const promos = await api('/admin/promos');
  renderShell('promos', 'Промокоды', 'Маркетинг / Промокоды', `
    <div class="panel">
      <div class="panel-heading">Промокоды (${promos.length})</div>
      <table>
        <tr><th>Код</th><th>Скидка</th><th>Мин. сумма</th><th>Описание</th><th>Статус</th><th class="text-right"></th></tr>
        ${promos.map((p) => `
          <tr>
            <td><code><b>${esc(p.code)}</b></code></td>
            <td>${p.type === 'percent' ? p.value + '%' : fmt(p.value)}</td>
            <td>${p.minTotal ? fmt(p.minTotal) : '—'}</td>
            <td class="muted">${esc(p.description)}</td>
            <td>
              <button class="btn btn-sm ${p.active ? 'btn-success' : 'btn-default'}" data-toggle="${p.id}" data-active="${p.active ? 1 : 0}">
                ${p.active ? 'Активен' : 'Выключен'}
              </button>
            </td>
            <td class="text-right"><button class="btn btn-sm btn-danger" data-del="${p.id}">Удалить</button></td>
          </tr>`).join('')}
      </table>
    </div>
    <div class="panel">
      <div class="panel-heading">Создать промокод</div>
      <div class="panel-body">
        <form id="promo-form">
          <div class="form-row"><label>Код *</label><input name="code" required placeholder="SALE15" style="text-transform:uppercase"></div>
          <div class="form-row"><label>Тип</label>
            <select name="type"><option value="percent">Процент от суммы</option><option value="fixed">Фиксированная сумма, ₽</option></select>
          </div>
          <div class="form-row"><label>Размер *</label><input name="value" type="number" min="1" required placeholder="10"></div>
          <div class="form-row"><label>Мин. сумма заказа</label><input name="minTotal" type="number" min="0" placeholder="0"></div>
          <div class="form-row"><label>Описание</label><input name="description" placeholder="Скидка 10% на всё"></div>
          <div class="form-row"><label></label><button class="btn btn-success">Создать</button></div>
        </form>
      </div>
    </div>`);

  document.getElementById('promo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await api('/admin/promos', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      toast('Промокод создан');
      renderPromos();
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('page-body').addEventListener('click', async (e) => {
    const tgl = e.target.closest('[data-toggle]');
    const del = e.target.closest('[data-del]');
    if (tgl) {
      await api('/admin/promos/' + tgl.dataset.toggle, {
        method: 'PUT',
        body: JSON.stringify({ active: tgl.dataset.active !== '1' }),
      });
      renderPromos();
    }
    if (del && confirm('Удалить промокод?')) {
      await api('/admin/promos/' + del.dataset.del, { method: 'DELETE' });
      toast('Промокод удалён');
      renderPromos();
    }
  });
}

/* ------------------------------ reviews ------------------------------ */

const REVIEW_STATUS = { pending: 'На модерации', approved: 'Опубликован', rejected: 'Отклонён' };
const REVIEW_LABEL = { pending: 'processing', approved: 'completed', rejected: 'cancelled' };

async function renderReviews() {
  const reviews = await api('/admin/reviews');
  const pending = reviews.filter((r) => r.status === 'pending').length;
  renderShell('reviews', 'Отзывы', 'Каталог / Отзывы', `
    <div class="panel">
      <div class="panel-heading">Отзывы (${reviews.length})
        ${pending ? `<span class="label label-processing">на модерации: ${pending}</span>` : ''}
      </div>
      ${reviews.length ? `
        <table>
          <tr><th>Дата</th><th>Товар</th><th>Автор</th><th>Оценка</th><th>Текст</th><th>Статус</th><th class="text-right"></th></tr>
          ${reviews.map((r) => `
            <tr>
              <td>${new Date(r.createdAt).toLocaleDateString('ru-RU')}</td>
              <td style="max-width:180px">${esc(r.productName)}</td>
              <td>${esc(r.name)}</td>
              <td>${'★'.repeat(r.rating)}<span class="muted">${'★'.repeat(5 - r.rating)}</span></td>
              <td class="muted" style="max-width:280px">${esc(r.text)}</td>
              <td><span class="label label-${REVIEW_LABEL[r.status]}">${REVIEW_STATUS[r.status]}</span></td>
              <td class="text-right" style="white-space:nowrap">
                ${r.status !== 'approved' ? `<button class="btn btn-sm btn-success" data-approve="${r.id}">✓</button>` : ''}
                ${r.status !== 'rejected' ? `<button class="btn btn-sm btn-default" data-reject="${r.id}">✗</button>` : ''}
                <button class="btn btn-sm btn-danger" data-del="${r.id}">Удалить</button>
              </td>
            </tr>`).join('')}
        </table>` : '<div class="panel-body muted">Отзывов пока нет</div>'}
    </div>`);

  document.getElementById('page-body').addEventListener('click', async (e) => {
    const approve = e.target.closest('[data-approve]');
    const reject = e.target.closest('[data-reject]');
    const del = e.target.closest('[data-del]');
    if (approve) {
      await api('/admin/reviews/' + approve.dataset.approve, { method: 'PUT', body: JSON.stringify({ status: 'approved' }) });
      toast('Отзыв опубликован');
      renderReviews();
    }
    if (reject) {
      await api('/admin/reviews/' + reject.dataset.reject, { method: 'PUT', body: JSON.stringify({ status: 'rejected' }) });
      toast('Отзыв отклонён');
      renderReviews();
    }
    if (del && confirm('Удалить отзыв безвозвратно?')) {
      await api('/admin/reviews/' + del.dataset.del, { method: 'DELETE' });
      toast('Отзыв удалён');
      renderReviews();
    }
  });
}

/* ------------------------------ router ------------------------------ */

const routes = {
  dashboard: renderDashboard,
  products: renderProducts,
  orders: renderOrders,
  categories: renderCategories,
  banners: renderBanners,
  promos: renderPromos,
  reviews: renderReviews,
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

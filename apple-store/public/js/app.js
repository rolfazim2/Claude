/* iStore — общий код витрины: шапка, подвал, корзина (localStorage), утилиты */

const Icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2l2.6 11.6a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20.5 8H6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 21S4 14.8 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 14.8 12 21 12 21z"/></svg>',
  iphone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 4.5h3"/></svg>',
  ipad: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M11 18.5h2"/></svg>',
  mac: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M2 19.5h20"/></svg>',
  watch: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5L9.6 2h4.8L15 6.5M9 17.5L9.6 22h4.8l.6-4.5"/></svg>',
  airpods: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M7.5 4a3 3 0 0 1 3 3c0 1.5-1 2.4-1.6 3.2L8.5 19h-1l-.5-9C6.4 9.3 4.5 8.5 4.5 7a3 3 0 0 1 3-3zM16.5 4a3 3 0 0 0-3 3c0 1.5 1 2.4 1.6 3.2l.4 8.8h1l.5-9c.6-.7 2.5-1.5 2.5-3a3 3 0 0 0-3-3z"/></svg>',
  accessories: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M12 3v7m0 0a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 17v4"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M2 6h12v10H2zM14 9h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M12 2l8 3.5v5c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11v-5z"/><path d="M8.5 11.5l2.5 2.5 4.5-5"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/></svg>',
};

const fmt = (n) => n.toLocaleString('ru-RU') + ' ₽';

/* ------------------------------ корзина ------------------------------ */

const Cart = {
  read() {
    try { return JSON.parse(localStorage.getItem('cart')) || []; }
    catch { return []; }
  },
  write(items) {
    localStorage.setItem('cart', JSON.stringify(items));
    Cart.renderCount();
  },
  add(id, qty = 1) {
    const items = Cart.read();
    const found = items.find((i) => i.id === id);
    if (found) found.qty = Math.min(99, found.qty + qty);
    else items.push({ id, qty });
    Cart.write(items);
  },
  setQty(id, qty) {
    let items = Cart.read();
    if (qty <= 0) items = items.filter((i) => i.id !== id);
    else items.find((i) => i.id === id).qty = Math.min(99, qty);
    Cart.write(items);
  },
  remove(id) { Cart.write(Cart.read().filter((i) => i.id !== id)); },
  clear() { Cart.write([]); },
  count() { return Cart.read().reduce((s, i) => s + i.qty, 0); },
  has(id) { return Cart.read().some((i) => i.id === id); },
  renderCount() {
    const el = document.querySelector('.cart-count');
    if (el) {
      const n = Cart.count();
      el.textContent = n;
      el.style.display = n ? '' : 'none';
    }
  },
};

/* ------------------------------ макет ------------------------------ */

function renderLayout() {
  const headerHost = document.getElementById('site-header');
  if (headerHost) {
    headerHost.innerHTML = `
      <div class="topbar">
        <div class="container">
          <span>Москва, ТЦ «Центральный» · ежедневно 10:00–22:00</span>
          <div class="topbar-links">
            <a href="/catalog">Каталог</a>
            <a href="#">Доставка и оплата</a>
            <a href="#">Trade-in</a>
            <a href="tel:+78001234567"><b>8 800 123-45-67</b></a>
          </div>
        </div>
      </div>
      <header class="header">
        <div class="container">
          <a class="logo" href="/">i:<span>Store</span></a>
          <form class="search" action="/catalog">
            <input name="search" type="text" placeholder="Поиск по каталогу — iPhone, MacBook, AirPods…" value="${escapeHtml(new URLSearchParams(location.search).get('search') || '')}">
            <button type="submit" aria-label="Найти">${Icons.search}</button>
          </form>
          <div class="header-actions">
            <a class="header-action" href="#">${Icons.heart}<span>Избранное</span></a>
            <a class="header-action" href="/cart">${Icons.cart}<span>Корзина</span><span class="cart-count"></span></a>
          </div>
        </div>
      </header>
      <nav class="nav"><div class="container" id="nav-cats"></div></nav>`;

    fetch('/api/categories').then((r) => r.json()).then((cats) => {
      const active = new URLSearchParams(location.search).get('category');
      document.getElementById('nav-cats').innerHTML =
        `<a href="/catalog" class="${location.pathname === '/catalog' && !active ? 'active' : ''}">Все товары</a>` +
        cats.map((c) => `<a href="/catalog?category=${c.slug}" class="${active === c.slug ? 'active' : ''}">${c.name}</a>`).join('');
    });
  }

  const footerHost = document.getElementById('site-footer');
  if (footerHost) {
    footerHost.innerHTML = `
      <footer class="footer">
        <div class="container">
          <div class="footer-grid">
            <div>
              <a class="logo" href="/">i:<span>Store</span></a>
              <p style="margin-top:14px;max-width:280px">Магазин техники Apple: оригинальная продукция, официальная гарантия, доставка по всей России.</p>
            </div>
            <div>
              <h4>Каталог</h4>
              <ul>
                <li><a href="/catalog?category=iphone">iPhone</a></li>
                <li><a href="/catalog?category=ipad">iPad</a></li>
                <li><a href="/catalog?category=mac">Mac</a></li>
                <li><a href="/catalog?category=watch">Apple Watch</a></li>
              </ul>
            </div>
            <div>
              <h4>Покупателям</h4>
              <ul>
                <li><a href="#">Доставка и оплата</a></li>
                <li><a href="#">Гарантия и возврат</a></li>
                <li><a href="#">Trade-in</a></li>
                <li><a href="#">Кредит и рассрочка</a></li>
              </ul>
            </div>
            <div>
              <h4>Контакты</h4>
              <ul>
                <li><a href="tel:+78001234567">8 800 123-45-67</a></li>
                <li><a href="mailto:hello@istore.example">hello@istore.example</a></li>
                <li>Москва, ТЦ «Центральный»</li>
              </ul>
            </div>
          </div>
          <div class="footer-bottom">© ${new Date().getFullYear()} i:Store — учебный проект. Apple, iPhone, iPad, Mac, Apple Watch и AirPods — товарные знаки Apple Inc.</div>
        </div>
      </footer>
      <div class="toast" id="toast"></div>`;
  }

  Cart.renderCount();
}

/* ------------------------------ утилиты ------------------------------ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function badgeClass(badge) {
  if (badge === 'Новинка') return 'badge b-new';
  if (badge === 'Скидка') return 'badge b-sale';
  return 'badge';
}

function productCard(p) {
  const inCart = Cart.has(p.id);
  return `
    <div class="card">
      ${p.badge ? `<span class="${badgeClass(p.badge)}">${escapeHtml(p.badge)}</span>` : ''}
      <a class="card-img" href="/product?id=${p.id}"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy"></a>
      <a class="card-name" href="/product?id=${p.id}">${escapeHtml(p.name)}</a>
      <div class="card-price">
        <span class="price">${fmt(p.price)}</span>
        ${p.oldPrice ? `<span class="price-old">${fmt(p.oldPrice)}</span>` : ''}
      </div>
      <button class="btn ${inCart ? 'in-cart' : ''}" data-add="${p.id}">${inCart ? 'В корзине ✓' : 'В корзину'}</button>
    </div>`;
}

/* делегирование клика «В корзину» для всех страниц со списками товаров */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  Cart.add(+btn.dataset.add);
  btn.classList.add('in-cart');
  btn.textContent = 'В корзине ✓';
  toast('Товар добавлен в корзину');
});

document.addEventListener('DOMContentLoaded', renderLayout);

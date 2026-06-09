/* i:Store — общий код витрины: шапка, корзина, избранное, слайдеры, карточки */

const Icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  bag: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M6 8h12l1 12a1.5 1.5 0 0 1-1.5 1.6h-11A1.5 1.5 0 0 1 5 20z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>',
  user: '<svg viewBox="0 0 24 24" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M12 21S4 14.8 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 14.8 12 21 12 21z"/></svg>',
  compare: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 21V9M12 21V3M19 21v-8"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  iphone: '<svg viewBox="0 0 24 24" stroke-width="1.7"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 4.5h3"/></svg>',
  ipad: '<svg viewBox="0 0 24 24" stroke-width="1.7"><rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M11 18.5h2"/></svg>',
  mac: '<svg viewBox="0 0 24 24" stroke-width="1.7"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M2 19.5h20"/></svg>',
  watch: '<svg viewBox="0 0 24 24" stroke-width="1.7"><rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5L9.6 2h4.8L15 6.5M9 17.5L9.6 22h4.8l.6-4.5"/></svg>',
  airpods: '<svg viewBox="0 0 24 24" stroke-width="1.7"><path d="M7.5 4a3 3 0 0 1 3 3c0 1.5-1 2.4-1.6 3.2L8.5 19h-1l-.5-9C6.4 9.3 4.5 8.5 4.5 7a3 3 0 0 1 3-3zM16.5 4a3 3 0 0 0-3 3c0 1.5 1 2.4 1.6 3.2l.4 8.8h1l.5-9c.6-.7 2.5-1.5 2.5-3a3 3 0 0 0-3-3z"/></svg>',
  accessories: '<svg viewBox="0 0 24 24" stroke-width="1.7"><path d="M12 3v7m0 0a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 17v4"/></svg>',
  truck: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M2 6h12v10H2zM14 9h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M12 2l8 3.5v5c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11v-5z"/><path d="M8.5 11.5l2.5 2.5 4.5-5"/></svg>',
  card: '<svg viewBox="0 0 24 24" stroke-width="1.8"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/></svg>',
  store: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9.5 20v-6h5v6"/></svg>',
};

const fmt = (n) => n.toLocaleString('ru-RU') + ' ₽';
const monthly = (price) => Math.ceil(price / 24 / 10) * 10; // рассрочка на 24 месяца

/* ------------------------------ хранилища ------------------------------ */

function makeStore(key, onChange) {
  return {
    read() {
      try { return JSON.parse(localStorage.getItem(key)) || []; }
      catch { return []; }
    },
    write(items) {
      localStorage.setItem(key, JSON.stringify(items));
      onChange?.();
    },
  };
}

const Cart = {
  ...makeStore('cart', () => Cart.renderCount()),
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
  renderCount() { renderPin('#cart-pin', Cart.count()); },
};

const Fav = {
  ...makeStore('favorites', () => Fav.renderCount()),
  toggle(id) {
    let items = Fav.read();
    if (items.includes(id)) items = items.filter((x) => x !== id);
    else items.push(id);
    Fav.write(items);
    return items.includes(id);
  },
  has(id) { return Fav.read().includes(id); },
  renderCount() { renderPin('#fav-pin', Fav.read().length); },
};

const Viewed = {
  ...makeStore('viewed'),
  push(id) {
    const items = [id, ...Viewed.read().filter((x) => x !== id)].slice(0, 12);
    Viewed.write(items);
  },
};

function renderPin(selector, n) {
  const el = document.querySelector(selector);
  if (el) {
    el.textContent = n;
    el.style.display = n ? '' : 'none';
  }
}

/* ------------------------------ макет ------------------------------ */

function renderLayout() {
  const headerHost = document.getElementById('site-header');
  if (headerHost) {
    headerHost.innerHTML = `
      <div class="topbar">
        <div class="container">
          <span class="city">${Icons.pin} Москва</span>
          <a href="/catalog">Магазины</a>
          <a href="/delivery">Доставка и оплата</a>
          <a href="/catalog?sale=1">Trade-in</a>
          <a href="/delivery">Покупателям</a>
          <a href="#">Корпоративным клиентам</a>
          <span class="spacer"></span>
          <a class="phone" href="tel:+78001234567">8 800 123-45-67</a>
        </div>
      </div>
      <header class="header">
        <div class="container">
          <a class="logo" href="/"><i>i:</i>Store</a>
          <div class="search">
            <form action="/catalog" autocomplete="off">
              <input name="search" id="search-input" type="text"
                placeholder="Поиск: iPhone 16 Pro, MacBook Air, AirPods…"
                value="${escapeHtml(new URLSearchParams(location.search).get('search') || '')}">
              <button type="submit" aria-label="Найти">${Icons.search}</button>
            </form>
            <div class="suggest" id="suggest"></div>
          </div>
          <div class="header-actions">
            <a class="header-action" href="/favorites">${Icons.heart}<span>Избранное</span><span class="count-pin" id="fav-pin"></span></a>
            <a class="header-action" href="/cart">${Icons.bag}<span>Корзина</span><span class="count-pin" id="cart-pin"></span></a>
          </div>
        </div>
      </header>
      <nav class="nav"><div class="container" id="nav-cats"></div></nav>`;

    buildNav();
    bindSuggest();
  }

  const footerHost = document.getElementById('site-footer');
  if (footerHost) {
    footerHost.innerHTML = `
      <footer class="footer">
        <div class="container">
          <div class="footer-subscribe">
            <div>
              <h3>Подпишитесь на новости и акции</h3>
              <p>Скидки для подписчиков, ранний доступ к новинкам Apple</p>
            </div>
            <form class="subscribe-form" id="subscribe-form">
              <input type="email" required placeholder="Ваш e-mail">
              <button class="btn" type="submit">Подписаться</button>
            </form>
          </div>
          <div class="footer-grid">
            <div>
              <a class="logo" href="/"><i>i:</i>Store</a>
              <p style="margin-top:14px;max-width:280px;font-size:13.5px">Магазин техники Apple: оригинальная продукция, официальная гарантия, доставка по всей России.</p>
            </div>
            <div>
              <h4>Каталог</h4>
              <ul>
                <li><a href="/catalog?category=iphone">iPhone</a></li>
                <li><a href="/catalog?category=ipad">iPad</a></li>
                <li><a href="/catalog?category=mac">Mac</a></li>
                <li><a href="/catalog?category=watch">Apple Watch</a></li>
                <li><a href="/catalog?category=airpods">AirPods</a></li>
              </ul>
            </div>
            <div>
              <h4>Покупателям</h4>
              <ul>
                <li><a href="/delivery">Доставка и оплата</a></li>
                <li><a href="/delivery">Гарантия и возврат</a></li>
                <li><a href="/catalog?sale=1">Trade-in</a></li>
                <li><a href="/delivery">Кредит и рассрочка</a></li>
              </ul>
            </div>
            <div>
              <h4>Компания</h4>
              <ul>
                <li><a href="#">О магазине</a></li>
                <li><a href="#">Магазины</a></li>
                <li><a href="#">Корпоративным клиентам</a></li>
                <li><a href="#">Контакты</a></li>
              </ul>
            </div>
            <div>
              <h4>Контакты</h4>
              <ul>
                <li><a class="phone-big" href="tel:+78001234567">8 800 123-45-67</a></li>
                <li>Ежедневно 10:00–22:00</li>
                <li><a href="mailto:hello@istore.example">hello@istore.example</a></li>
                <li>Москва, ТЦ «Центральный»</li>
              </ul>
            </div>
          </div>
          <div class="footer-bottom">
            <span>© ${new Date().getFullYear()} i:Store — учебный проект. Apple, iPhone, iPad, Mac, Apple Watch и AirPods — товарные знаки Apple Inc.</span>
            <span class="pay-icons"><span>MIR</span><span>VISA</span><span>MC</span><span>SBP</span></span>
          </div>
        </div>
      </footer>
      <div class="toast" id="toast"></div>`;

    document.getElementById('subscribe-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      e.target.reset();
      toast('Вы подписаны на новости i:Store!');
    });
  }

  Cart.renderCount();
  Fav.renderCount();
}

/* выпадающее меню категорий с товарами */
async function buildNav() {
  const host = document.getElementById('nav-cats');
  if (!host) return;
  const active = new URLSearchParams(location.search).get('category');
  const [cats, { items }] = await Promise.all([
    fetch('/api/categories').then((r) => r.json()),
    fetch('/api/products?limit=60').then((r) => r.json()),
  ]);

  host.innerHTML =
    `<div class="nav-item"><a href="/catalog" class="${location.pathname === '/catalog' && !active ? 'hot' : ''}">Все товары</a></div>` +
    cats.map((c) => {
      const top = items.filter((p) => p.category === c.slug).slice(0, 5);
      return `
        <div class="nav-item">
          <a href="/catalog?category=${c.slug}" class="${active === c.slug ? 'hot' : ''}">${c.name}</a>
          ${top.length ? `<div class="nav-drop">
            ${top.map((p) => `<a href="/product?id=${p.id}"><span>${escapeHtml(shortName(p.name))}</span><span>${fmt(p.price)}</span></a>`).join('')}
            <a class="drop-all" href="/catalog?category=${c.slug}">Все ${c.name} →</a>
          </div>` : ''}
        </div>`;
    }).join('') +
    `<div class="nav-item"><a href="/catalog?sale=1" class="hot">Скидки %</a></div>`;
}

function shortName(name) {
  return name.length > 38 ? name.slice(0, 36) + '…' : name;
}

/* живые подсказки поиска */
function bindSuggest() {
  const input = document.getElementById('search-input');
  const box = document.getElementById('suggest');
  if (!input || !box) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { box.classList.remove('open'); return; }
    timer = setTimeout(async () => {
      const found = await fetch('/api/suggest?q=' + encodeURIComponent(q)).then((r) => r.json());
      if (!found.length) { box.classList.remove('open'); return; }
      box.innerHTML = found.map((p) => `
        <a href="/product?id=${p.id}">
          <img src="${escapeHtml(p.image)}" alt="">
          <span>${escapeHtml(p.name)}</span>
          <span class="s-price">${fmt(p.price)}</span>
        </a>`).join('');
      box.classList.add('open');
    }, 200);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) box.classList.remove('open');
  });
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

function starsHtml(rating, count) {
  if (!count) return `<span class="stars"><span class="star-row" style="color:#d2d2d7">★★★★★</span> нет отзывов</span>`;
  const full = Math.round(rating);
  return `<span class="stars"><span class="star-row">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span> ${rating} · ${count} ${plural(count, 'отзыв', 'отзыва', 'отзывов')}</span>`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function productCard(p) {
  const inCart = Cart.has(p.id);
  const inFav = Fav.has(p.id);
  return `
    <div class="card">
      ${p.badge ? `<span class="${badgeClass(p.badge)}">${escapeHtml(p.badge)}</span>` : ''}
      <button class="fav-btn ${inFav ? 'active' : ''}" data-fav="${p.id}" aria-label="В избранное">${Icons.heart}</button>
      <a class="card-img" href="/product?id=${p.id}"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy"></a>
      ${starsHtml(p.rating, p.reviewsCount)}
      <a class="card-name" href="/product?id=${p.id}">${escapeHtml(p.name)}</a>
      <div class="card-price">
        <span class="price">${fmt(p.price)}</span>
        ${p.oldPrice ? `<span class="price-old">${fmt(p.oldPrice)}</span>` : ''}
      </div>
      <div class="installment">или от <b>${fmt(monthly(p.price))}/мес</b> в рассрочку</div>
      <button class="btn ${inCart ? 'in-cart' : ''}" data-add="${p.id}">${inCart ? 'В корзине ✓' : 'В корзину'}</button>
    </div>`;
}

/* горизонтальный слайдер товаров со стрелками */
function productSlider(hostId, products) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = `<div class="slider"><div class="slider-track">${products.map(productCard).join('')}</div></div>`;
  const track = host.querySelector('.slider-track');
  const arrows = host.closest('section')?.querySelectorAll('.slider-arrow');
  if (!arrows || arrows.length < 2) return;
  const [prev, next] = arrows;
  let pos = 0;
  const visible = () => (innerWidth > 1040 ? 4 : innerWidth > 640 ? 3 : 2);
  const update = () => {
    const max = Math.max(0, products.length - visible());
    pos = Math.min(Math.max(0, pos), max);
    const card = track.querySelector('.card');
    if (card) track.style.transform = `translateX(-${pos * (card.offsetWidth + 16)}px)`;
    prev.disabled = pos === 0;
    next.disabled = pos >= max;
  };
  prev.addEventListener('click', () => { pos--; update(); });
  next.addEventListener('click', () => { pos++; update(); });
  update();
}

/* делегирование: «В корзину» и «избранное» */
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    Cart.add(+add.dataset.add);
    add.classList.add('in-cart');
    add.textContent = 'В корзине ✓';
    toast('Товар добавлен в корзину');
    return;
  }
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    const added = Fav.toggle(+fav.dataset.fav);
    fav.classList.toggle('active', added);
    toast(added ? 'Добавлено в избранное' : 'Удалено из избранного');
  }
});

document.addEventListener('DOMContentLoaded', renderLayout);

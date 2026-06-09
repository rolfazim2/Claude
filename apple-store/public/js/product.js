/* Карточка товара: галерея, покупка, вкладки, отзывы, похожие товары */

const id = +new URLSearchParams(location.search).get('id');

async function loadProduct() {
  const res = await fetch('/api/products/' + id);
  if (!res.ok) {
    document.getElementById('product-root').innerHTML =
      '<div class="empty">Товар не найден. <a href="/catalog" style="color:var(--red)">Вернуться в каталог</a></div>';
    return;
  }
  const p = await res.json();
  document.title = p.name + ' — i:Store';
  Viewed.push(p.id);

  const cats = await fetch('/api/categories').then((r) => r.json());
  const cat = cats.find((c) => c.slug === p.category);
  if (cat) {
    document.getElementById('bc').insertAdjacentHTML('beforeend',
      ` / <a href="/catalog?category=${cat.slug}">${cat.name}</a> / <span>${escapeHtml(p.name)}</span>`);
  }

  const inCart = Cart.has(p.id);
  const inFav = Fav.has(p.id);
  const saving = p.oldPrice ? p.oldPrice - p.price : 0;

  document.getElementById('product-root').innerHTML = `
    <div class="product-layout">
      <div class="product-gallery">
        ${p.badge ? `<span class="${badgeClass(p.badge)}">${escapeHtml(p.badge)}</span>` : ''}
        <button class="fav-btn ${inFav ? 'active' : ''}" data-fav="${p.id}" aria-label="В избранное">${Icons.heart}</button>
        <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">
      </div>
      <div class="product-info">
        <h1>${escapeHtml(p.name)}</h1>
        <div class="product-meta">
          ${starsHtml(p.rating, p.reviewsCount)}
          <span class="sku">Арт. ${100000 + p.id}</span>
          <span class="product-stock ${p.stock ? '' : 'out'}">${p.stock ? 'В наличии' : 'Нет в наличии'}</span>
        </div>
        ${p.colors.length ? `<div class="product-colors">${p.colors.map((c, i) =>
          `<span class="color-dot ${i === 0 ? 'active' : ''}" style="background:${c}" title="Цвет"></span>`).join('')}</div>` : ''}
        <div class="product-buy">
          <div class="product-buy-top">
            <span class="price">${fmt(p.price)}</span>
            ${p.oldPrice ? `<span class="price-old">${fmt(p.oldPrice)}</span>
              <span class="save-tag">выгода ${fmt(saving)}</span>` : ''}
          </div>
          <div class="installment">или от <b>${fmt(monthly(p.price))}/мес</b> в рассрочку 0-0-24</div>
          <div class="product-buy-actions">
            <button class="btn ${inCart ? 'in-cart' : ''}" data-add="${p.id}" ${p.stock ? '' : 'disabled'}>
              ${inCart ? 'В корзине ✓' : 'В корзину'}
            </button>
            <button class="btn btn-grey" id="buy-now" ${p.stock ? '' : 'disabled'}>Купить в 1 клик</button>
          </div>
        </div>
        <div class="delivery-info">
          <div class="delivery-row">${Icons.truck}<span><b>Доставка за 2 часа</b> по Москве — бесплатно от 5 000 ₽</span></div>
          <div class="delivery-row">${Icons.store}<span><b>Самовывоз сегодня</b> из магазина в ТЦ «Центральный»</span></div>
          <div class="delivery-row">${Icons.shield}<span><b>Официальная гарантия</b> 1 год, обмен и возврат 14 дней</span></div>
        </div>
      </div>
    </div>

    <div class="tabs" id="tabs">
      <button class="tab active" data-tab="desc">Описание</button>
      <button class="tab" data-tab="specs">Характеристики</button>
      <button class="tab" data-tab="reviews">Отзывы${p.reviewsCount ? ` (${p.reviewsCount})` : ''}</button>
    </div>
    <div class="tab-pane active" id="pane-desc"><p style="color:var(--grey-dark)">${escapeHtml(p.description)}</p></div>
    <div class="tab-pane specs" id="pane-specs">
      ${Object.keys(p.specs).length ? `<table>${Object.entries(p.specs).map(([k, v]) =>
        `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}</table>` : '<p class="empty">Характеристики не указаны</p>'}
    </div>
    <div class="tab-pane" id="pane-reviews">
      <div id="reviews-list"></div>
      <div class="review-form">
        <h3>Оставить отзыв</h3>
        <div class="rating-input" id="rating-input">${[1,2,3,4,5].map((n) => `<span data-star="${n}">★</span>`).join('')}</div>
        <form id="review-form" class="form-grid" style="grid-template-columns:1fr">
          <div class="field"><input name="name" required placeholder="Ваше имя"></div>
          <div class="field"><textarea name="text" required placeholder="Поделитесь впечатлениями о товаре"></textarea></div>
          <button class="btn" type="submit">Отправить отзыв</button>
        </form>
      </div>
    </div>`;

  bindTabs();
  bindColors();
  bindReviewForm(p);
  loadReviews(p);

  document.getElementById('buy-now').addEventListener('click', () => {
    if (!Cart.has(p.id)) Cart.add(p.id);
    location.href = '/checkout';
  });

  // похожие товары
  const { items } = await fetch('/api/products?category=' + p.category).then((r) => r.json());
  const related = items.filter((x) => x.id !== p.id);
  if (related.length) {
    document.getElementById('related-section').hidden = false;
    productSlider('related', related);
  }
}

function bindTabs() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-pane').forEach((pane) =>
      pane.classList.toggle('active', pane.id === 'pane-' + tab.dataset.tab));
  });
}

function bindColors() {
  document.querySelectorAll('.color-dot').forEach((dot) => dot.addEventListener('click', () => {
    document.querySelector('.color-dot.active')?.classList.remove('active');
    dot.classList.add('active');
  }));
}

async function loadReviews(p) {
  const reviews = await fetch(`/api/products/${p.id}/reviews`).then((r) => r.json());
  const host = document.getElementById('reviews-list');
  if (!reviews.length) {
    host.innerHTML = '<p style="color:var(--grey)">Отзывов пока нет — станьте первым!</p>';
    return;
  }
  host.innerHTML = `
    <div class="review-summary">
      <span class="big-rating">${p.rating}</span>
      <div>${starsHtml(p.rating, p.reviewsCount)}</div>
    </div>
    ${reviews.map((r) => `
      <div class="review">
        <div class="review-head">
          <b>${escapeHtml(r.name)}</b>
          <span class="star-row" style="color:var(--amber);font-size:12px">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
          <span class="date">${new Date(r.createdAt).toLocaleDateString('ru-RU')}</span>
        </div>
        <p>${escapeHtml(r.text)}</p>
      </div>`).join('')}`;
}

function bindReviewForm(p) {
  let rating = 5;
  const stars = document.getElementById('rating-input');
  const paint = () => stars.querySelectorAll('span').forEach((s) =>
    s.classList.toggle('lit', +s.dataset.star <= rating));
  paint();
  stars.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { rating = +star.dataset.star; paint(); }
  });

  document.getElementById('review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const res = await fetch(`/api/products/${p.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), text: form.get('text'), rating }),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Ошибка');
    e.target.reset();
    toast('Спасибо! Отзыв появится после модерации');
  });
}

loadProduct();

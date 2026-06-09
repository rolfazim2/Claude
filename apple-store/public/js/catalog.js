/* Страница каталога: чипы категорий, фильтры, сортировка, пагинация */

const state = new URLSearchParams(location.search);

function applyAndReload(extra = {}) {
  for (const [key, value] of Object.entries(extra)) {
    if (value) state.set(key, value);
    else state.delete(key);
  }
  location.search = state.toString();
}

async function loadCatalog() {
  const res = await fetch('/api/products?' + state.toString());
  const { total, page, limit, items } = await res.json();

  document.getElementById('products').innerHTML = items.map(productCard).join('');
  document.getElementById('empty').hidden = items.length > 0;
  document.getElementById('cat-count').textContent =
    total ? `${total} ${plural(total, 'товар', 'товара', 'товаров')}` : '';

  // заголовок
  const slug = state.get('category');
  if (slug) {
    const cats = await fetch('/api/categories').then((r) => r.json());
    const cat = cats.find((c) => c.slug === slug);
    if (cat) {
      document.querySelector('#cat-title').firstChild.textContent = cat.name + ' ';
      document.getElementById('bc').textContent = cat.name;
      document.title = cat.name + ' — i:Store';
    }
  } else if (state.get('search')) {
    document.querySelector('#cat-title').firstChild.textContent = `Поиск: «${state.get('search')}» `;
  } else if (state.get('sale')) {
    document.querySelector('#cat-title').firstChild.textContent = 'Скидки ';
  }

  // пагинация
  const pages = Math.ceil(total / limit);
  const pag = document.getElementById('pagination');
  if (pages > 1) {
    pag.innerHTML = Array.from({ length: pages }, (_, i) =>
      `<button class="${i + 1 === page ? 'active' : ''}" data-page="${i + 1}">${i + 1}</button>`).join('');
    pag.onclick = (e) => {
      const btn = e.target.closest('[data-page]');
      if (btn) applyAndReload({ page: btn.dataset.page });
    };
  }
}

async function renderChips() {
  const cats = await fetch('/api/categories').then((r) => r.json());
  const current = state.get('category') || '';
  document.getElementById('chips').innerHTML =
    `<a class="chip ${!current && !state.get('sale') ? 'active' : ''}" href="/catalog">Все</a>` +
    cats.map((c) =>
      `<a class="chip ${current === c.slug ? 'active' : ''}" href="/catalog?category=${c.slug}">${c.name}</a>`).join('') +
    `<a class="chip ${state.get('sale') ? 'active' : ''}" href="/catalog?sale=1" style="color:${state.get('sale') ? '#fff' : 'var(--red)'}">Скидки %</a>`;

  document.getElementById('minPrice').value = state.get('minPrice') || '';
  document.getElementById('maxPrice').value = state.get('maxPrice') || '';
  document.getElementById('inStock').checked = state.get('inStock') === '1';
  document.getElementById('sale').checked = state.get('sale') === '1';
  document.getElementById('sort').value = state.get('sort') || '';
}

document.getElementById('apply').addEventListener('click', () => {
  state.delete('page');
  applyAndReload({
    minPrice: document.getElementById('minPrice').value,
    maxPrice: document.getElementById('maxPrice').value,
    inStock: document.getElementById('inStock').checked ? '1' : '',
    sale: document.getElementById('sale').checked ? '1' : '',
  });
});

document.getElementById('reset').addEventListener('click', () => { location.href = '/catalog'; });

document.getElementById('sort').addEventListener('change', (e) => {
  state.delete('page');
  applyAndReload({ sort: e.target.value });
});

loadCatalog();
renderChips();

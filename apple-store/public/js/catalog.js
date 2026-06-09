/* Страница каталога: фильтры, сортировка, пагинация */

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

  const grid = document.getElementById('products');
  grid.innerHTML = items.map(productCard).join('');
  document.getElementById('empty').hidden = items.length > 0;

  // заголовок по категории
  const slug = state.get('category');
  if (slug) {
    const cats = await fetch('/api/categories').then((r) => r.json());
    const cat = cats.find((c) => c.slug === slug);
    if (cat) {
      document.getElementById('cat-title').textContent = cat.name;
      document.getElementById('bc').textContent = cat.name;
      document.title = cat.name + ' — i:Store';
    }
  } else if (state.get('search')) {
    document.getElementById('cat-title').textContent = `Поиск: «${state.get('search')}»`;
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

async function renderFilters() {
  const cats = await fetch('/api/categories').then((r) => r.json());
  const current = state.get('category') || '';
  document.getElementById('filter-cats').innerHTML =
    `<label><input type="radio" name="cat" value="" ${!current ? 'checked' : ''}> Все категории</label>` +
    cats.map((c) =>
      `<label><input type="radio" name="cat" value="${c.slug}" ${current === c.slug ? 'checked' : ''}> ${c.name}</label>`).join('');

  document.getElementById('minPrice').value = state.get('minPrice') || '';
  document.getElementById('maxPrice').value = state.get('maxPrice') || '';
  document.getElementById('sort').value = state.get('sort') || '';
}

document.getElementById('apply').addEventListener('click', () => {
  state.delete('page');
  applyAndReload({
    category: document.querySelector('input[name=cat]:checked')?.value,
    minPrice: document.getElementById('minPrice').value,
    maxPrice: document.getElementById('maxPrice').value,
  });
});

document.getElementById('reset').addEventListener('click', () => { location.search = ''; });

document.getElementById('sort').addEventListener('change', (e) => {
  state.delete('page');
  applyAndReload({ sort: e.target.value });
});

loadCatalog();
renderFilters();

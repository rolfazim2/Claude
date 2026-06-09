/* Главная: карусель баннеров, плитки категорий, слайдеры товаров */

async function renderHero() {
  const banners = await fetch('/api/banners').then((r) => r.json());
  if (!banners.length) return;

  const hero = document.getElementById('hero');
  const track = document.getElementById('hero-track');
  const dots = document.getElementById('hero-dots');
  hero.hidden = false;

  track.innerHTML = banners.map((b) => `
    <div class="hero-slide ${b.light ? '' : 'dark-text'}" style="background:${escapeHtml(b.bg)}">
      <div>
        <h1>${escapeHtml(b.title)}</h1>
        <p>${escapeHtml(b.subtitle)}</p>
        <a class="btn" href="${escapeHtml(b.link)}">${escapeHtml(b.cta)}</a>
      </div>
      <img src="${escapeHtml(b.image)}" alt="">
    </div>`).join('');

  dots.innerHTML = banners.map((_, i) =>
    `<button data-slide="${i}" class="${i === 0 ? 'active' : ''}" aria-label="Слайд ${i + 1}"></button>`).join('');

  let current = 0;
  const go = (n) => {
    current = (n + banners.length) % banners.length;
    track.querySelectorAll('.hero-slide').forEach((s) => {
      s.style.transform = `translateX(-${current * 100}%)`;
    });
    dots.querySelectorAll('button').forEach((d, i) => d.classList.toggle('active', i === current));
  };

  hero.querySelector('.prev').addEventListener('click', () => { go(current - 1); restart(); });
  hero.querySelector('.next').addEventListener('click', () => { go(current + 1); restart(); });
  dots.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-slide]');
    if (btn) { go(+btn.dataset.slide); restart(); }
  });

  let timer = setInterval(() => go(current + 1), 5500);
  const restart = () => { clearInterval(timer); timer = setInterval(() => go(current + 1), 5500); };
}

async function renderHome() {
  const icons = { f1: 'truck', f2: 'shield', f3: 'card', f4: 'refresh' };
  for (const [id, icon] of Object.entries(icons)) {
    document.getElementById(id)?.insertAdjacentHTML('afterbegin', Icons[icon]);
  }

  fetch('/api/categories').then((r) => r.json()).then((cats) => {
    document.getElementById('home-cats').innerHTML = cats.map((c) =>
      `<a class="cat-tile" href="/catalog?category=${c.slug}">${Icons[c.icon] || ''}<span>${c.name}</span></a>`).join('');
  });

  const { items } = await fetch('/api/products?limit=60').then((r) => r.json());

  productSlider('newest', [...items].sort((a, b) => b.id - a.id).slice(0, 8));
  productSlider('featured', items.filter((p) => p.featured));
  productSlider('sale', items.filter((p) => p.oldPrice).slice(0, 8));

  const viewedIds = Viewed.read().filter((id) => items.some((p) => p.id === id));
  if (viewedIds.length) {
    document.getElementById('viewed-section').hidden = false;
    productSlider('viewed', viewedIds.map((id) => items.find((p) => p.id === id)));
  }
}

renderHero();
renderHome();

// Создание карточки товара (route=catalog/product/add) по чеклисту 5.2 и recipe 7.6.
// Категорию/производителя берём у АНАЛОГА той же модели (не «на глаз»), значения фильтров —
// из справочника filters.ts. Если чего-то не хватает для уверенного создания
// (нет аналога, неизвестный фильтр, нет точной картинки) — возвращаем needsReview,
// чтобы не создавать неполную/неверную карточку (правило ≥95%).

import type { AdminSession } from './session.js';
import type { ImagePipeline } from './image.js';
import type { ProductCandidate, TagConfig } from '../types.js';
import { ROM_FILTER, RAM_FILTER, COLOR_FILTER, COUNTRY_FILTER, CATEGORY_ANCHORS, MANUFACTURERS } from '../knowledge/filters.js';
import { canonicalColor, colorSynonyms } from '../knowledge/colors.js';
import { log } from '../logger.js';

interface Analog {
  productId: number;
  mainCategoryId: string;
  productCategories: string[];
  manufacturerId: string;
  manufacturerName: string;
  image: string | null;
  name: string;
}

export interface CreateResult {
  created: boolean;
  productId?: number;
  needsReview?: boolean;
  reason: string;
}

const TYPE_TO_MPN: Record<string, string> = {
  new: 'Новый',
  refurbished: 'Восстановленный',
  'asis-active': 'Обменка (актив)',
  'asis-inactive': 'Обменка (не актив)',
  used: 'Б/У',
  'asis-nobox': 'Обменка (без коробки)',
};

export class ProductCreator {
  constructor(private s: AdminSession, private img: ImagePipeline) {}

  async create(tag: TagConfig, title: string, analogCandidates: ProductCandidate[]): Promise<CreateResult> {
    // 1) Найти аналог той же модели → категория/производитель.
    const analog = await this.pickAnalog(tag, analogCandidates);
    if (!analog) {
      return { created: false, needsReview: true, reason: 'не найден аналог той же модели для копирования категории/производителя' };
    }

    // 2) Собрать значения фильтров (ROM/RAM/цвет/страна). Неизвестный фильтр → review.
    const filters = this.resolveFilters(tag);
    if (filters.missing.length) {
      return { created: false, needsReview: true, reason: `неизвестные значения фильтров: ${filters.missing.join(', ')} — нужно добавить в filters.ts или создать на сайте` };
    }

    // 3) Картинка: переиспользуем у аналога ТОГО ЖЕ цвета, иначе review.
    const imagePath = await this.resolveImage(tag, analog);
    if (!imagePath) {
      return { created: false, needsReview: true, reason: 'нет точной картинки нужного цвета (правило 6.4: случайную ставить нельзя)' };
    }

    // 4) Заполнить и отправить форму создания.
    const mpn = TYPE_TO_MPN[tag.type] ?? 'Новый';
    await this.s.page.goto(this.s.route('catalog/product/add'), { waitUntil: 'domcontentloaded' });
    await this.fillForm({
      title,
      mpn,
      manufacturerId: analog.manufacturerId,
      manufacturerName: analog.manufacturerName,
      mainCategoryId: analog.mainCategoryId,
      productCategories: analog.productCategories.length ? analog.productCategories : [analog.mainCategoryId],
      filterIds: filters.ids,
      image: imagePath,
      keyword: this.seoKeyword(title),
    });
    const saved = await this.submitAndConfirm();
    if (!saved.ok) {
      return { created: false, needsReview: true, reason: `форма не сохранилась: ${saved.note}` };
    }

    // 5) Получить product_id новой карточки и починить возможный баг qty=-99.
    const newId = await this.findNewProductId(title);
    if (newId) await this.fixQuantityBug(newId);

    log.info(`Создан товар${newId ? ' ID ' + newId : ''}: «${title}»`);
    return { created: true, productId: newId, reason: 'карточка создана' };
  }

  // ── аналог: категория/производитель ────────────────────────────────────────
  private async pickAnalog(tag: TagConfig, candidates: ProductCandidate[]): Promise<Analog | null> {
    // Берём первого кандидата той же модели (verify уже отфильтровал конфликтных по памяти/чипу
    // при привязке, но здесь нам нужен просто аналог модели — читаем его карточку).
    const pool = candidates.length ? candidates : [];
    for (const c of pool.slice(0, 5)) {
      const a = await this.readAnalog(c.id);
      if (a) return a;
    }
    // Запасной якорь по справочнику категорий, если кандидатов нет.
    const anchorCat = this.anchorCategory(tag);
    const anchorMfg = this.anchorManufacturer(tag);
    if (anchorCat && anchorMfg) {
      return {
        productId: 0,
        mainCategoryId: String(anchorCat),
        productCategories: [String(anchorCat)],
        manufacturerId: String(anchorMfg.id),
        manufacturerName: anchorMfg.name,
        image: null,
        name: tag.model ?? tag.raw,
      };
    }
    return null;
  }

  private async readAnalog(productId: number): Promise<Analog | null> {
    await this.s.page.goto(this.s.route('catalog/product/edit', { product_id: productId }), { waitUntil: 'domcontentloaded' });
    const data = await this.s.page.evaluate(() => {
      const mainSel = document.querySelector<HTMLSelectElement>('select[name="main_category_id"]');
      const mfg = document.querySelector<HTMLInputElement>('input[name="manufacturer"]');
      const mfgId = document.querySelector<HTMLInputElement>('input[name="manufacturer_id"]');
      const cats = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="product_category[]"]')).map((i) => i.value);
      const img = document.querySelector<HTMLInputElement>('input[name="image"]');
      const nameInp = document.querySelector<HTMLInputElement>('input[name="product_description[1][name]"]');
      return {
        mainCategoryId: mainSel?.value ?? '',
        manufacturerName: mfg?.value ?? '',
        manufacturerId: mfgId?.value ?? '',
        productCategories: cats,
        image: img?.value ?? '',
        name: nameInp?.value ?? '',
      };
    });
    if (!data.mainCategoryId || !data.manufacturerId) return null;
    return {
      productId,
      mainCategoryId: data.mainCategoryId,
      productCategories: data.productCategories,
      manufacturerId: data.manufacturerId,
      manufacturerName: data.manufacturerName,
      image: data.image || null,
      name: data.name,
    };
  }

  private anchorCategory(tag: TagConfig): number | null {
    for (const [key, id] of Object.entries(CATEGORY_ANCHORS)) {
      if ((tag.model ?? '').toLowerCase().includes(key.toLowerCase().replace('samsung ', '').replace('sennheiser ', ''))) return id;
    }
    return null;
  }
  private anchorManufacturer(tag: TagConfig): { id: number; name: string } | null {
    if (tag.brand && MANUFACTURERS[tag.brand]) return { id: MANUFACTURERS[tag.brand], name: tag.brand };
    return null;
  }

  // ── фильтры ────────────────────────────────────────────────────────────────
  private resolveFilters(tag: TagConfig): { ids: number[]; missing: string[] } {
    const ids: number[] = [];
    const missing: string[] = [];
    if (tag.rom != null && tag.rom < 1024) {
      if (ROM_FILTER[tag.rom]) ids.push(ROM_FILTER[tag.rom]);
      else missing.push(`ROM ${tag.rom}`);
    }
    if (tag.ram != null) {
      if (RAM_FILTER[tag.ram]) ids.push(RAM_FILTER[tag.ram]);
      else missing.push(`RAM ${tag.ram}`);
    }
    if (tag.colorRu) {
      const canon = canonicalColor(tag.colorRu) ?? tag.colorRu;
      if (COLOR_FILTER[canon]) ids.push(COLOR_FILTER[canon]);
      else missing.push(`Цвет ${canon}`);
    }
    if (tag.country) {
      if (COUNTRY_FILTER[tag.country]) ids.push(COUNTRY_FILTER[tag.country]);
      else missing.push(`Страна ${tag.country}`);
    }
    return { ids, missing };
  }

  // ── картинка ────────────────────────────────────────────────────────────────
  private async resolveImage(tag: TagConfig, analog: Analog): Promise<string | null> {
    // Картинку берём ТОЛЬКО у аналога ТОГО ЖЕ цвета (правило 6.4).
    if (!tag.colorRu || !this.nameHasColor(analog.name, tag.colorRu)) return null;
    if (analog.image) return analog.image;
    if (analog.productId > 0) return this.img.readProductImage(analog.productId);
    return null;
  }
  private nameHasColor(name: string, colorRu: string): boolean {
    const syns = colorSynonyms(canonicalColor(colorRu) ?? colorRu).concat(colorRu.toLowerCase());
    const n = name.toLowerCase();
    return syns.some((s) => n.includes(s));
  }

  // ── форма ────────────────────────────────────────────────────────────────────
  private async fillForm(d: {
    title: string;
    mpn: string;
    manufacturerId: string;
    manufacturerName: string;
    mainCategoryId: string;
    productCategories: string[];
    filterIds: number[];
    image: string;
    keyword: string;
  }): Promise<void> {
    await this.s.page.evaluate((d) => {
      const setVal = (sel: string, v: string) => {
        const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
        if (el) {
          (el as HTMLInputElement).value = v;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      setVal('input[name="product_description[1][name]"]', d.title);
      setVal('input[name="model"]', '111');
      setVal('select[name="mpn"]', d.mpn);
      setVal('input[name="quantity"]', '99');
      setVal('input[name="manufacturer"]', d.manufacturerName);
      setVal('input[name="manufacturer_id"]', d.manufacturerId);
      setVal('select[name="main_category_id"]', d.mainCategoryId);
      setVal('input[name="image"]', d.image);

      // SEO keyword (часто на вкладке SEO).
      const kw = document.querySelector<HTMLInputElement>('input[name="keyword"], input[name="product_seo_url[0][1]"]');
      if (kw) kw.value = d.keyword;

      // Категории и фильтры — через скрытые input в контейнерах (recipe 7.6).
      const catBox = document.getElementById('product-category');
      if (catBox) {
        catBox.innerHTML = d.productCategories
          .map((id) => `<div><i class="fa fa-minus-circle"></i> cat<input type="hidden" name="product_category[]" value="${id}" /></div>`)
          .join('');
      }
      const filBox = document.getElementById('product-filter');
      if (filBox) {
        filBox.innerHTML = d.filterIds
          .map((id) => `<div><i class="fa fa-minus-circle"></i> filter<input type="hidden" name="product_filter[]" value="${id}" /></div>`)
          .join('');
      }
    }, d);
  }

  private async submitAndConfirm(): Promise<{ ok: boolean; note: string }> {
    // Кнопка сохранения в шапке формы.
    await this.s.page.locator('.page-header .btn-primary, button[form="form-product"], #content .btn-primary').first().click().catch(() => {});
    // Дождаться алерта об успехе.
    const ok = await this.s.page
      .locator('.alert-success, .text-success')
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    return { ok, note: ok ? 'успех' : 'не дождались alert-success' };
  }

  private async findNewProductId(title: string): Promise<number | undefined> {
    await this.s.page.goto(this.s.route('catalog/product', { filter_name: title.slice(0, 30) }), { waitUntil: 'domcontentloaded' });
    return this.s.page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('a[href*="product_id="]');
      const m = link?.href.match(/product_id=(\d+)/);
      return m ? Number(m[1]) : undefined;
    });
  }

  private async fixQuantityBug(productId: number): Promise<void> {
    await this.s.page.goto(this.s.route('catalog/product/edit', { product_id: productId }), { waitUntil: 'domcontentloaded' });
    const qty = await this.s.page.evaluate(() => {
      const q = document.querySelector<HTMLInputElement>('input[name="quantity"]');
      return q ? Number(q.value) : null;
    });
    if (qty != null && qty < 0) {
      log.warn(`Баг qty=${qty} у товара ${productId} — пересохраняю с 99`);
      await this.s.page.evaluate(() => {
        const q = document.querySelector<HTMLInputElement>('input[name="quantity"]');
        if (q) {
          q.value = '99';
          q.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await this.submitAndConfirm();
    }
  }

  private seoKeyword(title: string): string {
    return (
      title
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/giu, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Date.now().toString(36)
    );
  }
}

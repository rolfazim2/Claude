// ПРИВЯЗКА ТЕГА — через НАСТОЯЩИЙ клик по варианту Select2.
//
// Ключевой инсайт проекта (отчёт 28.05.2026): программная привязка через fetch/edit_tag
// возвращает пустой HTTP 200 и НЕ сохраняется; `$(sel).val(id).trigger('change')` не ставит
// value у AJAX-Select2 без преднабора опций. А вот РЕАЛЬНЫЙ клик мышью по опции выпадающего
// списка (доверенное browser-событие) — сохраняется для свежих строк. Playwright диспатчит
// именно такие доверенные события, поэтому здесь мы воспроизводим ручной сценарий 1-в-1:
//   открыть Select2 нужной строки → ввести запрос → дождаться опций → кликнуть точный вариант.
//
// Верификация (рулбук 6.5): reload очереди и проверка, что строка ушла. Если осталась —
// помечаем «привязано, ожидает синхронизацию» (отложенная пересылка прайсов), не повторяем клик.

import type { AdminSession } from './session.js';
import type { TagQueue } from './queue.js';
import { log } from '../logger.js';

export interface BindParams {
  tagText: string;
  productId: number;
  productName: string;
  searchTerm: string; // короткий запрос, по которому товар точно появляется в Select2
}

export interface BindResult {
  clicked: boolean;
  verified: boolean; // строка ушла из очереди после reload
  note: string;
}

export class Binder {
  constructor(private s: AdminSession, private queue: TagQueue) {}

  async bind(p: BindParams): Promise<BindResult> {
    const page = this.s.page;

    // 1) Найти индекс строки по тексту тега (на актуальной странице очереди).
    const rowIndex = await this.findRowIndex(p.tagText);
    if (rowIndex < 0) {
      return { clicked: false, verified: false, note: 'строка тега не найдена в очереди (возможно уже ушла)' };
    }

    const rows = page.locator('#tab-whithout tr').filter({ has: page.locator('td') });
    const row = rows.nth(rowIndex);

    // 2) Открыть Select2 именно этой строки.
    const select2 = row.locator('.select2-container, .select2-selection, span[role="combobox"]').first();
    await select2.scrollIntoViewIfNeeded();
    await select2.click();

    // 3) Ввести запрос в активное поле поиска открытого выпадающего списка.
    const searchField = page.locator('.select2-container--open .select2-search__field, .select2-dropdown .select2-search__field').first();
    await searchField.waitFor({ state: 'visible', timeout: 5000 });
    await searchField.fill(p.searchTerm);

    // 4) Дождаться загрузки опций (AJAX), исключая «Поиск…/Searching».
    const options = page.locator('.select2-results__option:not(.loading-results):not(.select2-results__option--load-more)');
    await this.waitForRealOptions(options);

    // 5) Кликнуть точный вариант. Сначала по точному совпадению имени, затем по вхождению.
    const target = await this.pickOption(options, p.productName);
    if (!target) {
      await page.keyboard.press('Escape').catch(() => {});
      return { clicked: false, verified: false, note: `вариант «${p.productName}» не появился в Select2 по запросу «${p.searchTerm}»` };
    }

    // Реальный клик = доверенное событие → срабатывает родной обработчик change → edit_tag.
    const editReq = page
      .waitForResponse((r) => /catalog\/(import_tags\/edit_tag|suppliers_tags)/.test(r.url()), { timeout: 8000 })
      .catch(() => null);
    await target.click();
    await editReq;
    log.info(`Клик по варианту выполнен: tag «${p.tagText}» → [${p.productId}] ${p.productName}`);

    // 6) Верификация через reload очереди.
    await page.waitForTimeout(800);
    const stillThere = await this.queue.stillPresent(p.tagText);
    if (stillThere) {
      return { clicked: true, verified: false, note: 'привязано, строка пока в очереди — ожидает синхронизацию прайсов' };
    }
    return { clicked: true, verified: true, note: 'строка ушла из очереди — привязка подтверждена' };
  }

  private async findRowIndex(tagText: string): Promise<number> {
    return this.s.page.evaluate((needle) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('#tab-whithout tr')).filter((tr) => tr.querySelector('td'));
      for (let i = 0; i < rows.length; i++) {
        const cell = rows[i].querySelector('.left:first-child') ?? rows[i].querySelector('td');
        if (norm(cell?.textContent ?? '') === norm(needle)) return i;
      }
      return -1;
    }, tagText);
  }

  private async waitForRealOptions(options: ReturnType<AdminSession['page']['locator']>): Promise<void> {
    const page = this.s.page;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const texts = await options.allTextContents().catch(() => []);
      const real = texts.filter((t) => t && !/поиск|searching|loading|загруз/i.test(t));
      if (real.length > 0) return;
      await page.waitForTimeout(250);
    }
  }

  private async pickOption(
    options: ReturnType<AdminSession['page']['locator']>,
    productName: string,
  ): Promise<ReturnType<AdminSession['page']['locator']> | null> {
    const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    const want = norm(productName);
    const count = await options.count();
    let firstContains = -1;
    for (let i = 0; i < count; i++) {
      const txt = norm((await options.nth(i).textContent()) ?? '');
      if (txt === want) return options.nth(i); // точное совпадение имени — приоритет
      if (firstContains < 0 && (txt.includes(want) || want.includes(txt)) && txt.length > 3) firstContains = i;
    }
    return firstContains >= 0 ? options.nth(firstContains) : null;
  }
}

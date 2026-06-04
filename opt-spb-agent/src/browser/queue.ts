// Чтение очереди «Не найденные теги» (Каталог → Теги поставщиков, таб #tab-whithout).
// Строки: колонки Название/Поставщик/Дата/Привязка; на <tr> есть data-supplier.
// Обход — СНИЗУ ВВЕРХ: внизу самые свежие записи, привязка работает только для свежих.

import type { AdminSession } from './session.js';
import { log } from '../logger.js';

export interface QueueRow {
  index: number; // позиция строки в таблице (для повторного поиска)
  tag: string; // дословный текст тега (.left:first-child)
  supplierId: number | null; // data-supplier
}

export class TagQueue {
  constructor(private s: AdminSession) {}

  /** Перейти на вкладку «Не найденные теги». */
  async open(): Promise<void> {
    await this.s.page.goto(this.s.route('catalog/suppliers_tags'), { waitUntil: 'domcontentloaded' });
    // Активируем таб без привязки (#tab-whithout), если он есть.
    await this.s.page
      .locator('a[href="#tab-whithout"]')
      .click({ timeout: 5000 })
      .catch(() => log.warn('Вкладка #tab-whithout не найдена кликом — возможно уже активна'));
    await this.s.page.waitForTimeout(800);
  }

  /** Прочитать строки очереди. Возвращает в порядке СНИЗУ ВВЕРХ (свежие первыми). */
  async read(): Promise<QueueRow[]> {
    const rows = await this.s.page.evaluate(() => {
      const out: { tag: string; supplierId: number | null }[] = [];
      const trs = document.querySelectorAll('#tab-whithout tbody tr, #tab-whithout table tr');
      trs.forEach((tr) => {
        const el = tr as HTMLElement;
        // Текст тега — первая «левая» ячейка.
        const cell =
          el.querySelector('.left:first-child') ??
          el.querySelector('td:first-child') ??
          el.querySelector('td');
        const tag = (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!tag) return;
        const sup = el.getAttribute('data-supplier');
        out.push({ tag, supplierId: sup ? Number(sup) : null });
      });
      return out;
    });

    log.info(`В очереди прочитано строк: ${rows.length}`);
    // Снизу вверх.
    return rows
      .map((r, i) => ({ index: i, tag: r.tag, supplierId: r.supplierId }))
      .reverse()
      .map((r, i) => ({ ...r, index: i }));
  }

  /** Текущее число строк в очереди (для отчёта/верификации). */
  async count(): Promise<number> {
    return this.s.page.evaluate(() => {
      const trs = document.querySelectorAll('#tab-whithout tbody tr, #tab-whithout table tr');
      let n = 0;
      trs.forEach((tr) => {
        const cell = tr.querySelector('.left:first-child') ?? tr.querySelector('td');
        if ((cell?.textContent ?? '').trim()) n++;
      });
      return n;
    });
  }

  /** Проверить, осталась ли строка с данным текстом тега после reload (верификация привязки). */
  async stillPresent(tagText: string): Promise<boolean> {
    await this.open();
    return this.s.page.evaluate((needle) => {
      const trs = document.querySelectorAll('#tab-whithout tbody tr, #tab-whithout table tr');
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      for (const tr of Array.from(trs)) {
        const cell = tr.querySelector('.left:first-child') ?? tr.querySelector('td');
        if (norm(cell?.textContent ?? '') === norm(needle)) return true;
      }
      return false;
    }, tagText);
  }
}

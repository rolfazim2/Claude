// Поиск изображения товара в Яндекс.Картинках с последующей vision-проверкой цвета/модели.
//
// Почему именно так (узкое место из базы, отчёт 28.05): тумбы Яндекса мелкие, а выбор по
// размеру хватает НЕ ТОТ цвет (получали White вместо Pink Gold). Поэтому здесь:
//  1) собираем кандидатов из выдачи (берём превью на avatars.mds.yandex.net — CORS-открытый CDN,
//     грузится напрямую из контекста админки без моста window.name);
//  2) КАЖДОГО кандидата проверяет Claude vision: точная модель И точный цвет, без коллажа/ватермарки;
//  3) первый прошедший с уверенностью ≥ порога возвращается на загрузку, иначе — null (→ review).

import type { AdminSession } from './session.js';
import type { Decider } from '../matching/decide.js';
import type { TagConfig } from '../types.js';
import { colorSynonyms } from '../knowledge/colors.js';
import { log } from '../logger.js';

export interface YandexCandidate {
  previewUrl: string; // avatars.mds.yandex.net — CORS-открыт, годен для прямой загрузки
  originalUrl: string; // исходный источник (может быть закрыт CORS)
  w: number;
  h: number;
}

export class YandexImages {
  constructor(private s: AdminSession, private decider: Decider) {}

  /** Построить поисковый запрос: модель + цвет + память. Бренд добавляем для точности. */
  buildQuery(tag: TagConfig): string {
    const color = tag.colorEn ?? colorSynonyms(tag.colorRu)[0] ?? tag.colorRu ?? '';
    const parts = [tag.brand ?? '', tag.model ?? tag.generation ?? '', tag.storageRaw ?? '', color];
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Найти и подтвердить точную картинку. Возвращает CORS-открытый URL (avatars.mds.yandex.net)
   * для последующей загрузки в filemanager, либо null если ничего не прошло проверку.
   */
  async findVerifiedImage(tag: TagConfig, query: string, maxCandidates = 6): Promise<string | null> {
    const candidates = await this.scrape(query, maxCandidates * 2);
    if (!candidates.length) {
      log.warn(`Яндекс не вернул кандидатов по запросу «${query}» (возможна капча/блок IP)`);
      return null;
    }
    // Предпочитаем более крупные товарные рендеры.
    candidates.sort((a, b) => b.w * b.h - a.w * a.h);

    let checked = 0;
    for (const c of candidates) {
      if (checked >= maxCandidates) break;
      if (c.w < 300 || c.h < 300) continue; // отсекаем мелочь — это «треш»-тумбы
      checked++;
      const v = await this.decider.verifyImageMatch(tag, c.previewUrl).catch(() => null);
      if (v && v.match && v.confidence >= 0.9) {
        log.info(`Картинка подтверждена vision (conf ${v.confidence}): ${c.previewUrl}`);
        return c.previewUrl;
      }
      log.info(`Кандидат отклонён vision: ${v?.reason ?? 'ошибка проверки'} (${c.w}x${c.h})`);
    }
    return null;
  }

  /** Скрап выдачи Яндекс.Картинок: парсим data-bem у .serp-item. */
  private async scrape(query: string, limit: number): Promise<YandexCandidate[]> {
    const page = await this.s.context.newPage();
    try {
      const url = `https://yandex.ru/images/search?text=${encodeURIComponent(query)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Дождаться появления элементов выдачи (или капчи).
      await page.locator('.serp-item, [data-bem]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});

      const items = await page.evaluate((limit) => {
        const out: { previewUrl: string; originalUrl: string; w: number; h: number }[] = [];
        const nodes = document.querySelectorAll('.serp-item[data-bem], [data-bem]');
        for (const node of Array.from(nodes)) {
          if (out.length >= limit) break;
          const bem = node.getAttribute('data-bem');
          if (!bem) continue;
          try {
            const data = JSON.parse(bem);
            const item = data['serp-item'];
            if (!item) continue;
            const preview = Array.isArray(item.preview) ? item.preview[0] : null;
            const previewUrl = preview?.url ? (preview.url.startsWith('//') ? 'https:' + preview.url : preview.url) : '';
            if (!previewUrl || !/avatars\.mds\.yandex\.net|get-mpic/.test(previewUrl)) continue;
            out.push({
              previewUrl,
              originalUrl: item.img_href ?? '',
              w: Number(preview?.w ?? 0),
              h: Number(preview?.h ?? 0),
            });
          } catch {
            /* пропускаем нераспарсенные */
          }
        }
        return out;
      }, limit);

      return items;
    } catch (err) {
      log.warn('Ошибка скрапа Яндекс.Картинок', String(err));
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }
}

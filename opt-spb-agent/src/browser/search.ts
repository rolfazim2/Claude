// Поиск товаров-кандидатов через read-endpoint автокомплита:
//   catalog/import_tags/search&term=<q>&q=<q>  →  JSON [{id,name}]
// Логика поиска на сервере — AND по токенам-подстрокам. Переспецифичный запрос даёт 0,
// поэтому пробуем несколько коротких стратегий и объединяем результаты (раздел 5.1).
// Важно: бренд-слова (iPhone/Apple/Samsung/5G) в названиях карточек часто отсутствуют —
// их в запрос НЕ кладём. Память — через «/».

import type { AdminSession } from './session.js';
import type { ProductCandidate, TagConfig } from '../types.js';
import { colorSynonyms } from '../knowledge/colors.js';

export class ProductSearch {
  constructor(private s: AdminSession) {}

  /** Набор поисковых запросов от специфичного к общему. */
  buildQueries(tag: TagConfig): string[] {
    const q = new Set<string>();
    const model = (tag.model ?? '').replace(/\b(iphone|apple|samsung|galaxy|5g|4g)\b/giu, ' ').replace(/\s+/g, ' ').trim();
    const mem = tag.storageRaw ?? '';
    const colors = colorSynonyms(tag.colorRu);

    if (tag.partNumber) q.add(tag.partNumber);
    if (model && mem) q.add(`${shorten(model)} ${mem}`.trim());
    if (model && colors[0]) q.add(`${shorten(model)} ${colors[0]}`.trim());
    if (tag.generation && mem) q.add(`${tag.generation} ${mem}`.trim());
    if (tag.generation && colors[0]) q.add(`${tag.generation} ${colors[0]}`.trim());
    if (model) q.add(shorten(model));
    if (tag.generation) q.add(tag.generation);

    return [...q].filter((x) => x.length >= 2).slice(0, 6);
  }

  /** Выполнить запрос к endpoint из контекста админки (куки/токен применяются). */
  private async runQuery(term: string): Promise<ProductCandidate[]> {
    const url = this.s.route('catalog/import_tags/search', { term, _type: 'query', q: term });
    return this.s.page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include' });
        const data = await r.json();
        if (!Array.isArray(data)) return [];
        return data
          .filter((d: any) => d && d.id != null && d.name && !['2', 'ANP'].includes(String(d.id)))
          .map((d: any) => ({ id: Number(d.id), name: String(d.name) }));
      } catch {
        return [];
      }
    }, url);
  }

  /** Собрать уникальных кандидатов по всем стратегиям. */
  async findCandidates(tag: TagConfig): Promise<ProductCandidate[]> {
    const queries = this.buildQueries(tag);
    const byId = new Map<number, ProductCandidate>();
    for (const term of queries) {
      const res = await this.runQuery(term);
      for (const c of res) if (!byId.has(c.id)) byId.set(c.id, c);
      // Достаточно кандидатов — дальше можно не расширять.
      if (byId.size >= 25) break;
    }
    return [...byId.values()];
  }
}

/** Укоротить модель до 3–4 значимых токенов (сервер ищет AND по подстрокам). */
function shorten(model: string): string {
  return model.split(/\s+/).slice(0, 4).join(' ');
}

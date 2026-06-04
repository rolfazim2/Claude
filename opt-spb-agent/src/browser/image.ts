// Пайплайн изображения. Правило 6.4: картинка обязана ТОЧНО соответствовать
// модели/цвету/версии/типу; случайная — запрещена. Безопасная автономная стратегия:
//   1) переиспользовать изображение АНАЛОГА той же модели и ТОГО ЖЕ цвета (разрешено рулбуком);
//   2) если такого нет — вернуть null (создание уйдёт в review, а не с неверной картинкой).
//
// Низкоуровневая загрузка с внешнего CDN тоже доступна (recipe 7.5) — оставлена как
// uploadFromUrl для будущего источника точных рендеров, но автономно по умолчанию не вызывается.

import type { AdminSession } from './session.js';
import { log } from '../logger.js';

export class ImagePipeline {
  constructor(private s: AdminSession) {}

  /**
   * Загрузить картинку с внешнего CDN в filemanager (recipe 7.5).
   * Работает только с CORS-открытых источников. Возвращает путь вида catalog/<file> или null.
   */
  async uploadFromUrl(url: string, fileName: string): Promise<string | null> {
    const token = this.s.token;
    const result = await this.s.page.evaluate(
      async ({ url, fileName, token }) => {
        try {
          const r = await fetch(url, { mode: 'cors' });
          if (!r.ok) return null;
          const blob = await r.blob();
          const fd = new FormData();
          fd.append('file[]', blob, fileName);
          const up = await fetch(`/admin/index.php?route=common/filemanager/upload&token=${token}`, {
            method: 'POST',
            body: fd,
          });
          const txt = await up.text();
          return /success/i.test(txt) ? `catalog/${fileName}` : null;
        } catch {
          return null;
        }
      },
      { url, fileName, token },
    );
    if (result) log.info(`Картинка загружена: ${result}`);
    else log.warn(`Не удалось загрузить картинку с ${url}`);
    return result;
  }

  /**
   * Прочитать путь к изображению у существующего товара (поле image на странице edit).
   * Используется для переиспользования картинки аналога того же цвета.
   */
  async readProductImage(productId: number): Promise<string | null> {
    await this.s.page.goto(this.s.route('catalog/product/edit', { product_id: productId }), {
      waitUntil: 'domcontentloaded',
    });
    return this.s.page.evaluate(() => {
      const inp = document.querySelector<HTMLInputElement>('input[name="image"]');
      const v = inp?.value?.trim();
      return v && v.length > 3 ? v : null;
    });
  }
}

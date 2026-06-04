// Запуск браузера и вход в админку opt-spb.ru.
// Особенности входа (из базы проекта, раздел 2 и блокеры 9.2):
//  • без secureadmin=title&attempt=2 /admin редиректит на витрину;
//  • Chrome автозаполняет «Логин» значением Admin → перетираем на magazim;
//  • password-manager overlay перехватывает клики → отправляем форму через form.submit();
//  • токен берём из URL после успешного входа.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Config } from '../config.js';
import { log } from '../logger.js';

export class AdminSession {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  token = '';

  constructor(private cfg: Config) {}

  get adminBase(): string {
    return `${this.cfg.baseUrl}/admin/index.php`;
  }

  /** Маршрут админки с подставленным токеном. */
  route(route: string, params: Record<string, string | number> = {}): string {
    const usp = new URLSearchParams({ route, token: this.token });
    for (const [k, v] of Object.entries(params)) usp.set(k, String(v));
    return `${this.adminBase}?${usp.toString()}`;
  }

  async open(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.cfg.headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'ru-RU',
    });
    this.page = await this.context.newPage();
  }

  async login(): Promise<void> {
    const loginUrl = `${this.adminBase}?route=common/login&secureadmin=title&attempt=2`;
    log.step('Открываю страницу входа');
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // Перетираем автозаполнение и отправляем форму программно (обход overlay).
    await this.page.evaluate(
      ([user, pass]) => {
        const u = document.querySelector<HTMLInputElement>('input[name="username"]');
        const p = document.querySelector<HTMLInputElement>('input[name="password"]');
        if (u) u.value = user;
        if (p) p.value = pass;
        const form = (u?.closest('form') as HTMLFormElement | null) ?? document.querySelector('form');
        form?.submit();
      },
      [this.cfg.login, this.cfg.password] as const,
    );

    await this.page.waitForLoadState('domcontentloaded');
    // Дождаться редиректа на dashboard с токеном (с запасом по времени/повторам).
    const ok = await this.waitForToken();
    if (!ok) {
      const url = this.page.url();
      throw new Error(
        `Вход не подтверждён: не удалось получить token из URL (текущий URL: ${url}). ` +
          'Проверьте логин/пароль, лимит попыток, secureadmin-ограничение.',
      );
    }
    log.info('Вход выполнен, токен получен');
  }

  private async waitForToken(timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const url = this.page.url();
      const m = url.match(/[?&]token=([a-zA-Z0-9]+)/);
      if (m && !/route=common\/login/.test(url)) {
        this.token = m[1];
        return true;
      }
      await this.page.waitForTimeout(500);
    }
    // Иногда токен только в ссылках меню — попробуем вытащить из DOM.
    const tok = await this.page.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>('a[href*="token="]');
      const m = a?.href.match(/token=([a-zA-Z0-9]+)/);
      return m ? m[1] : '';
    });
    if (tok) {
      this.token = tok;
      return true;
    }
    return false;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

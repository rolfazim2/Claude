# Claude

## opt-spb-agent

Автономный AI-агент разбора оптовых тегов магазина **opt-spb.ru** (OpenCart-Pro 2.3.0.2):
привязка тегов поставщиков к точным карточкам, создание новых карточек и вынос спорных
случаев на согласование с точностью ≥ 95 %.

Стек: **TypeScript + Playwright** + **Claude API**, запуск на **GitHub Actions cron**.

→ Код и документация: [`opt-spb-agent/`](./opt-spb-agent/README.md)

## otask-bot

Telegram-бот для таск-трекера **otask.ru**: показывает назначенные задачи (описание,
сроки, приоритеты), подсвечивает просрочки, напоминает о скором дедлайне и позволяет
ставить задачи прямо из чата. Работает поверх API [`api.otask.ru`](https://api.otask.ru/docs).

Стек: **TypeScript + grammY**, long-polling + фоновый планировщик напоминаний.

→ Код и документация: [`otask-bot/`](./otask-bot/README.md)

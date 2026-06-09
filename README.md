# Claude

## messenger (Gram)

Аналог Telegram: сервер (Node.js, REST + WebSocket, SQLite), веб-клиент и
приложение для macOS (Electron). Личные и групповые чаты, реалтайм-доставка,
статусы прочтения, «печатает…», онлайн-статусы, тёмная тема.

→ Код и документация: [`messenger/`](./messenger/README.md)

## opt-spb-agent

Автономный AI-агент разбора оптовых тегов магазина **opt-spb.ru** (OpenCart-Pro 2.3.0.2):
привязка тегов поставщиков к точным карточкам, создание новых карточек и вынос спорных
случаев на согласование с точностью ≥ 95 %.

Стек: **TypeScript + Playwright** + **Claude API**, запуск на **GitHub Actions cron**.

→ Код и документация: [`opt-spb-agent/`](./opt-spb-agent/README.md)

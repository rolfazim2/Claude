# Деплой TaskFlow через GitHub

GitHub сам не запускает бэкенд (нужен сервер), поэтому схема такая:
**GitHub Actions собирает Docker-образы → публикует в GHCR → по SSH деплоит на ваш сервер.**

Образы: `ghcr.io/<owner>/taskflow-{api,web,bot}`.

---

## A. Что уже настроено (в репозитории)
- `.github/workflows/ci.yml` — сборка/проверка типов на каждый push.
- `.github/workflows/release.yml` — сборка и публикация образов в GHCR.
- `.github/workflows/deploy.yml` — деплой по SSH (ручной запуск или после публикации образов).
- `docker-compose.prod.yml` — запуск из готовых образов.

## B. Что нужно сделать один раз

### 1. Секреты репозитория (Settings → Secrets and variables → Actions → Secrets)
| Секрет | Значение |
|---|---|
| `SSH_HOST` | IP/домен сервера |
| `SSH_USER` | пользователь (напр. `root` или `deploy`) |
| `SSH_KEY` | приватный SSH-ключ (весь, включая `-----BEGIN...`) |
| `SSH_PORT` | порт SSH (если не 22) — опционально |

> Публичный ключ от этой пары добавьте на сервер в `~/.ssh/authorized_keys`.

### 2. Переменная репозитория (опционально)
`VITE_API_URL` задавать **не нужно**: фронтенд по умолчанию ходит на `/api`
того же домена, а nginx в веб-контейнере проксирует запросы к API.
Задайте её только если API живёт на другом домене.

### 3. Сделать GHCR-образы публичными (проще всего)
После первого прогона `release.yml`: GitHub → ваш профиль → Packages → каждый
`taskflow-*` → Package settings → Change visibility → Public.
(Иначе на сервере нужен `docker login ghcr.io`.)

### 4. Подготовить сервер
```bash
# установить Docker + compose plugin (Ubuntu)
curl -fsSL https://get.docker.com | sh

# каталог и .env
sudo mkdir -p /opt/taskflow && cd /opt/taskflow
sudo tee .env >/dev/null <<'EOF'
IMAGE_PREFIX=<owner-в-нижнем-регистре>     # напр. rolfazim2
POSTGRES_USER=taskflow
POSTGRES_PASSWORD=<надёжный-пароль>
POSTGRES_DB=taskflow
APP_SECRET=<длинная-случайная-строка>      # подпись токенов входа (openssl rand -hex 32)
ALLOW_DEMO_LOGIN=false                     # в проде демо-вход лучше выключить
BOT_TOKEN=<токен от @BotFather>
BOT_USERNAME=clatask_bot
BOT_SHARED_SECRET=<любая-длинная-строка>
EOF
```

## C. Запуск деплоя
1. Запушьте в ветку → `release.yml` соберёт и опубликует образы.
2. Actions → **Deploy to server (SSH)** → **Run workflow** (или сработает автоматически после публикации).
3. Откройте `http://<IP сервера>:8080` — вход через Telegram-бота @clatask_bot.
   **Первый вошедший автоматически становится главным администратором** —
   сид не обязателен. Демо-данные при желании:
   ```bash
   cd /opt/taskflow
   docker compose -f docker-compose.prod.yml exec api pnpm seed
   ```

## D. Обновления
Каждый push в ветку → новые образы → деплой. Миграции БД применяются
автоматически при старте `api` (`prisma migrate deploy`).

## Безопасность
- Никому не передавайте `SSH_KEY`/`BOT_TOKEN` в переписке — только в GitHub Secrets.
- Рекомендуется прикрыть веб/API доменом + HTTPS (nginx/Caddy) — могу добавить.

# Bot: Telegram-бот (grammY) через tsx. Запуск: BOT_TOKEN/API_URL/BOT_SHARED_SECRET в окружении.
FROM node:20-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
WORKDIR /app/apps/bot
CMD ["pnpm", "exec", "tsx", "src/index.ts"]

# API: Fastify + Prisma. Запуск: миграции + сервер (через tsx).
FROM node:20-slim

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @taskflow/api exec prisma generate

WORKDIR /app/apps/api
EXPOSE 3001
# Применяем миграции и запускаем сервер. Демо-данные — отдельно: `docker compose exec api pnpm seed`.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx src/index.ts"]

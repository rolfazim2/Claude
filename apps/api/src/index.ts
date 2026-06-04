// TaskFlow API — скелет бэкенда (Fastify).
// Дальше: PostgreSQL (Prisma), auth через Telegram, WebSocket, BullMQ-планировщик.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { STATUS_META, TASK_STATUSES } from '@taskflow/shared';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true, service: 'taskflow-api' }));

// Справочник статусов — пример общего домена между фронтом, ботом и API.
app.get('/meta/statuses', async () => TASK_STATUSES.map((s) => ({ code: s, ...STATUS_META[s] })));

// TODO: /auth/telegram, /tasks, /projects, /functions, /notifications, /reports
// TODO: WebSocket-шлюз для real-time, планировщик напоминаний (за 1ч/1д, МСК).

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`API on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

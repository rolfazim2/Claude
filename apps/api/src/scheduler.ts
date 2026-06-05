// Планировщик: напоминания за 1 день и за 1 час до срока (по МСК) + помощник
// вычисления следующей даты для повторяющихся задач.
// Без внешних очередей — лёгкий in-process тик каждую минуту. На бэкенде с
// несколькими инстансами заменяется на BullMQ/Redis.
import { prisma } from './db.js';
import { broadcast } from './realtime.js';
import { sendTelegram } from './telegram.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function runReminderTick(now = Date.now()) {
  const tasks = await prisma.task.findMany({
    where: {
      archived: false,
      status: { notIn: ['done', 'canceled'] },
      dueAt: { not: null },
    },
  });

  let sent = 0;
  for (const t of tasks) {
    const diff = t.dueAt!.getTime() - now;

    // За 1 день
    if (!t.remindedDayBefore && diff <= DAY && diff > HOUR) {
      await notify(t.id, t.assigneeId);
      await prisma.task.update({ where: { id: t.id }, data: { remindedDayBefore: true } });
      sent++;
    }
    // За 1 час
    if (!t.remindedHourBefore && diff <= HOUR && diff > 0) {
      await notify(t.id, t.assigneeId);
      await prisma.task.update({ where: { id: t.id }, data: { remindedHourBefore: true } });
      sent++;
    }
  }
  return sent;
}

async function notify(taskId: string, userId: string | null) {
  if (!userId) return;
  await prisma.notification.create({ data: { userId, taskId, type: 'due_soon' } });
  broadcast({ type: 'notification.created', userId });
  // Дублируем напоминание в Telegram, если аккаунт привязан.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (user?.telegramId && task) {
    const when = task.dueAt ? new Date(task.dueAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '';
    await sendTelegram(user.telegramId, `⏰ Напоминание: <b>${task.title}</b>\nСрок: ${when} (МСК)`);
  }
}

/** Следующая дата для повторяющейся задачи (null — не повторять). */
export function nextOccurrence(
  freq: string,
  from: Date,
  interval = 1,
): Date | null {
  const d = new Date(from);
  switch (freq) {
    case 'daily':
      d.setDate(d.getDate() + interval);
      return d;
    case 'weekly':
      d.setDate(d.getDate() + 7 * interval);
      return d;
    case 'monthly':
      d.setMonth(d.getMonth() + interval);
      return d;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3 * interval);
      return d;
    default:
      // none / on_date — не повторяем
      return null;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    runReminderTick().catch((e) => console.error('reminder tick error', e));
  }, intervalMs);
  // Первый прогон сразу.
  runReminderTick().catch(() => {});
}

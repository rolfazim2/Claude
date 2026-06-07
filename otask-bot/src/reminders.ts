import type { Bot } from 'grammy';
import { config } from './config.js';
import { OtaskClient } from './otask/client.js';
import type { Task } from './otask/types.js';
import { store } from './store.js';
import { formatTaskCard } from './format.js';

/**
 * Периодически опрашивает otask и шлёт напоминания:
 *  • о задачах, у которых дедлайн наступит в ближайшие REMINDER_LEAD_HOURS;
 *  • о задачах, которые только что стали просроченными.
 * Дедупликация — через store, чтобы не спамить одинаковыми напоминаниями.
 */
export function startReminders(bot: Bot): () => void {
  const intervalMs = Math.max(1, config.reminderPollMinutes) * 60_000;
  let running = false;

  const tick = async () => {
    if (running) return; // не наслаиваем прогоны
    running = true;
    try {
      await runOnce(bot);
    } catch (e) {
      console.error('[reminders] прогон упал:', (e as Error).message);
    } finally {
      running = false;
    }
  };

  // Первый прогон — с небольшой задержкой после старта.
  const startTimer = setTimeout(tick, 10_000);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(startTimer);
    clearInterval(timer);
  };
}

async function runOnce(bot: Bot): Promise<void> {
  const chats = await store.chatsForReminders();
  const now = new Date();
  const leadMs = config.reminderLeadHours * 3600_000;

  for (const chatId of chats) {
    const key = await store.getApiKey(chatId);
    if (!key) continue;

    let tasks: Task[];
    try {
      tasks = await new OtaskClient(key).listAssignedTasks();
    } catch (e) {
      console.error(`[reminders] chat ${chatId}: ${(e as Error).message}`);
      continue;
    }

    for (const task of tasks) {
      if (task.done || !task.deadline) continue;
      const dueMs = new Date(task.deadline).getTime();
      const delta = dueMs - now.getTime();

      if (delta < 0) {
        // Просрочена. Сбрасываем «предупреждали о дедлайне», шлём про просрочку один раз.
        if (await store.markReminded(chatId, task.id, 'overdue')) {
          await safeSend(bot, chatId, `⚠️ <b>Задача просрочена!</b>\n\n${formatTaskCard(task, now)}`);
        }
      } else if (delta <= leadMs) {
        // Скоро дедлайн.
        if (await store.markReminded(chatId, task.id, 'deadline')) {
          const left = Math.max(1, Math.round(delta / 3600_000));
          await safeSend(
            bot,
            chatId,
            `⏰ <b>Скоро дедлайн</b> (через ~${left} ч)\n\n${formatTaskCard(task, now)}`,
          );
        }
      } else {
        // Дедлайн снова далеко (его перенесли) — разрешим напомнить заново позже.
        await store.clearReminded(chatId, task.id, 'deadline');
        await store.clearReminded(chatId, task.id, 'overdue');
      }
    }
  }
}

async function safeSend(bot: Bot, chatId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (e) {
    console.error(`[reminders] не смог отправить в chat ${chatId}: ${(e as Error).message}`);
  }
}

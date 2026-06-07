"""Фоновый планировщик напоминаний о дедлайнах."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from aiogram import Bot
from aiogram.enums import ParseMode

from .config import config
from .formatting import format_task_card
from .otask_client import OtaskClient, OtaskError
from . import store

logger = logging.getLogger("otask-bot.reminders")
_client = OtaskClient()


async def run_reminders_once(bot: Bot) -> None:
    """Один прогон: разослать напоминания всем подписанным чатам."""
    chats = await store.chats_for_reminders()
    if not chats:
        return

    now = datetime.now(timezone.utc)
    lead = config.reminder_lead_hours * 3600

    try:
        tasks = await _client.list_assigned_tasks()
    except OtaskError as e:
        logger.warning("Не удалось получить задачи: %s", e)
        return

    for task in tasks:
        if task.done or task.deadline is None:
            continue
        delta = (task.deadline - now).total_seconds()

        if delta < 0:
            await _notify_all(bot, chats, task, "overdue",
                              f"⚠️ <b>Задача просрочена!</b>\n\n{format_task_card(task, now)}")
        elif delta <= lead:
            left = max(1, round(delta / 3600))
            await _notify_all(bot, chats, task, "deadline",
                              f"⏰ <b>Скоро дедлайн</b> (через ~{left} ч)\n\n{format_task_card(task, now)}")
        else:
            # Дедлайн снова далеко (перенесли) — разрешим напомнить заново позже.
            for chat_id in chats:
                await store.clear_reminded(chat_id, task.id, "deadline")
                await store.clear_reminded(chat_id, task.id, "overdue")


async def _notify_all(bot: Bot, chats: list[int], task, kind: str, text: str) -> None:
    for chat_id in chats:
        if await store.mark_reminded(chat_id, task.id, kind):
            try:
                await bot.send_message(
                    chat_id, text, parse_mode=ParseMode.HTML, disable_web_page_preview=True
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("Не смог отправить в чат %s: %s", chat_id, e)

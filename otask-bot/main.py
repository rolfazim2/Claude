"""Точка входа otask-bot: long-polling + планировщик напоминаний."""
from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from bot.config import config
from bot.handlers import router
from bot.reminders import run_reminders_once

BOT_COMMANDS = [
    BotCommand(command="tasks", description="Мои назначенные задачи"),
    BotCommand(command="overdue", description="Просроченные задачи"),
    BotCommand(command="soon", description="Скоро дедлайн"),
    BotCommand(command="task", description="Карточка задачи: /task id"),
    BotCommand(command="done", description="Завершить задачу: /done id"),
    BotCommand(command="new", description="Поставить задачу"),
    BotCommand(command="reminders", description="Напоминания: on|off"),
    BotCommand(command="help", description="Список команд"),
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("otask-bot")


async def main() -> None:
    bot = Bot(token=config.bot_token)
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        run_reminders_once,
        "interval",
        minutes=max(1, config.reminder_poll_minutes),
        args=[bot],
        next_run_time=None,
    )
    scheduler.start()
    logger.info(
        "Планировщик запущен: опрос каждые %d мин, окно напоминаний %d ч",
        config.reminder_poll_minutes,
        config.reminder_lead_hours,
    )

    await bot.set_my_commands(BOT_COMMANDS)
    me = await bot.get_me()
    logger.info("Авторизован как @%s. Запускаю long-polling…", me.username)
    try:
        await dp.start_polling(bot, allowed_updates=["message", "callback_query"])
    finally:
        scheduler.shutdown(wait=False)
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Остановлено.")

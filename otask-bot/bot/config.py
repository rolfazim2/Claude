"""Чтение и валидация переменных окружения."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Не задана обязательная переменная окружения {name} (см. .env.example)")
    return value


def _num(name: str, fallback: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return fallback
    try:
        return int(raw)
    except ValueError:
        return fallback


@dataclass(frozen=True)
class Config:
    bot_token: str
    api_base: str
    api_key: str
    data_dir: str
    reminder_lead_hours: int
    reminder_poll_minutes: int
    timezone: str


config = Config(
    bot_token=_required("BOT_TOKEN"),
    api_base=(os.getenv("OTASK_API_BASE") or "https://api.otask.ru").rstrip("/"),
    api_key=_required("OTASK_API_KEY"),
    data_dir=os.getenv("DATA_DIR") or "./data",
    reminder_lead_hours=_num("REMINDER_LEAD_HOURS", 24),
    reminder_poll_minutes=_num("REMINDER_POLL_MINUTES", 15),
    timezone=os.getenv("TIMEZONE") or "Europe/Moscow",
)

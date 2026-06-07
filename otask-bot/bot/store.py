"""Простое файловое хранилище (JSON).

Одноаккаунтный режим: ключ otask берётся из конфига, поэтому здесь храним
только список чатов-подписчиков, флаг напоминаний и дедупликацию напоминаний.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from .config import config

_FILE = os.path.join(config.data_dir, "store.json")
_lock = asyncio.Lock()
_db: dict[str, Any] = {"chats": {}}
_loaded = False


def _blank_chat() -> dict[str, Any]:
    return {"reminders_enabled": True, "reminded_deadline": [], "reminded_overdue": []}


async def _ensure_loaded() -> None:
    global _loaded, _db
    if _loaded:
        return
    try:
        with open(_FILE, encoding="utf-8") as f:
            _db = json.load(f)
        if "chats" not in _db:
            _db["chats"] = {}
    except (FileNotFoundError, json.JSONDecodeError):
        _db = {"chats": {}}
    _loaded = True


async def _persist() -> None:
    os.makedirs(os.path.dirname(_FILE) or ".", exist_ok=True)
    tmp = _FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _FILE)


async def _chat(chat_id: int) -> dict[str, Any]:
    await _ensure_loaded()
    key = str(chat_id)
    if key not in _db["chats"]:
        _db["chats"][key] = _blank_chat()
    return _db["chats"][key]


async def register_chat(chat_id: int) -> None:
    """Запомнить чат как подписчика (после /start)."""
    async with _lock:
        await _chat(chat_id)
        await _persist()


async def set_reminders(chat_id: int, enabled: bool) -> None:
    async with _lock:
        chat = await _chat(chat_id)
        chat["reminders_enabled"] = enabled
        await _persist()


async def chats_for_reminders() -> list[int]:
    async with _lock:
        await _ensure_loaded()
        return [int(k) for k, c in _db["chats"].items() if c.get("reminders_enabled")]


async def mark_reminded(chat_id: int, task_id: str, kind: str) -> bool:
    """Пометить напоминание отправленным. True, если ещё не слали."""
    field = "reminded_deadline" if kind == "deadline" else "reminded_overdue"
    async with _lock:
        chat = await _chat(chat_id)
        lst: list[str] = chat[field]
        if task_id in lst:
            return False
        lst.append(task_id)
        if len(lst) > 1000:
            del lst[: len(lst) - 1000]
        await _persist()
        return True


async def clear_reminded(chat_id: int, task_id: str, kind: str) -> None:
    field = "reminded_deadline" if kind == "deadline" else "reminded_overdue"
    async with _lock:
        chat = await _chat(chat_id)
        lst: list[str] = chat[field]
        if task_id in lst:
            lst.remove(task_id)
            await _persist()

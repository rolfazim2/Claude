"""Обработчики команд Telegram (aiogram 3.x)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from aiogram import Router
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandObject, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

from .config import config
from .formatting import format_task_card, format_task_list, is_overdue
from .otask_client import OtaskClient, OtaskError
from . import store

router = Router()

# Один клиент на всех (одноаккаунтный режим).
_client = OtaskClient()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _report_error(e: Exception) -> str:
    if isinstance(e, OtaskError):
        return f"⚠️ {e}"
    return f"⚠️ Непредвиденная ошибка: {e}"


# ── Простые команды ──────────────────────────────────────────────────────────

@router.message(Command("start"))
async def cmd_start(message: Message) -> None:
    await store.register_chat(message.chat.id)
    await message.answer(
        "\n".join(
            [
                "👋 Привет! Я бот для <b>otask.ru</b>.",
                "",
                "Что умею:",
                "• /tasks — мои назначенные задачи",
                "• /overdue — просроченные",
                "• /soon — у которых скоро дедлайн",
                "• /task <i>id</i> — карточка задачи",
                "• /new — поставить задачу (мастер)",
                "• /reminders <i>on|off</i> — напоминания о дедлайнах",
                "",
                "🔔 Напоминания уже включены — буду писать о близких и просроченных дедлайнах.",
            ]
        ),
        parse_mode=ParseMode.HTML,
    )


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(
        "\n".join(
            [
                "Команды:",
                "/tasks — назначенные задачи",
                "/overdue — просроченные задачи",
                "/soon — задачи с близким дедлайном",
                "/task id — карточка конкретной задачи",
                "/new — поставить задачу пошагово",
                "/new Заголовок | описание | 2026-06-10 18:00 | high — одной строкой",
                "/reminders on | off — вкл/выкл напоминания",
            ]
        )
    )


@router.message(Command("reminders"))
async def cmd_reminders(message: Message, command: CommandObject) -> None:
    arg = (command.args or "").strip().lower()
    if arg not in ("on", "off"):
        await message.answer(
            "Использование: <code>/reminders on</code> или <code>/reminders off</code>",
            parse_mode=ParseMode.HTML,
        )
        return
    await store.register_chat(message.chat.id)
    await store.set_reminders(message.chat.id, arg == "on")
    await message.answer("🔔 Напоминания включены." if arg == "on" else "🔕 Напоминания выключены.")


@router.message(Command("tasks"))
async def cmd_tasks(message: Message) -> None:
    try:
        tasks = [t for t in await _client.list_assigned_tasks() if not t.done]
        for msg in format_task_list("📋 Назначенные задачи", tasks):
            await message.answer(msg, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    except Exception as e:  # noqa: BLE001
        await message.answer(_report_error(e))


@router.message(Command("overdue"))
async def cmd_overdue(message: Message) -> None:
    now = _now()
    try:
        tasks = [t for t in await _client.list_assigned_tasks() if is_overdue(t, now)]
        for msg in format_task_list("⚠️ Просроченные задачи", tasks, now):
            await message.answer(msg, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    except Exception as e:  # noqa: BLE001
        await message.answer(_report_error(e))


@router.message(Command("soon"))
async def cmd_soon(message: Message) -> None:
    now = _now()
    horizon = now.timestamp() + config.reminder_lead_hours * 3600
    try:
        tasks = [
            t
            for t in await _client.list_assigned_tasks()
            if not t.done
            and t.deadline is not None
            and not is_overdue(t, now)
            and t.deadline.timestamp() <= horizon
        ]
        title = f"⏰ Дедлайн в ближайшие {config.reminder_lead_hours} ч"
        for msg in format_task_list(title, tasks, now):
            await message.answer(msg, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    except Exception as e:  # noqa: BLE001
        await message.answer(_report_error(e))


@router.message(Command("task"))
async def cmd_task(message: Message, command: CommandObject) -> None:
    task_id = (command.args or "").strip()
    if not task_id:
        await message.answer("Использование: <code>/task ID_задачи</code>", parse_mode=ParseMode.HTML)
        return
    try:
        task = await _client.get_task(task_id)
        await message.answer(format_task_card(task), parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    except Exception as e:  # noqa: BLE001
        await message.answer(_report_error(e))


# ── Мастер создания задачи (FSM) ─────────────────────────────────────────────

class NewTask(StatesGroup):
    title = State()
    description = State()
    deadline = State()
    priority = State()


@router.message(Command("new"))
async def cmd_new(message: Message, command: CommandObject, state: FSMContext) -> None:
    inline = (command.args or "").strip()
    if inline:
        draft = _parse_inline_task(inline)
        if not draft["title"]:
            await message.answer("Нужен хотя бы заголовок: <code>/new Сделать отчёт</code>", parse_mode=ParseMode.HTML)
            return
        await _submit_task(message, draft)
        return
    await state.set_state(NewTask.title)
    await message.answer("📝 Новая задача. Введите <b>заголовок</b> (или /cancel для отмены):", parse_mode=ParseMode.HTML)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    if await state.get_state() is None:
        await message.answer("Нечего отменять.")
        return
    await state.clear()
    await message.answer("Отменено.")


@router.message(NewTask.title)
async def step_title(message: Message, state: FSMContext) -> None:
    await state.update_data(title=(message.text or "").strip())
    await state.set_state(NewTask.description)
    await message.answer("Введите <b>описание</b> (или «-» чтобы пропустить):", parse_mode=ParseMode.HTML)


@router.message(NewTask.description)
async def step_description(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text != "-":
        await state.update_data(description=text)
    await state.set_state(NewTask.deadline)
    await message.answer(
        "Укажите <b>срок</b> в формате <code>ГГГГ-ММ-ДД ЧЧ:ММ</code> (или «-» чтобы пропустить):",
        parse_mode=ParseMode.HTML,
    )


@router.message(NewTask.deadline)
async def step_deadline(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text != "-":
        dt = _parse_deadline(text)
        if dt is None:
            await message.answer(
                "Не понял дату. Пример: <code>2026-06-10 18:00</code>. Попробуйте ещё раз или «-».",
                parse_mode=ParseMode.HTML,
            )
            return
        await state.update_data(deadline=dt.isoformat())
    await state.set_state(NewTask.priority)
    await message.answer("Приоритет: low / normal / high / critical (или «-» для обычного):")


@router.message(NewTask.priority)
async def step_priority(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    data = await state.get_data()
    await state.clear()
    draft = {
        "title": data.get("title", ""),
        "description": data.get("description"),
        "deadline": data.get("deadline"),
        "priority": None if text == "-" else _parse_priority(text),
    }
    await _submit_task(message, draft)


async def _submit_task(message: Message, draft: dict) -> None:
    deadline = None
    if draft.get("deadline"):
        deadline = datetime.fromisoformat(draft["deadline"])
    try:
        task = await _client.create_task(
            title=draft["title"],
            description=draft.get("description"),
            deadline=deadline,
            priority=draft.get("priority"),
        )
        builder = InlineKeyboardBuilder()
        if task.url:
            builder.button(text="Открыть в otask", url=task.url)
        await message.answer(
            f"✅ Задача создана:\n\n{format_task_card(task)}",
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=True,
            reply_markup=builder.as_markup() if task.url else None,
        )
    except Exception as e:  # noqa: BLE001
        await message.answer(_report_error(e))


# ── Парсинг пользовательского ввода ──────────────────────────────────────────

def _parse_inline_task(text: str) -> dict:
    parts = [p.strip() for p in text.split("|")]
    title = parts[0] if parts else ""
    description = parts[1] if len(parts) > 1 and parts[1] else None
    deadline = None
    if len(parts) > 2 and parts[2]:
        dt = _parse_deadline(parts[2])
        if dt is not None:
            deadline = dt.isoformat()
    priority = _parse_priority(parts[3]) if len(parts) > 3 and parts[3] else None
    return {"title": title, "description": description, "deadline": deadline, "priority": priority}


def _parse_priority(text: str) -> str:
    v = text.lower().strip()
    if any(k in v for k in ("critical", "критич", "urgent", "срочно")):
        return "critical"
    if any(k in v for k in ("high", "высок", "важн")):
        return "high"
    if any(k in v for k in ("low", "низк")):
        return "low"
    return "normal"


def _parse_deadline(text: str) -> Optional[datetime]:
    t = text.strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$", t)
    if m:
        y, mo, d, h, mi = m.group(1), m.group(2), m.group(3), m.group(4) or "09", m.group(5) or "00"
        return _build_dt(int(y), int(mo), int(d), int(h), int(mi))
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$", t)
    if m:
        d, mo, y, h, mi = m.group(1), m.group(2), m.group(3), m.group(4) or "09", m.group(5) or "00"
        return _build_dt(int(y), int(mo), int(d), int(h), int(mi))
    try:
        dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=_tz())
    except ValueError:
        return None


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(config.timezone)
    except Exception:
        return timezone.utc


def _build_dt(y: int, mo: int, d: int, h: int, mi: int) -> Optional[datetime]:
    try:
        return datetime(y, mo, d, h, mi, tzinfo=_tz())
    except ValueError:
        return None

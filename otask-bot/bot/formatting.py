"""Форматирование задач для сообщений Telegram (HTML)."""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from typing import Optional

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo  # type: ignore
except Exception:  # pragma: no cover
    _TZ = None  # type: ignore

from .config import config
from .otask_client import Task

PRIORITY_LABEL = {
    "critical": "🔴 Критический",
    "high": "🟠 Высокий",
    "normal": "🟡 Обычный",
    "low": "🟢 Низкий",
    "unknown": "⚪️ Без приоритета",
}
PRIORITY_RANK = {"critical": 0, "high": 1, "normal": 2, "low": 3, "unknown": 4}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _local(dt: datetime) -> datetime:
    if _TZ is not None:
        try:
            return dt.astimezone(_TZ(config.timezone))
        except Exception:
            pass
    return dt


def is_overdue(task: Task, now: Optional[datetime] = None) -> bool:
    now = now or _now()
    return (not task.done) and task.deadline is not None and task.deadline < now


def _humanize(seconds: float) -> str:
    seconds = abs(seconds)
    minutes = round(seconds / 60)
    if minutes < 60:
        return f"{minutes} мин"
    hours = round(minutes / 60)
    if hours < 48:
        return f"{hours} ч"
    return f"{round(hours / 24)} дн"


def format_deadline(deadline: Optional[datetime], now: Optional[datetime] = None) -> str:
    if deadline is None:
        return "без срока"
    now = now or _now()
    date = _local(deadline).strftime("%d.%m.%Y %H:%M")
    delta = (deadline - now).total_seconds()
    rel = _humanize(delta)
    return f"{date} (просрочено {rel})" if delta < 0 else f"{date} (через {rel})"


def priority_label(priority: str) -> str:
    return PRIORITY_LABEL.get(priority, PRIORITY_LABEL["unknown"])


def sort_tasks(tasks: list[Task], now: Optional[datetime] = None) -> list[Task]:
    now = now or _now()
    far = datetime.max.replace(tzinfo=timezone.utc)

    def key(t: Task):
        overdue = 0 if is_overdue(t, now) else 1
        due = t.deadline or far
        return (overdue, due, PRIORITY_RANK.get(t.priority, 4))

    return sorted(tasks, key=key)


def format_task_line(task: Task, now: Optional[datetime] = None) -> str:
    now = now or _now()
    flag = "⚠️ " if is_overdue(task, now) else ""
    title = escape(task.title)
    link = f'<a href="{escape(task.url)}">{title}</a>' if task.url else title
    emoji = priority_label(task.priority).split(" ")[0]
    due = f" — ⏰ {escape(format_deadline(task.deadline, now))}" if task.deadline else ""
    return f"{flag}{emoji} {link}{due}"


def format_task_card(task: Task, now: Optional[datetime] = None) -> str:
    now = now or _now()
    lines = [f"<b>{escape(task.title)}</b>"]
    if is_overdue(task, now):
        lines.append("⚠️ <b>Просрочена</b>")
    lines.append(f"Приоритет: {priority_label(task.priority)}")
    if task.status:
        lines.append(f"Статус: {escape(task.status)}")
    lines.append(f"Срок: {escape(format_deadline(task.deadline, now))}")
    if task.description:
        desc = task.description if len(task.description) <= 800 else task.description[:800] + "…"
        lines.append("")
        lines.append(escape(desc))
    if task.url:
        lines.append("")
        lines.append(f'🔗 <a href="{escape(task.url)}">Открыть в otask</a>')
    return "\n".join(lines)


def format_task_list(title: str, tasks: list[Task], now: Optional[datetime] = None) -> list[str]:
    now = now or _now()
    if not tasks:
        return [f"{title}\n\nНичего нет 🎉"]
    ordered = sort_tasks(tasks, now)
    messages: list[str] = []
    buf = f"{title} ({len(ordered)})"
    for t in ordered:
        line = "\n\n" + format_task_line(t, now)
        if len(buf) + len(line) > 3800:
            messages.append(buf)
            buf = line.lstrip()
        else:
            buf += line
    messages.append(buf)
    return messages

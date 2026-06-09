"""Тесты чистой логики: нормализация API, форматирование, парсеры ввода.

Запуск: pip install -r requirements-dev.txt && pytest
Сетевых вызовов нет — проверяется только локальная логика.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

# Конфиг требует обязательные переменные ещё на импорте — задаём до импорта bot.*
os.environ.setdefault("BOT_TOKEN", "test:token")
os.environ.setdefault("OTASK_API_KEY", "test-key")
os.environ.setdefault("TIMEZONE", "Europe/Moscow")

from bot.formatting import (  # noqa: E402
    format_deadline, format_task_card, format_task_list, is_overdue, sort_tasks,
)
from bot.handlers import _parse_deadline, _parse_inline_task, _parse_priority  # noqa: E402
from bot.otask_client import _extract_list, _normalize_task, _unwrap_item  # noqa: E402

NOW = datetime(2026, 6, 7, 12, 0, tzinfo=timezone.utc)


# ── Нормализация ответов API ─────────────────────────────────────────────────

def test_normalize_handles_alias_fields():
    t = _normalize_task({"name": "A", "text": "desc", "due_date": "2026-06-08T10:00:00Z",
                         "importance": "high", "state": "in progress", "task_id": 9})
    assert t.id == "9"
    assert t.title == "A"
    assert t.description == "desc"
    assert t.priority == "high"
    assert t.deadline == datetime(2026, 6, 8, 10, 0, tzinfo=timezone.utc)
    assert t.done is False


def test_normalize_done_detection_by_status():
    assert _normalize_task({"id": 1, "status": "Закрыто"}).done is True
    assert _normalize_task({"id": 2, "completed": True}).done is True
    assert _normalize_task({"id": 3, "status": "new"}).done is False


def test_normalize_priority_variants():
    assert _normalize_task({"id": 1, "priority": "критический"}).priority == "critical"
    assert _normalize_task({"id": 2, "severity": "4"}).priority == "critical"
    assert _normalize_task({"id": 3, "priority": "low"}).priority == "low"
    assert _normalize_task({"id": 4}).priority == "unknown"


def test_naive_datetime_treated_as_utc():
    t = _normalize_task({"id": 1, "deadline": "2026-06-08 10:00:00"})
    assert t.deadline is not None and t.deadline.tzinfo is not None


def test_missing_title_has_fallback():
    assert _normalize_task({"id": 1}).title == "(без названия)"


def test_extract_list_from_wrappers():
    assert _extract_list({"data": [{"id": 1}]}) == [{"id": 1}]
    assert _extract_list({"tasks": [{"id": 2}]}) == [{"id": 2}]
    assert _extract_list([{"id": 3}]) == [{"id": 3}]
    assert _extract_list({"nope": 1}) == []


def test_unwrap_item():
    assert _unwrap_item({"data": {"id": 1}}) == {"id": 1}
    assert _unwrap_item({"task": {"id": 2}}) == {"id": 2}
    assert _unwrap_item({"id": 3}) == {"id": 3}


# ── Просрочки и сортировка ───────────────────────────────────────────────────

def test_is_overdue():
    past = _normalize_task({"id": 1, "deadline": "2026-06-06T10:00:00Z"})
    future = _normalize_task({"id": 2, "deadline": "2026-06-09T10:00:00Z"})
    done_past = _normalize_task({"id": 3, "deadline": "2026-06-06T10:00:00Z", "status": "done"})
    assert is_overdue(past, NOW) is True
    assert is_overdue(future, NOW) is False
    assert is_overdue(done_past, NOW) is False  # завершённые не считаются просроченными


def test_sort_overdue_first_then_deadline_then_priority():
    overdue = _normalize_task({"id": "o", "deadline": "2026-06-06T10:00:00Z"})
    soon = _normalize_task({"id": "s", "deadline": "2026-06-08T10:00:00Z", "priority": "low"})
    later = _normalize_task({"id": "l", "deadline": "2026-06-20T10:00:00Z"})
    no_due = _normalize_task({"id": "n"})
    order = [t.id for t in sort_tasks([no_due, later, soon, overdue], NOW)]
    assert order == ["o", "s", "l", "n"]


# ── Форматирование ───────────────────────────────────────────────────────────

def test_format_deadline_relative_and_timezone():
    dl = datetime(2026, 6, 8, 10, 0, tzinfo=timezone.utc)
    out = format_deadline(dl, NOW)
    assert "08.06.2026 13:00" in out  # UTC+3 (Москва)
    assert "через" in out


def test_format_deadline_overdue_label():
    dl = datetime(2026, 6, 6, 10, 0, tzinfo=timezone.utc)
    assert "просрочено" in format_deadline(dl, NOW)


def test_format_deadline_none():
    assert format_deadline(None, NOW) == "без срока"


def test_format_card_escapes_html():
    t = _normalize_task({"id": 1, "name": "<b>x</b> & y", "priority": "high"})
    card = format_task_card(t, NOW)
    assert "&lt;b&gt;x&lt;/b&gt; &amp; y" in card


def test_format_list_empty():
    msgs = format_task_list("Задачи", [], NOW)
    assert len(msgs) == 1 and "Ничего нет" in msgs[0]


def test_format_list_splits_long_output():
    tasks = [_normalize_task({"id": i, "name": "x" * 200}) for i in range(60)]
    msgs = format_task_list("Задачи", tasks, NOW)
    assert len(msgs) > 1
    assert all(len(m) <= 4000 for m in msgs)


# ── Парсеры пользовательского ввода ──────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("очень срочно", "critical"),
    ("high", "high"),
    ("низкий", "low"),
    ("что-то", "normal"),
])
def test_parse_priority(text, expected):
    assert _parse_priority(text) == expected


def test_parse_deadline_formats():
    assert _parse_deadline("2026-06-10 18:00") is not None
    assert _parse_deadline("2026-06-10") is not None
    assert _parse_deadline("10.06.2026 18:00") is not None
    assert _parse_deadline("ерунда") is None


def test_parse_deadline_date_only_defaults_to_morning():
    dt = _parse_deadline("2026-06-10")
    assert dt is not None and dt.hour == 9


def test_parse_inline_task_full():
    d = _parse_inline_task("Купить кофе | нужно много | 2026-06-10 18:00 | high")
    assert d["title"] == "Купить кофе"
    assert d["description"] == "нужно много"
    assert d["deadline"] is not None
    assert d["priority"] == "high"


def test_parse_inline_task_title_only():
    d = _parse_inline_task("Просто заголовок")
    assert d["title"] == "Просто заголовок"
    assert d["description"] is None
    assert d["deadline"] is None
    assert d["priority"] is None

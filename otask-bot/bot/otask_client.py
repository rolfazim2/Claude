"""Клиент API otask.ru.

┌─ ВАЖНО ─────────────────────────────────────────────────────────────────┐
│ Точные пути и имена полей нужно сверить с https://api.otask.ru/docs.      │
│ Всё, что зависит от схемы API, собрано здесь: ENDPOINTS, _normalize_task, │
│ _serialize_create. Если реальная схема отличается — правки нужны только   │
│ в этом файле, остальной код бота трогать не придётся.                     │
└──────────────────────────────────────────────────────────────────────────┘
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import aiohttp

from .config import config

ENDPOINTS = {
    "list_tasks": "/tasks",   # GET, поддерживает query-параметры
    "task": "/tasks",         # GET /tasks/{id}
    "create_task": "/tasks",  # POST
    "update_task": "/tasks",  # PATCH /tasks/{id}
}

# Значение поля статуса, означающее «выполнено» при завершении задачи.
# Сверьте с реальной схемой otask (возможно, нужен id колонки/этапа, а не строка).
DONE_STATUS = "done"

PRIORITY_VALUES = ("low", "normal", "high", "critical", "unknown")


@dataclass
class Task:
    id: str
    title: str
    description: Optional[str]
    deadline: Optional[datetime]  # tz-aware
    priority: str
    status: Optional[str]
    done: bool
    url: Optional[str]


class OtaskError(Exception):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class OtaskClient:
    def __init__(self, api_key: str = config.api_key, base: str = config.api_base):
        if not api_key:
            raise OtaskError("Не задан API-ключ otask")
        self._api_key = api_key
        self._base = base

    async def _request(self, path: str, method: str = "GET", json: Any = None) -> Any:
        url = f"{self._base}{path}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.request(
                    method, url, headers=headers, json=json,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status in (401, 403):
                        raise OtaskError(
                            "otask отклонил API-ключ (401/403). Проверьте OTASK_API_KEY.",
                            resp.status,
                        )
                    if resp.status == 204:
                        return None
                    if resp.status >= 400:
                        body = await resp.text()
                        raise OtaskError(f"otask вернул {resp.status}: {body[:300]}", resp.status)
                    return await resp.json()
        except aiohttp.ClientError as e:
            raise OtaskError(f"Сеть недоступна при запросе к otask: {e}") from e

    async def ping(self) -> None:
        await self._request(f"{ENDPOINTS['list_tasks']}?limit=1")

    async def list_assigned_tasks(self) -> list[Task]:
        raw = await self._request(f"{ENDPOINTS['list_tasks']}?assigned=me&limit=200")
        return [_normalize_task(item) for item in _extract_list(raw)]

    async def get_task(self, task_id: str) -> Task:
        raw = await self._request(f"{ENDPOINTS['task']}/{task_id}")
        return _normalize_task(_unwrap_item(raw))

    async def create_task(
        self,
        title: str,
        description: Optional[str] = None,
        deadline: Optional[datetime] = None,
        priority: Optional[str] = None,
    ) -> Task:
        body = _serialize_create(title, description, deadline, priority)
        raw = await self._request(ENDPOINTS["create_task"], method="POST", json=body)
        return _normalize_task(_unwrap_item(raw))

    async def complete_task(self, task_id: str) -> Task:
        """Пометить задачу выполненной."""
        body = {"status": DONE_STATUS, "is_done": True}
        raw = await self._request(
            f"{ENDPOINTS['update_task']}/{task_id}", method="PATCH", json=body
        )
        if raw is None:  # 204 No Content — перечитаем задачу
            return await self.get_task(task_id)
        return _normalize_task(_unwrap_item(raw))


# ── Нормализация ответов API ────────────────────────────────────────────────
# otask может оборачивать данные в {data}/{items}/{tasks} и называть поля
# по-русски/по-английски. Делаем разбор устойчивым.

def _extract_list(raw: Any) -> list[dict]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in ("data", "items", "tasks", "results", "list"):
            value = raw.get(key)
            if isinstance(value, list):
                return value
    return []


def _unwrap_item(raw: Any) -> dict:
    if isinstance(raw, dict):
        data = raw.get("data")
        if isinstance(data, dict):
            return data
        task = raw.get("task")
        if isinstance(task, dict):
            return task
        return raw
    return {}


def _pick(obj: dict, *keys: str) -> Any:
    for key in keys:
        value = obj.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_task(obj: dict) -> Task:
    task_id = _as_str(_pick(obj, "id", "uuid", "task_id", "number")) or ""
    title = _as_str(_pick(obj, "title", "name", "subject", "header")) or "(без названия)"
    description = _as_str(_pick(obj, "description", "text", "body", "content"))
    deadline = _parse_dt(_pick(obj, "deadline", "due_date", "dueDate", "due", "date_end", "finish_at"))
    priority = _normalize_priority(_pick(obj, "priority", "importance", "severity"))
    status = _as_str(_pick(obj, "status", "state", "stage", "column"))
    done = _is_done(status, _pick(obj, "is_done", "completed", "closed"))
    url = _as_str(_pick(obj, "url", "link", "web_url")) or _build_url(task_id)
    return Task(task_id, title, description, deadline, priority, status, done, url)


def _as_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value if isinstance(value, str) else str(value)


def _parse_dt(value: Any) -> Optional[datetime]:
    s = _as_str(value)
    if not s:
        return None
    text = s.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _normalize_priority(value: Any) -> str:
    s = (_as_str(value) or "").lower().strip()
    if not s:
        return "unknown"
    if any(k in s for k in ("4", "critical", "критич", "urgent", "срочн", "highest")):
        return "critical"
    if any(k in s for k in ("3", "high", "высок", "важн")):
        return "high"
    if any(k in s for k in ("1", "low", "низк", "minor")):
        return "low"
    if any(k in s for k in ("2", "normal", "medium", "обычн", "средн")):
        return "normal"
    return "unknown"


def _is_done(status: Optional[str], flag: Any) -> bool:
    if flag in (True, 1, "1", "true"):
        return True
    s = (status or "").lower()
    return any(k in s for k in ("done", "closed", "complete", "выполн", "закрыт", "заверш"))


def _build_url(task_id: str) -> Optional[str]:
    if not task_id:
        return None
    # Веб-интерфейс otask. При необходимости поправьте шаблон под свой аккаунт.
    return f"https://otask.ru/task/{task_id}"


def _serialize_create(
    title: str,
    description: Optional[str],
    deadline: Optional[datetime],
    priority: Optional[str],
) -> dict:
    body: dict[str, Any] = {"title": title, "name": title}
    if description:
        body["description"] = description
    if deadline:
        body["deadline"] = deadline.isoformat()
    if priority and priority != "unknown":
        body["priority"] = priority
    return body

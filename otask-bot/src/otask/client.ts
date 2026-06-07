import { config } from '../config.js';
import type { CreateTaskInput, Priority, Task } from './types.js';

/**
 * Клиент API otask.ru.
 *
 * ┌─ ВАЖНО ─────────────────────────────────────────────────────────────────┐
 * │ Точные пути и имена полей нужно сверить с https://api.otask.ru/docs.      │
 * │ Всё, что зависит от конкретной схемы API, собрано здесь, в ENDPOINTS и в  │
 * │ функциях normalize/serialize. Если реальная схема отличается — правки     │
 * │ нужны только в этом файле, остальной код бота трогать не придётся.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const ENDPOINTS = {
  /** Список задач. Поддерживает query-параметры (assignee, status, search, page). */
  listTasks: '/tasks',
  /** Карточка одной задачи: `${task}/${id}`. */
  task: '/tasks',
  /** Создание задачи (POST). */
  createTask: '/tasks',
};

export class OtaskError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'OtaskError';
  }
}

export class OtaskClient {
  constructor(private readonly apiKey: string, private readonly base = config.apiBase) {
    if (!apiKey) throw new OtaskError('Не задан API-ключ otask');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.base}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    } catch (e) {
      throw new OtaskError(`Сеть недоступна при запросе к otask: ${(e as Error).message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new OtaskError('otask отклонил API-ключ (401/403). Проверьте ключ через /link.', res.status);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OtaskError(`otask вернул ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Проверка ключа: пробуем получить первую страницу задач. */
  async ping(): Promise<void> {
    await this.request(`${ENDPOINTS.listTasks}?limit=1`);
  }

  /** Все назначенные на пользователя задачи (с пагинацией). */
  async listAssignedTasks(): Promise<Task[]> {
    const raw = await this.request<unknown>(`${ENDPOINTS.listTasks}?assigned=me&limit=200`);
    return extractList(raw).map(normalizeTask);
  }

  async getTask(id: string): Promise<Task> {
    const raw = await this.request<unknown>(`${ENDPOINTS.task}/${encodeURIComponent(id)}`);
    const obj = unwrapItem(raw);
    return normalizeTask(obj);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const raw = await this.request<unknown>(ENDPOINTS.createTask, {
      method: 'POST',
      body: JSON.stringify(serializeCreate(input)),
    });
    return normalizeTask(unwrapItem(raw));
  }
}

// ── Нормализация ответов API ───────────────────────────────────────────────
// otask может оборачивать данные в { data: ... } / { items: ... } / { tasks: ... }
// и называть поля по-русски/по-английски. Делаем разбор устойчивым.

type AnyObj = Record<string, unknown>;

function extractList(raw: unknown): AnyObj[] {
  if (Array.isArray(raw)) return raw as AnyObj[];
  if (raw && typeof raw === 'object') {
    const o = raw as AnyObj;
    for (const key of ['data', 'items', 'tasks', 'results', 'list']) {
      if (Array.isArray(o[key])) return o[key] as AnyObj[];
    }
  }
  return [];
}

function unwrapItem(raw: unknown): AnyObj {
  if (raw && typeof raw === 'object') {
    const o = raw as AnyObj;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) return o.data as AnyObj;
    if (o.task && typeof o.task === 'object') return o.task as AnyObj;
    return o;
  }
  return {};
}

function pick(o: AnyObj, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  return String(v);
}

export function normalizeTask(o: AnyObj): Task {
  const id = asString(pick(o, 'id', 'uuid', 'task_id', 'number')) ?? '';
  const title = asString(pick(o, 'title', 'name', 'subject', 'header')) ?? '(без названия)';
  const description = asString(pick(o, 'description', 'text', 'body', 'content'));
  const deadlineRaw = pick(o, 'deadline', 'due_date', 'dueDate', 'due', 'date_end', 'finish_at');
  const deadline = normalizeDate(deadlineRaw);
  const priority = normalizePriority(pick(o, 'priority', 'importance', 'severity'));
  const status = asString(pick(o, 'status', 'state', 'stage', 'column'));
  const done = isDone(status, pick(o, 'is_done', 'completed', 'closed'));
  const url = asString(pick(o, 'url', 'link', 'web_url')) ?? buildUrl(id);

  return { id, title, description, deadline, priority, status, done, url };
}

function normalizeDate(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function normalizePriority(v: unknown): Priority {
  const s = (asString(v) ?? '').toLowerCase().trim();
  if (!s) return 'unknown';
  if (['4', 'critical', 'критич', 'критический', 'urgent', 'срочный', 'highest'].some((k) => s.includes(k)))
    return 'critical';
  if (['3', 'high', 'высокий', 'важный'].some((k) => s.includes(k))) return 'high';
  if (['1', 'low', 'низкий', 'minor'].some((k) => s.includes(k))) return 'low';
  if (['2', 'normal', 'medium', 'обычный', 'средний'].some((k) => s.includes(k))) return 'normal';
  return 'unknown';
}

function isDone(status: string | undefined, flag: unknown): boolean {
  if (flag === true || flag === 1 || flag === '1' || flag === 'true') return true;
  const s = (status ?? '').toLowerCase();
  return ['done', 'closed', 'complete', 'выполн', 'закрыт', 'заверш'].some((k) => s.includes(k));
}

function buildUrl(id: string): string | undefined {
  if (!id) return undefined;
  // Веб-интерфейс otask. При необходимости поправьте шаблон под свой аккаунт.
  return `https://otask.ru/task/${id}`;
}

// ── Сериализация для создания задачи ───────────────────────────────────────
function serializeCreate(input: CreateTaskInput): AnyObj {
  const body: AnyObj = { title: input.title, name: input.title };
  if (input.description) body.description = input.description;
  if (input.deadline) body.deadline = input.deadline;
  if (input.priority && input.priority !== 'unknown') body.priority = input.priority;
  if (input.projectId) body.project_id = input.projectId;
  return body;
}

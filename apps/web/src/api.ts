// Клиент API. Текущий пользователь передаётся заголовком X-User-Id
// (временный вход-выбор; позже заменим на Telegram-аутентификацию).
import type {
  AppNotification,
  FunctionNode,
  PaymentEvent,
  Project,
  Task,
  TaskStatus,
  User,
} from '@taskflow/shared';

export const API_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001';

function userId(): string {
  return localStorage.getItem('userId') ?? '';
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error((msg as any).error ?? `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface Bootstrap {
  me: User;
  users: User[];
  functions: FunctionNode[];
  projects: Project[];
}

export const api = {
  listLoginUsers: () => req<User[]>('/auth/users'),
  bootstrap: () => req<Bootstrap>('/bootstrap'),
  tasks: (projectId?: string) =>
    req<Task[]>('/tasks' + (projectId ? `?projectId=${projectId}` : '')),
  task: (id: string) => req<Task>(`/tasks/${id}`),
  createTask: (data: Partial<Task>) =>
    req<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  patchTask: (id: string, data: Record<string, unknown>) =>
    req<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  setStatus: (id: string, status: TaskStatus) =>
    req<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  addComment: (id: string, body: string) =>
    req<Task>(`/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  addAttachment: (id: string, data: { kind?: string; format: string; value: string }) =>
    req<Task>(`/tasks/${id}/attachments`, { method: 'POST', body: JSON.stringify(data) }),
  describe: (data: { title: string; projectName?: string; functionName?: string }) =>
    req<{ description: string }>('/ai/describe', { method: 'POST', body: JSON.stringify(data) }),
  chat: (question: string) =>
    req<{ answer: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ question }) }),
  subtasks: (title: string) =>
    req<{ subtasks: string[] }>('/ai/subtasks', { method: 'POST', body: JSON.stringify({ title }) }),
  createProject: (data: Partial<Project>) =>
    req<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  patchProject: (id: string, data: Record<string, unknown>) =>
    req<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createFunction: (data: Partial<FunctionNode>) =>
    req<FunctionNode>('/functions', { method: 'POST', body: JSON.stringify(data) }),
  patchFunction: (id: string, data: Record<string, unknown>) =>
    req<FunctionNode>(`/functions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  payments: () => req<PaymentEvent[]>('/payments'),
  createPayment: (data: Partial<PaymentEvent>) =>
    req<PaymentEvent>('/payments', { method: 'POST', body: JSON.stringify(data) }),
  patchPayment: (id: string, data: Record<string, unknown>) =>
    req<PaymentEvent>(`/payments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  notifications: () => req<AppNotification[]>('/notifications'),
  readNotification: (id: string) =>
    req<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  reports: () =>
    req<{
      total: number;
      byStatus: Record<string, number>;
      overdue: number;
      overdueByUser: Record<string, number>;
    }>('/reports/summary'),
};

export function wsConnect(onEvent: () => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  function open() {
    if (closed) return;
    const url = API_URL.replace(/^http/, 'ws') + '/ws';
    ws = new WebSocket(url);
    ws.onmessage = () => onEvent();
    ws.onclose = () => {
      if (!closed) setTimeout(open, 2000);
    };
    ws.onerror = () => ws?.close();
  }
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}

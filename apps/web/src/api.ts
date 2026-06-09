// Клиент API. Авторизация — Bearer-токен (выдаётся при входе через Telegram
// или демо-входе). В production без VITE_API_URL запросы идут на /api того же
// домена (nginx в веб-контейнере проксирует их к API) — настройка не нужна.
import type {
  AppNotification,
  FunctionNode,
  PaymentEvent,
  Project,
  Task,
  TaskStatus,
  User,
} from '@taskflow/shared';

const env = (import.meta as any).env ?? {};
export const API_URL: string = env.VITE_API_URL || (env.DEV ? 'http://localhost:3001' : '/api');

export function getToken(): string {
  return localStorage.getItem('token') ?? '';
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(API_URL + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // X-User-Id поддерживается API только вне production — для локальной отладки.
      'X-User-Id': localStorage.getItem('userId') ?? '',
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

export interface TgStatus {
  status: 'pending' | 'confirmed' | 'expired';
  user?: User;
  token?: string;
}

export const api = {
  login: (userId: string) =>
    req<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ userId }) }),
  tgInit: () => req<{ code: string; botUsername: string | null; deepLink: string | null }>('/auth/telegram/init', { method: 'POST', body: '{}' }),
  tgStatus: (code: string) => req<TgStatus>(`/auth/telegram/status?code=${encodeURIComponent(code)}`),
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
  projectTgInit: (projectId: string) =>
    req<{ code: string; botUsername: string | null }>(`/projects/${projectId}/telegram/init`, { method: 'POST', body: '{}' }),
  projectTgStatus: (projectId: string) =>
    req<{ linked: boolean; chatId: string | null }>(`/projects/${projectId}/telegram/status`),
  projectTgUnlink: (projectId: string) =>
    req<{ ok: boolean }>(`/projects/${projectId}/telegram/unlink`, { method: 'POST', body: '{}' }),
  createField: (projectId: string, data: { name: string; type: string; options?: string[] }) =>
    req<{ id: string; name: string; type: string; options: string[] }>(`/projects/${projectId}/fields`, { method: 'POST', body: JSON.stringify(data) }),
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
  readAllNotifications: () => req<{ ok: boolean }>('/notifications/read-all', { method: 'POST', body: '{}' }),
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

/** Загрузка файла-вложения (multipart). */
export async function uploadFile(taskId: string, file: File, kind: 'attachment' | 'completion_proof'): Promise<Task> {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file);
  const token = getToken();
  const res = await fetch(`${API_URL}/tasks/${taskId}/upload`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-User-Id': localStorage.getItem('userId') ?? '',
    },
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error((msg as any).error ?? `Ошибка ${res.status}`);
  }
  return res.json();
}

/** Ссылка на скачивание файла-вложения (value = "stored|original"). */
export function fileUrl(value: string): string {
  const stored = value.split('|')[0];
  const base = API_URL.startsWith('http') ? API_URL : API_URL;
  return `${base}/files/${stored}`;
}

export function fileName(value: string): string {
  return value.split('|')[1] ?? value;
}

export function wsConnect(onEvent: () => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  function open() {
    if (closed) return;
    const base = API_URL.startsWith('http') ? API_URL : window.location.origin + API_URL;
    const url = base.replace(/^http/, 'ws') + '/ws';
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

import { create } from 'zustand';
import type {
  AppNotification,
  FunctionNode,
  Project,
  Task,
  TaskStatus,
  User,
} from '@taskflow/shared';
import { api, wsConnect } from './api';

export type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  }
  return 'dark';
}

export function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

interface AppState {
  theme: Theme;
  toggleTheme: () => void;

  currentUserId: string | null;
  loaded: boolean;
  error: string | null;

  users: User[];
  functions: FunctionNode[];
  projects: Project[];
  tasks: Task[];
  notifications: AppNotification[];

  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;

  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;

  login: (userId: string) => Promise<void>;
  logout: () => void;
  loadAll: () => Promise<void>;
  refetch: () => Promise<void>;
  connectRealtime: () => void;

  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  createTask: (data: Partial<Task>) => Promise<void>;
  addComment: (taskId: string, body: string) => Promise<void>;
  addProof: (taskId: string, value: string) => Promise<void>;
  markNotificationRead: (id: string) => void;

  userById: (id?: string) => User | undefined;
  projectById: (id?: string) => Project | undefined;
  functionById: (id?: string) => FunctionNode | undefined;
}

let wsCleanup: (() => void) | null = null;

export const useStore = create<AppState>((set, get) => ({
  theme: initialTheme(),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', theme);
      applyTheme(theme);
      return { theme };
    }),

  currentUserId: localStorage.getItem('userId'),
  loaded: false,
  error: null,

  users: [],
  functions: [],
  projects: [],
  tasks: [],
  notifications: [],

  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),

  composerOpen: false,
  setComposerOpen: (open) => set({ composerOpen: open }),

  login: async (userId) => {
    localStorage.setItem('userId', userId);
    set({ currentUserId: userId, loaded: false });
    await get().loadAll();
    get().connectRealtime();
  },

  logout: () => {
    localStorage.removeItem('userId');
    wsCleanup?.();
    set({ currentUserId: null, loaded: false, tasks: [], notifications: [] });
  },

  loadAll: async () => {
    try {
      const [boot, tasks, notifications] = await Promise.all([
        api.bootstrap(),
        api.tasks(),
        api.notifications(),
      ]);
      set({
        users: boot.users,
        functions: boot.functions,
        projects: boot.projects,
        tasks,
        notifications,
        loaded: true,
        error: null,
      });
    } catch (e: any) {
      set({ error: e.message ?? 'Ошибка загрузки', loaded: true });
    }
  },

  refetch: async () => {
    const [tasks, notifications] = await Promise.all([api.tasks(), api.notifications()]);
    set({ tasks, notifications });
  },

  connectRealtime: () => {
    wsCleanup?.();
    wsCleanup = wsConnect(() => {
      get().refetch();
    });
  },

  setTaskStatus: async (taskId, status) => {
    const prev = get().tasks;
    set({ tasks: prev.map((t) => (t.id === taskId ? { ...t, status } : t)) });
    try {
      const updated = await api.setStatus(taskId, status);
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)) }));
    } catch (e: any) {
      set({ tasks: prev });
      alert(e.message ?? 'Не удалось сменить статус');
    }
  },

  createTask: async (data) => {
    const created = await api.createTask(data);
    set((s) => ({ tasks: [created, ...s.tasks] }));
  },

  addComment: async (taskId, body) => {
    const updated = await api.addComment(taskId, body);
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)) }));
  },

  addProof: async (taskId, value) => {
    const updated = await api.addAttachment(taskId, {
      kind: 'completion_proof',
      format: 'text',
      value,
    });
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)) }));
  },

  markNotificationRead: (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
    api.readNotification(id).catch(() => {});
  },

  userById: (id) => get().users.find((u) => u.id === id),
  projectById: (id) => get().projects.find((p) => p.id === id),
  functionById: (id) => get().functions.find((f) => f.id === id),
}));

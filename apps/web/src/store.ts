import { create } from 'zustand';
import type {
  AppNotification,
  FunctionNode,
  PaymentEvent,
  Project,
  Task,
  TaskStatus,
  User,
} from '@taskflow/shared';
import { api, setToken, wsConnect } from './api';

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
  payments: PaymentEvent[];

  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;

  composerOpen: boolean;
  setComposerOpen: (open: boolean) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  projectModalOpen: boolean;
  setProjectModalOpen: (open: boolean) => void;
  functionModal: { open: boolean; parentId: string | null };
  openFunctionModal: (parentId: string | null) => void;
  closeFunctionModal: () => void;

  login: (userId: string, token?: string) => Promise<void>;
  logout: () => void;
  loadAll: () => Promise<void>;
  refetch: () => Promise<void>;
  connectRealtime: () => void;

  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  updateTask: (taskId: string, patch: Record<string, unknown>) => Promise<void>;
  createTask: (data: Partial<Task>) => Promise<void>;
  addComment: (taskId: string, body: string) => Promise<void>;
  addProof: (taskId: string, value: string) => Promise<void>;
  markNotificationRead: (id: string) => void;

  createPayment: (data: Partial<PaymentEvent>) => Promise<void>;
  markPaymentPaid: (id: string) => Promise<void>;

  createProject: (data: Partial<Project>) => Promise<void>;
  createFunction: (data: Partial<FunctionNode>) => Promise<void>;
  createFieldDef: (projectId: string, data: { name: string; type: string; options?: string[] }) => Promise<void>;

  fieldModal: { open: boolean; projectId: string | null };
  openFieldModal: (projectId: string) => void;
  closeFieldModal: () => void;

  projectTgModal: { open: boolean; projectId: string | null };
  openProjectTgModal: (projectId: string) => void;
  closeProjectTgModal: () => void;
  setProjectTelegram: (projectId: string, chatId: string | null) => void;

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
  payments: [],

  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),

  composerOpen: false,
  setComposerOpen: (open) => set({ composerOpen: open }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  projectModalOpen: false,
  setProjectModalOpen: (open) => set({ projectModalOpen: open }),
  functionModal: { open: false, parentId: null },
  openFunctionModal: (parentId) => set({ functionModal: { open: true, parentId } }),
  closeFunctionModal: () => set({ functionModal: { open: false, parentId: null } }),

  login: async (userId, token) => {
    // Токен либо уже выдан (Telegram-вход), либо получаем через демо-вход.
    if (token) {
      setToken(token);
    } else {
      const res = await api.login(userId);
      setToken(res.token);
    }
    localStorage.setItem('userId', userId);
    set({ currentUserId: userId, loaded: false });
    await get().loadAll();
    get().connectRealtime();
  },

  logout: () => {
    localStorage.removeItem('userId');
    setToken(null);
    wsCleanup?.();
    set({ currentUserId: null, loaded: false, tasks: [], notifications: [] });
  },

  loadAll: async () => {
    try {
      const [boot, tasks, notifications, payments] = await Promise.all([
        api.bootstrap(),
        api.tasks(),
        api.notifications(),
        api.payments().catch(() => []),
      ]);
      set({
        users: boot.users,
        functions: boot.functions,
        projects: boot.projects,
        tasks,
        notifications,
        payments,
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

  updateTask: async (taskId, patch) => {
    const prev = get().tasks;
    set({ tasks: prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) });
    try {
      const updated = await api.patchTask(taskId, patch);
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)) }));
    } catch (e: any) {
      set({ tasks: prev });
      alert(e.message ?? 'Не удалось сохранить');
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

  createPayment: async (data) => {
    const created = await api.createPayment(data);
    set((s) => ({ payments: [...s.payments, created].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }));
  },

  markPaymentPaid: async (id) => {
    const updated = await api.patchPayment(id, { status: 'paid' });
    set((s) => ({ payments: s.payments.map((p) => (p.id === id ? updated : p)) }));
  },

  createProject: async (data) => {
    const created = await api.createProject(data);
    set((s) => ({ projects: [...s.projects, created] }));
  },

  createFunction: async (data) => {
    const created = await api.createFunction(data);
    set((s) => ({ functions: [...s.functions, created] }));
  },

  createFieldDef: async (projectId, data) => {
    const created = await api.createField(projectId, data);
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, customFields: [...(p.customFields ?? []), created as any] } : p,
      ),
    }));
  },

  fieldModal: { open: false, projectId: null },
  openFieldModal: (projectId) => set({ fieldModal: { open: true, projectId } }),
  closeFieldModal: () => set({ fieldModal: { open: false, projectId: null } }),

  projectTgModal: { open: false, projectId: null },
  openProjectTgModal: (projectId) => set({ projectTgModal: { open: true, projectId } }),
  closeProjectTgModal: () => set({ projectTgModal: { open: false, projectId: null } }),
  setProjectTelegram: (projectId, chatId) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === projectId ? { ...p, telegramChatId: chatId ?? undefined } : p)),
    })),

  userById: (id) => get().users.find((u) => u.id === id),
  projectById: (id) => get().projects.find((p) => p.id === id),
  functionById: (id) => get().functions.find((f) => f.id === id),
}));

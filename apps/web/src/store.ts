import { create } from 'zustand';
import type {
  AppNotification,
  FunctionNode,
  Project,
  Task,
  TaskStatus,
  User,
} from '@taskflow/shared';
import {
  CURRENT_USER_ID,
  functions as mockFunctions,
  notifications as mockNotifications,
  projects as mockProjects,
  tasks as mockTasks,
  users as mockUsers,
} from './data/mock';

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

  currentUserId: string;
  users: User[];
  functions: FunctionNode[];
  projects: Project[];
  tasks: Task[];
  notifications: AppNotification[];

  selectedTaskId: string | null;
  selectTask: (id: string | null) => void;

  setTaskStatus: (taskId: string, status: TaskStatus) => void;
  userById: (id?: string) => User | undefined;
  projectById: (id?: string) => Project | undefined;
  functionById: (id?: string) => FunctionNode | undefined;
  markNotificationRead: (id: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  theme: initialTheme(),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'dark' ? 'light' : 'dark';
      if (typeof localStorage !== 'undefined') localStorage.setItem('theme', theme);
      applyTheme(theme);
      return { theme };
    }),

  currentUserId: CURRENT_USER_ID,
  users: mockUsers,
  functions: mockFunctions,
  projects: mockProjects,
  tasks: mockTasks,
  notifications: mockNotifications,

  selectedTaskId: null,
  selectTask: (id) => set({ selectedTaskId: id }),

  setTaskStatus: (taskId, status) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
    })),

  userById: (id) => get().users.find((u) => u.id === id),
  projectById: (id) => get().projects.find((p) => p.id === id),
  functionById: (id) => get().functions.find((f) => f.id === id),

  markNotificationRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
}));

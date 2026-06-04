// Доменные перечисления: статусы, приоритеты, роли, типы — единый источник правды
// для веба, бота и бэкенда.

/** Статусы задачи (с цветами по DESIGN.md §0). */
export const TASK_STATUSES = [
  'to_do',
  'in_progress',
  'on_hold',
  'blocked',
  'failed',
  'done',
  'canceled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface StatusMeta {
  label: string;
  /** HEX-цвет для бейджей/колонок. */
  color: string;
  /** Терминальный статус — задача закрыта. */
  terminal: boolean;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  to_do: { label: 'Взять в работу', color: '#8a8f98', terminal: false },
  in_progress: { label: 'В работе', color: '#4ea7fc', terminal: false },
  on_hold: { label: 'Отложено', color: '#f2c94c', terminal: false },
  blocked: { label: 'Возникли трудности', color: '#f2994a', terminal: false },
  failed: { label: 'Не выполнено', color: '#eb5757', terminal: true },
  done: { label: 'Выполнено', color: '#27ae60', terminal: true },
  canceled: { label: 'Отменено', color: '#6b7280', terminal: true },
};

/** Колонки канбана (без терминальных failed/canceled — они задаются явно). */
export const KANBAN_COLUMNS: TaskStatus[] = [
  'to_do',
  'in_progress',
  'on_hold',
  'blocked',
  'done',
];

/** Приоритеты задачи. */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface PriorityMeta {
  label: string;
  color: string;
  /** Вес для сортировки (больше = выше). */
  weight: number;
}

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  low: { label: 'Низкий', color: '#8a8f98', weight: 1 },
  medium: { label: 'Средний', color: '#4ea7fc', weight: 2 },
  high: { label: 'Высокий', color: '#f2994a', weight: 3 },
  critical: { label: 'Супер-сложно', color: '#eb5757', weight: 4 },
};

/** Роли пользователей. */
export const USER_ROLES = ['super_admin', 'process_lead', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_META: Record<UserRole, { label: string }> = {
  super_admin: { label: 'Главный администратор' },
  process_lead: { label: 'Руководитель процесса' },
  member: { label: 'Сотрудник' },
};

/** Тип контейнера задач. */
export type ProjectType = 'project' | 'process';

/** Правило повторения. */
export const RECURRENCE_FREQS = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'on_date',
] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const RECURRENCE_META: Record<RecurrenceFreq, { label: string }> = {
  none: { label: 'Без повтора' },
  daily: { label: 'Каждый день' },
  weekly: { label: 'Каждую неделю' },
  monthly: { label: 'Каждый месяц' },
  quarterly: { label: 'Каждый квартал' },
  on_date: { label: 'В конкретную дату' },
};

/** Типы кастомных полей. */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'url'
  | 'user'
  | 'checkbox';

/** Тип уведомления для раздела «Входящие». */
export type NotificationType =
  | 'assigned'
  | 'commented'
  | 'status_changed'
  | 'due_soon'
  | 'mentioned'
  | 'added_participant';

export const NOTIFICATION_META: Record<NotificationType, { label: string }> = {
  assigned: { label: 'Назначена задача' },
  commented: { label: 'Новый комментарий' },
  status_changed: { label: 'Смена статуса' },
  due_soon: { label: 'Приближается срок' },
  mentioned: { label: 'Вас упомянули' },
  added_participant: { label: 'Добавлены участником' },
};

/** Тип доказательства/вложения. */
export type AttachmentKind = 'attachment' | 'completion_proof';
export type ProofFormat = 'text' | 'link' | 'file';

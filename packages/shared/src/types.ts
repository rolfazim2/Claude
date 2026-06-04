// Доменные сущности (см. DESIGN.md §3).
import type {
  AttachmentKind,
  CustomFieldType,
  NotificationType,
  ProjectType,
  ProofFormat,
  RecurrenceFreq,
  TaskPriority,
  TaskStatus,
  UserRole,
} from './enums.js';

export type ID = string;
/** ISO-8601 строка (по МСК на уровне отображения). */
export type ISODate = string;

export interface User {
  id: ID;
  telegramId: string;
  telegramUsername?: string;
  fullName: string;
  position?: string;
  avatarUrl?: string;
  avatarColor?: string;
  role: UserRole;
  /** Функции, к которым привязан сотрудник (вторично). */
  functionIds: ID[];
  active: boolean;
}

/** Узел функциональной схемы (ОФС, по образцу kvant.app). */
export interface FunctionNode {
  id: ID;
  name: string;
  description?: string;
  /** Ожидаемый результат функции (ценный конечный продукт). */
  expectedResult?: string;
  parentId: ID | null;
  responsibleUserId?: ID;
  archived: boolean;
}

export interface Recurrence {
  freq: RecurrenceFreq;
  interval?: number;
  /** Время дня для напоминаний/материализации (HH:mm). */
  timeOfDay?: string;
  /** Дата для on_date. */
  date?: ISODate;
}

export interface CustomFieldDef {
  id: ID;
  name: string;
  type: CustomFieldType;
  options?: string[];
}

export interface Project {
  id: ID;
  type: ProjectType;
  name: string;
  color: string;
  leadId?: ID;
  /** Привязка к группе/каналу Telegram (стиль UTasks). */
  telegramChatId?: string;
  customFields: CustomFieldDef[];
  archived: boolean;
}

export interface Attachment {
  id: ID;
  kind: AttachmentKind;
  format: ProofFormat;
  /** Текст / URL / имя файла в зависимости от format. */
  value: string;
  authorId: ID;
  createdAt: ISODate;
}

export interface Comment {
  id: ID;
  authorId: ID;
  body: string;
  createdAt: ISODate;
}

export interface ActivityEntry {
  id: ID;
  actorId: ID;
  action: string;
  createdAt: ISODate;
}

export interface Task {
  id: ID;
  title: string;
  description?: string;
  projectId: ID;
  functionId?: ID;
  parentTaskId?: ID | null;
  assigneeId?: ID;
  creatorId: ID;
  participantIds: ID[];
  priority: TaskPriority;
  status: TaskStatus;
  dueAt?: ISODate;
  recurrence?: Recurrence;
  /** Требуется доказательство для закрытия. */
  proofRequired: boolean;
  customFields: Record<string, string | number | boolean | null>;
  comments: Comment[];
  attachments: Attachment[];
  activity: ActivityEntry[];
  createdAt: ISODate;
  archived: boolean;
}

export interface AppNotification {
  id: ID;
  userId: ID;
  taskId: ID;
  type: NotificationType;
  read: boolean;
  createdAt: ISODate;
}

export interface PaymentEvent {
  id: ID;
  title: string;
  counterparty?: string;
  amount: number;
  currency: string;
  dueDate: ISODate;
  status: import('./enums.js').PaymentStatus;
  projectId?: ID;
  recurrenceFreq: import('./enums.js').RecurrenceFreq;
  createdAt: ISODate;
}

/** Производный признак — задача просрочена. */
export function isOverdue(task: Pick<Task, 'dueAt' | 'status'>, now = new Date()): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'done' || task.status === 'canceled') return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}

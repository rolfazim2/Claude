import type {
  AppNotification,
  FunctionNode,
  Project,
  Task,
  User,
} from '@taskflow/shared';

// Демо-данные для прототипа. На бэкенде заменяются реальными API.

export const CURRENT_USER_ID = 'u1';

export const users: User[] = [
  { id: 'u1', telegramId: '1', fullName: 'Алексей Орлов', position: 'Владелец', role: 'super_admin', functionIds: ['f1'], active: true, avatarColor: '#5e6ad2' },
  { id: 'u2', telegramId: '2', fullName: 'Мария Зайцева', position: 'Руководитель маркетинга', role: 'process_lead', functionIds: ['f3'], active: true, avatarColor: '#27ae60' },
  { id: 'u3', telegramId: '3', fullName: 'Иван Петров', position: 'Менеджер', role: 'member', functionIds: ['f4'], active: true, avatarColor: '#f2994a' },
  { id: 'u4', telegramId: '4', fullName: 'Ольга Смирнова', position: 'Бухгалтер', role: 'member', functionIds: ['f5'], active: true, avatarColor: '#eb5757' },
  { id: 'u5', telegramId: '5', fullName: 'Дмитрий Ким', position: 'Разработчик', role: 'member', functionIds: ['f6'], active: true, avatarColor: '#4ea7fc' },
];

export const functions: FunctionNode[] = [
  { id: 'f1', name: 'Управление компанией', expectedResult: 'Рост и устойчивость бизнеса', parentId: null, responsibleUserId: 'u1', archived: false },
  { id: 'f2', name: 'Коммерция', expectedResult: 'Выручка по плану', parentId: 'f1', responsibleUserId: 'u2', archived: false },
  { id: 'f3', name: 'Маркетинг', expectedResult: 'Поток квалифицированных лидов', parentId: 'f2', responsibleUserId: 'u2', archived: false },
  { id: 'f4', name: 'Продажи', expectedResult: 'Закрытые сделки', parentId: 'f2', responsibleUserId: 'u3', archived: false },
  { id: 'f5', name: 'Финансы', expectedResult: 'Прозрачный учёт и вовремя оплаченные счета', parentId: 'f1', responsibleUserId: 'u4', archived: false },
  { id: 'f6', name: 'Продукт и разработка', expectedResult: 'Работающий продукт без сбоев', parentId: 'f1', responsibleUserId: 'u5', archived: false },
];

export const projects: Project[] = [
  { id: 'p1', type: 'project', name: 'Запуск сайта', color: '#5e6ad2', leadId: 'u2', customFields: [], archived: false },
  { id: 'p2', type: 'process', name: 'Ежедневные операции', color: '#27ae60', leadId: 'u1', telegramChatId: '-100123', customFields: [], archived: false },
  { id: 'p3', type: 'project', name: 'Маркетинг Q3', color: '#f2994a', leadId: 'u2', customFields: [], archived: false },
];

function daysFromNow(n: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const tasks: Task[] = [
  {
    id: 't1', title: 'Сверстать главную страницу', description: 'Адаптивная вёрстка по макету, тёмная тема.',
    projectId: 'p1', functionId: 'f6', assigneeId: 'u5', creatorId: 'u1', participantIds: ['u2'],
    priority: 'high', status: 'in_progress', dueAt: daysFromNow(2), proofRequired: true,
    customFields: {}, comments: [{ id: 'c1', authorId: 'u2', body: 'Не забудь про мобильную версию', createdAt: daysFromNow(-1) }],
    attachments: [], activity: [], createdAt: daysFromNow(-5), archived: false,
  },
  {
    id: 't2', title: 'Настроить аналитику', projectId: 'p1', functionId: 'f3', assigneeId: 'u1',
    creatorId: 'u1', participantIds: [], priority: 'medium', status: 'to_do', dueAt: daysFromNow(5),
    proofRequired: false, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-3), archived: false,
  },
  {
    id: 't3', title: 'Согласовать тексты', projectId: 'p1', functionId: 'f3', assigneeId: 'u2',
    creatorId: 'u2', participantIds: ['u1'], priority: 'low', status: 'on_hold', dueAt: daysFromNow(7),
    proofRequired: false, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-2), archived: false,
  },
  {
    id: 't4', title: 'Проверить кассу', description: 'Ежедневная сверка остатков.', projectId: 'p2', functionId: 'f5',
    assigneeId: 'u4', creatorId: 'u1', participantIds: [], priority: 'high', status: 'to_do', dueAt: daysFromNow(0, 18),
    proofRequired: true, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-1),
    recurrence: { freq: 'daily', timeOfDay: '18:00' }, archived: false,
  },
  {
    id: 't5', title: 'Выгрузить отчёт по продажам', projectId: 'p2', functionId: 'f4', assigneeId: 'u3',
    creatorId: 'u1', participantIds: [], priority: 'medium', status: 'in_progress', dueAt: daysFromNow(-1, 18),
    proofRequired: true, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-1),
    recurrence: { freq: 'daily', timeOfDay: '18:00' }, archived: false,
  },
  {
    id: 't6', title: 'Оплатить аренду офиса', projectId: 'p2', functionId: 'f5', assigneeId: 'u4',
    creatorId: 'u1', participantIds: ['u1'], priority: 'critical', status: 'blocked', dueAt: daysFromNow(-2),
    proofRequired: true, customFields: {}, comments: [{ id: 'c2', authorId: 'u4', body: 'Жду счёт от арендодателя', createdAt: daysFromNow(-1) }],
    attachments: [], activity: [], createdAt: daysFromNow(-4), recurrence: { freq: 'monthly' }, archived: false,
  },
  {
    id: 't7', title: 'Запустить рекламную кампанию', projectId: 'p3', functionId: 'f3', assigneeId: 'u2',
    creatorId: 'u1', participantIds: ['u3'], priority: 'high', status: 'to_do', dueAt: daysFromNow(3),
    proofRequired: false, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-1), archived: false,
  },
  {
    id: 't8', title: 'Собрать базу подписчиков', projectId: 'p3', functionId: 'f3', assigneeId: 'u1',
    creatorId: 'u2', participantIds: [], priority: 'medium', status: 'done', dueAt: daysFromNow(-3),
    proofRequired: false, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-8), archived: false,
  },
  {
    id: 't9', title: 'Подготовить пресс-релиз', projectId: 'p3', functionId: 'f3', assigneeId: 'u3',
    creatorId: 'u2', participantIds: [], priority: 'low', status: 'failed', dueAt: daysFromNow(-5),
    proofRequired: false, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-9), archived: false,
  },
  {
    id: 't10', title: 'Code review модуля оплаты', projectId: 'p1', functionId: 'f6', assigneeId: 'u5',
    creatorId: 'u1', participantIds: ['u1'], priority: 'medium', status: 'in_progress', dueAt: daysFromNow(1),
    proofRequired: false, customFields: {}, comments: [], attachments: [], activity: [], createdAt: daysFromNow(-2), archived: false,
  },
];

export const notifications: AppNotification[] = [
  { id: 'n1', userId: 'u1', taskId: 't1', type: 'commented', read: false, createdAt: daysFromNow(-1) },
  { id: 'n2', userId: 'u1', taskId: 't6', type: 'status_changed', read: false, createdAt: daysFromNow(0, 9) },
  { id: 'n3', userId: 'u1', taskId: 't10', type: 'added_participant', read: false, createdAt: daysFromNow(0, 10) },
  { id: 'n4', userId: 'u1', taskId: 't2', type: 'assigned', read: true, createdAt: daysFromNow(-3) },
  { id: 'n5', userId: 'u1', taskId: 't5', type: 'due_soon', read: true, createdAt: daysFromNow(-1, 16) },
];

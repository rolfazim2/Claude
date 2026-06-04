// Правила видимости задач (DESIGN.md §3.3a):
// - super_admin: все задачи
// - process_lead: все задачи в его проектах/процессах + его собственные
// - member: только задачи, где он исполнитель / создатель / участник
import type { Prisma, Role } from '@prisma/client';

export function taskVisibilityWhere(userId: string, role: Role): Prisma.TaskWhereInput {
  const own: Prisma.TaskWhereInput = {
    OR: [
      { assigneeId: userId },
      { creatorId: userId },
      { participants: { some: { userId } } },
    ],
  };

  if (role === 'super_admin') return {};
  if (role === 'process_lead') {
    return { OR: [{ project: { leadId: userId } }, own] };
  }
  return own;
}

/** Может ли пользователь ставить задачу в проект/процесс/функцию (не себе). */
export function canCreateForOthers(role: Role): boolean {
  return role === 'super_admin' || role === 'process_lead';
}

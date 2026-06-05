// Наполнение БД демо-данными (совпадает с прототипом).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function days(n: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  // Очистка (для повторного запуска).
  await prisma.activityEntry.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.taskParticipant.deleteMany();
  await prisma.task.deleteMany();
  await prisma.customFieldDef.deleteMany();
  await prisma.paymentEvent.deleteMany();
  await prisma.project.deleteMany();
  await prisma.function.deleteMany();
  await prisma.user.deleteMany();

  const users = await Promise.all([
    prisma.user.create({ data: { id: 'u1', fullName: 'Алексей Орлов', position: 'Владелец', role: 'super_admin', avatarColor: '#5e6ad2', telegramId: 'tg1' } }),
    prisma.user.create({ data: { id: 'u2', fullName: 'Мария Зайцева', position: 'Руководитель маркетинга', role: 'process_lead', avatarColor: '#27ae60', telegramId: 'tg2' } }),
    prisma.user.create({ data: { id: 'u3', fullName: 'Иван Петров', position: 'Менеджер', role: 'member', avatarColor: '#f2994a', telegramId: 'tg3' } }),
    prisma.user.create({ data: { id: 'u4', fullName: 'Ольга Смирнова', position: 'Бухгалтер', role: 'member', avatarColor: '#eb5757', telegramId: 'tg4' } }),
    prisma.user.create({ data: { id: 'u5', fullName: 'Дмитрий Ким', position: 'Разработчик', role: 'member', avatarColor: '#4ea7fc', telegramId: 'tg5' } }),
  ]);

  await prisma.function.create({ data: { id: 'f1', name: 'Управление компанией', expectedResult: 'Рост и устойчивость бизнеса', responsibleUserId: 'u1' } });
  await prisma.function.create({ data: { id: 'f2', name: 'Коммерция', expectedResult: 'Выручка по плану', parentId: 'f1', responsibleUserId: 'u2' } });
  await prisma.function.create({ data: { id: 'f3', name: 'Маркетинг', expectedResult: 'Поток квалифицированных лидов', parentId: 'f2', responsibleUserId: 'u2' } });
  await prisma.function.create({ data: { id: 'f4', name: 'Продажи', expectedResult: 'Закрытые сделки', parentId: 'f2', responsibleUserId: 'u3' } });
  await prisma.function.create({ data: { id: 'f5', name: 'Финансы', expectedResult: 'Прозрачный учёт и вовремя оплаченные счета', parentId: 'f1', responsibleUserId: 'u4' } });
  await prisma.function.create({ data: { id: 'f6', name: 'Продукт и разработка', expectedResult: 'Работающий продукт без сбоев', parentId: 'f1', responsibleUserId: 'u5' } });

  await prisma.project.create({ data: { id: 'p1', type: 'project', name: 'Запуск сайта', color: '#5e6ad2', leadId: 'u2' } });
  await prisma.project.create({ data: { id: 'p2', type: 'process', name: 'Ежедневные операции', color: '#27ae60', leadId: 'u1', telegramChatId: '-100123' } });
  await prisma.project.create({ data: { id: 'p3', type: 'project', name: 'Маркетинг Q3', color: '#f2994a', leadId: 'u2' } });

  const T = async (data: any, participantIds: string[] = []) => {
    const task = await prisma.task.create({ data });
    for (const userId of participantIds) {
      await prisma.taskParticipant.create({ data: { taskId: task.id, userId } });
    }
    return task;
  };

  await T({ id: 't1', title: 'Сверстать главную страницу', description: 'Адаптивная вёрстка по макету, тёмная тема.', projectId: 'p1', functionId: 'f6', assigneeId: 'u5', creatorId: 'u1', priority: 'high', status: 'in_progress', dueAt: days(2), proofRequired: true }, ['u2']);
  await prisma.comment.create({ data: { taskId: 't1', authorId: 'u2', body: 'Не забудь про мобильную версию' } });

  await T({ id: 't2', title: 'Настроить аналитику', projectId: 'p1', functionId: 'f3', assigneeId: 'u1', creatorId: 'u1', priority: 'medium', status: 'to_do', dueAt: days(5) });
  await T({ id: 't3', title: 'Согласовать тексты', projectId: 'p1', functionId: 'f3', assigneeId: 'u2', creatorId: 'u2', priority: 'low', status: 'on_hold', dueAt: days(7) }, ['u1']);
  await T({ id: 't4', title: 'Проверить кассу', description: 'Ежедневная сверка остатков.', projectId: 'p2', functionId: 'f5', assigneeId: 'u4', creatorId: 'u1', priority: 'high', status: 'to_do', dueAt: days(0, 18), proofRequired: true, recurrenceFreq: 'daily', recurrenceTime: '18:00' });
  await T({ id: 't5', title: 'Выгрузить отчёт по продажам', projectId: 'p2', functionId: 'f4', assigneeId: 'u3', creatorId: 'u1', priority: 'medium', status: 'in_progress', dueAt: days(-1, 18), proofRequired: true, recurrenceFreq: 'daily', recurrenceTime: '18:00' });
  await T({ id: 't6', title: 'Оплатить аренду офиса', projectId: 'p2', functionId: 'f5', assigneeId: 'u4', creatorId: 'u1', priority: 'critical', status: 'blocked', dueAt: days(-2), proofRequired: true, recurrenceFreq: 'monthly' }, ['u1']);
  await prisma.comment.create({ data: { taskId: 't6', authorId: 'u4', body: 'Жду счёт от арендодателя' } });

  await T({ id: 't7', title: 'Запустить рекламную кампанию', projectId: 'p3', functionId: 'f3', assigneeId: 'u2', creatorId: 'u1', priority: 'high', status: 'to_do', dueAt: days(3) }, ['u3']);
  await T({ id: 't8', title: 'Собрать базу подписчиков', projectId: 'p3', functionId: 'f3', assigneeId: 'u1', creatorId: 'u2', priority: 'medium', status: 'done', dueAt: days(-3) });
  await T({ id: 't9', title: 'Подготовить пресс-релиз', projectId: 'p3', functionId: 'f3', assigneeId: 'u3', creatorId: 'u2', priority: 'low', status: 'failed', dueAt: days(-5) });
  await T({ id: 't10', title: 'Code review модуля оплаты', projectId: 'p1', functionId: 'f6', assigneeId: 'u5', creatorId: 'u1', priority: 'medium', status: 'in_progress', dueAt: days(1) }, ['u1']);

  // Пример кастомного поля «Сайт» в проекте p1 + значение на задаче t1.
  await prisma.customFieldDef.deleteMany();
  const siteField = await prisma.customFieldDef.create({ data: { id: 'cf1', projectId: 'p1', name: 'Сайт', type: 'url', options: [] } });
  await prisma.task.update({ where: { id: 't1' }, data: { customFields: { [siteField.id]: 'https://example.com' } } });

  await prisma.paymentEvent.deleteMany();
  await prisma.paymentEvent.createMany({
    data: [
      { title: 'Аренда офиса', counterparty: 'ООО «Бизнес-Центр»', amount: 120000, dueDate: days(-2), status: 'planned', recurrenceFreq: 'monthly' },
      { title: 'Зарплата команды', counterparty: 'Сотрудники', amount: 850000, dueDate: days(1), status: 'planned', recurrenceFreq: 'monthly' },
      { title: 'Хостинг и сервисы', counterparty: 'Cloud Provider', amount: 18000, dueDate: days(4), status: 'planned', recurrenceFreq: 'monthly' },
      { title: 'Налоги (квартал)', counterparty: 'ФНС', amount: 240000, dueDate: days(20), status: 'planned', recurrenceFreq: 'quarterly' },
      { title: 'Реклама', counterparty: 'Рекламная площадка', amount: 95000, dueDate: days(-10), status: 'paid' },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { userId: 'u1', taskId: 't1', type: 'commented' },
      { userId: 'u1', taskId: 't6', type: 'status_changed' },
      { userId: 'u1', taskId: 't10', type: 'added_participant' },
      { userId: 'u1', taskId: 't2', type: 'assigned', read: true },
      { userId: 'u1', taskId: 't5', type: 'due_soon', read: true },
    ],
  });

  console.log(`Seed done: ${users.length} users.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

import { useMemo } from 'react';
import { isOverdue, type Task } from '@taskflow/shared';
import { useStore } from '../store';
import { TaskRow } from '../components/TaskRow';

function group(tasks: Task[]) {
  const overdue: Task[] = [];
  const today: Task[] = [];
  const week: Task[] = [];
  const later: Task[] = [];
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).getTime();
  const endOfWeek = endOfToday + 6 * 86_400_000;

  for (const t of tasks) {
    if (isOverdue(t)) overdue.push(t);
    else if (!t.dueAt) later.push(t);
    else {
      const due = new Date(t.dueAt).getTime();
      if (due <= endOfToday) today.push(t);
      else if (due <= endOfWeek) week.push(t);
      else later.push(t);
    }
  }
  return { overdue, today, week, later };
}

function Section({ title, tasks, accent }: { title: string; tasks: Task[]; accent?: string }) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-[13px] font-medium" style={accent ? { color: accent } : undefined}>
          {title}
        </span>
        <span className="text-2xs text-faint">{tasks.length}</span>
      </div>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showProject />
      ))}
    </div>
  );
}

export function MyTasks() {
  const me = useStore((s) => s.currentUserId) ?? '';
  const allTasks = useStore((s) => s.tasks);

  const mine = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          !t.archived &&
          (t.assigneeId === me || t.participantIds.includes(me) || t.creatorId === me),
      ),
    [allTasks, me],
  );

  const { overdue, today, week, later } = group(mine);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Мои задачи</h1>
        <span className="text-2xs text-faint">{mine.length} задач</span>
        <span className="ml-2 text-2xs text-faint">
          назначенные · делегированные мне · где я участник
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Section title="Просрочено" tasks={overdue} accent="#eb5757" />
        <Section title="Сегодня" tasks={today} accent="#f2c94c" />
        <Section title="На этой неделе" tasks={week} />
        <Section title="Позже" tasks={later} />
        {mine.length === 0 && <div className="p-6 text-muted">Задач пока нет 🎉</div>}
      </div>
    </div>
  );
}

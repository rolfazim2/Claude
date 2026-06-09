import { useMemo } from 'react';
import { CalendarClock, History } from 'lucide-react';
import { STATUS_META, TASK_STATUSES, isOverdue, type Project, type Task } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from './ui/Avatar';
import { formatDue, formatRelative } from '../lib/format';

export function ProjectOverview({ project, tasks }: { project: Project; tasks: Task[] }) {
  const users = useStore((s) => s.users);
  const selectTask = useStore((s) => s.selectTask);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const overdue = tasks.filter((t) => isOverdue(t)).length;
    const byStatus = TASK_STATUSES.map((s) => ({
      status: s,
      count: tasks.filter((t) => t.status === s).length,
    })).filter((x) => x.count > 0);

    const byAssignee = new Map<string, number>();
    for (const t of tasks) {
      if (t.assigneeId && t.status !== 'done' && t.status !== 'canceled') {
        byAssignee.set(t.assigneeId, (byAssignee.get(t.assigneeId) ?? 0) + 1);
      }
    }

    const upcoming = tasks
      .filter((t) => t.dueAt && t.status !== 'done' && t.status !== 'canceled')
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
      .slice(0, 6);

    const activity = tasks
      .flatMap((t) => t.activity.map((a) => ({ ...a, taskId: t.id, taskTitle: t.title })))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    return { total, done, overdue, byStatus, byAssignee, upcoming, activity };
  }, [tasks]);

  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const health = stats.overdue > 0 ? { label: 'Есть просроченные', color: '#eb5757' } : { label: 'В графике', color: '#27ae60' };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {/* Прогресс */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-[15px] font-semibold">Прогресс</span>
          <span className="rounded px-1.5 py-0.5 text-2xs" style={{ background: `${health.color}1a`, color: health.color }}>
            {health.label}
          </span>
          <span className="ml-auto text-xl font-semibold">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-2xs text-faint">
          {stats.done} из {stats.total} задач выполнено · просрочено: {stats.overdue}
        </div>
      </div>

      {/* Статусы */}
      <div className="card p-4">
        <div className="mb-2 text-[13px] font-medium">По статусам</div>
        <div className="mb-2 flex h-2.5 overflow-hidden rounded-full bg-hover">
          {stats.byStatus.map((x) => (
            <div key={x.status} style={{ width: `${(x.count / stats.total) * 100}%`, background: STATUS_META[x.status].color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {stats.byStatus.map((x) => (
            <span key={x.status} className="flex items-center gap-1.5 text-2xs text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[x.status].color }} />
              {STATUS_META[x.status].label}: {x.count}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Команда */}
        <div className="card p-4">
          <div className="mb-2 text-[13px] font-medium">Команда</div>
          <div className="flex flex-col gap-2">
            {[...stats.byAssignee.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([uid, count]) => {
                const u = users.find((x) => x.id === uid);
                return (
                  <div key={uid} className="flex items-center gap-2 text-[13px]">
                    <Avatar user={u} size={22} />
                    <span className="min-w-0 flex-1 truncate">{u?.fullName}</span>
                    <span className="text-2xs text-faint">{count} актив.</span>
                  </div>
                );
              })}
            {stats.byAssignee.size === 0 && <span className="text-2xs text-faint">Нет активных задач</span>}
          </div>
        </div>

        {/* Ближайшие сроки */}
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">
            <CalendarClock size={14} className="text-muted" /> Ближайшие сроки
          </div>
          <div className="flex flex-col gap-1.5">
            {stats.upcoming.map((t) => {
              const due = formatDue(t.dueAt);
              return (
                <button key={t.id} onClick={() => selectTask(t.id)} className="flex items-center gap-2 text-left text-[13px] hover:text-accent">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_META[t.status].color }} />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-2xs" style={{ color: due.tone === 'overdue' ? '#eb5757' : '#8a8f98' }}>
                    {due.label}
                  </span>
                </button>
              );
            })}
            {stats.upcoming.length === 0 && <span className="text-2xs text-faint">Нет задач со сроком</span>}
          </div>
        </div>
      </div>

      {/* Последняя активность */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium">
          <History size={14} className="text-muted" /> Последняя активность
        </div>
        <div className="flex flex-col gap-1.5">
          {stats.activity.map((a) => {
            const actor = users.find((u) => u.id === a.actorId);
            return (
              <button key={a.id} onClick={() => selectTask(a.taskId)} className="flex items-center gap-2 text-left text-2xs text-faint hover:text-text">
                <Avatar user={actor} size={16} />
                <span className="text-muted">{actor?.fullName}</span>
                <span>{a.action}</span>
                <span className="min-w-0 flex-1 truncate text-faint">↪ {a.taskTitle}</span>
                <span className="shrink-0">{formatRelative(a.createdAt)}</span>
              </button>
            );
          })}
          {stats.activity.length === 0 && <span className="text-2xs text-faint">Активности пока нет</span>}
        </div>
      </div>
    </div>
  );
}

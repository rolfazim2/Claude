import { useMemo } from 'react';
import {
  STATUS_META,
  TASK_STATUSES,
  isOverdue,
  type TaskStatus,
} from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from '../components/ui/Avatar';

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card flex-1 px-4 py-3">
      <div className="text-2xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-2xs uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

export function Reports() {
  const allTasks = useStore((s) => s.tasks);
  const tasks = useMemo(() => allTasks.filter((t) => !t.archived), [allTasks]);
  const users = useStore((s) => s.users);

  const byStatus = useMemo(() => {
    const m = {} as Record<TaskStatus, number>;
    for (const s of TASK_STATUSES) m[s] = 0;
    for (const t of tasks) m[t.status]++;
    return m;
  }, [tasks]);

  const overdueCount = tasks.filter((t) => isOverdue(t)).length;
  const total = tasks.length;
  const maxStatus = Math.max(...TASK_STATUSES.map((s) => byStatus[s]), 1);

  const overdueByUser = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) if (isOverdue(t) && t.assigneeId) {
      map.set(t.assigneeId, (map.get(t.assigneeId) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks]);
  const maxOverdue = Math.max(...overdueByUser.map(([, n]) => n), 1);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Отчёты</h1>
        <span className="text-2xs text-faint">за всё время</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {/* top stats */}
          <div className="flex gap-3">
            <Stat label="Всего" value={total} color="#e8e8ea" />
            <Stat label="Выполнено" value={byStatus.done} color={STATUS_META.done.color} />
            <Stat label="В работе" value={byStatus.in_progress} color={STATUS_META.in_progress.color} />
            <Stat label="Просрочено" value={overdueCount} color="#eb5757" />
          </div>

          {/* status breakdown */}
          <div className="card p-4">
            <div className="mb-3 text-[13px] font-medium">Распределение по статусам</div>
            <div className="flex flex-col gap-2">
              {TASK_STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-2xs text-muted">{STATUS_META[s].label}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-hover">
                    <div
                      className="h-full rounded"
                      style={{ width: `${(byStatus[s] / maxStatus) * 100}%`, background: STATUS_META[s].color }}
                    />
                  </div>
                  <span className="w-6 text-right text-2xs text-faint">{byStatus[s]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* who overdue */}
          <div className="card p-4">
            <div className="mb-3 text-[13px] font-medium">Кто просрочивает задачи</div>
            {overdueByUser.length === 0 ? (
              <div className="text-2xs text-muted">Просроченных задач нет 🎉</div>
            ) : (
              <div className="flex flex-col gap-2">
                {overdueByUser.map(([uid, n]) => {
                  const u = users.find((x) => x.id === uid);
                  return (
                    <div key={uid} className="flex items-center gap-3">
                      <Avatar user={u} size={22} />
                      <span className="w-40 shrink-0 truncate text-2xs">{u?.fullName}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-hover">
                        <div
                          className="h-full rounded bg-[#eb5757]"
                          style={{ width: `${(n / maxOverdue) * 100}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-2xs text-[#eb5757]">{n}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

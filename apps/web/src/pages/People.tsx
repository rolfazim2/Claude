import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Target } from 'lucide-react';
import { ROLE_META, isOverdue, type Task } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from '../components/ui/Avatar';
import { TaskRow } from '../components/TaskRow';

function stats(tasks: Task[]) {
  return {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    overdue: tasks.filter((t) => isOverdue(t)).length,
    done: tasks.filter((t) => t.status === 'done').length,
  };
}

export function People() {
  const users = useStore((s) => s.users);
  const tasks = useStore((s) => s.tasks);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Сотрудники</h1>
        <span className="text-2xs text-faint">{users.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => {
            const st = stats(tasks.filter((t) => !t.archived && (t.assigneeId === u.id || t.participantIds.includes(u.id))));
            return (
              <Link key={u.id} to={`/people/${u.id}`} className="card flex flex-col gap-2 p-3 hover:border-accent">
                <div className="flex items-center gap-2.5">
                  <Avatar user={u} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{u.fullName}</div>
                    <div className="truncate text-2xs text-faint">{u.position}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-2xs text-faint">
                  <span>{st.total} задач</span>
                  <span style={{ color: '#4ea7fc' }}>{st.inProgress} в работе</span>
                  {st.overdue > 0 && <span style={{ color: '#eb5757' }}>{st.overdue} просроч.</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EmployeeCard() {
  const { id } = useParams();
  const user = useStore((s) => s.userById(id));
  const tasks = useStore((s) => s.tasks);
  const functions = useStore((s) => s.functions);

  if (!user) return <div className="p-6 text-muted">Сотрудник не найден</div>;

  const myTasks = tasks.filter((t) => !t.archived && (t.assigneeId === user.id || t.participantIds.includes(user.id)));
  const myFunctions = functions.filter((f) => f.responsibleUserId === user.id);
  const st = stats(myTasks);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Link to="/people" className="btn-ghost px-1.5 py-1"><ArrowLeft size={16} /></Link>
        <h1 className="text-[15px] font-semibold">Карточка сотрудника</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {/* profile */}
          <div className="card flex items-center gap-4 p-4">
            <Avatar user={user} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold">{user.fullName}</div>
              <div className="text-[13px] text-muted">{user.position}</div>
              <span className="mt-1 inline-block rounded bg-hover px-1.5 py-0.5 text-2xs text-muted">{ROLE_META[user.role].label}</span>
            </div>
          </div>

          {/* stats */}
          <div className="flex gap-3">
            <div className="card flex-1 px-4 py-3"><div className="text-xl font-semibold">{st.total}</div><div className="text-2xs uppercase tracking-wide text-faint">Всего</div></div>
            <div className="card flex-1 px-4 py-3"><div className="text-xl font-semibold" style={{ color: '#4ea7fc' }}>{st.inProgress}</div><div className="text-2xs uppercase tracking-wide text-faint">В работе</div></div>
            <div className="card flex-1 px-4 py-3"><div className="text-xl font-semibold" style={{ color: '#eb5757' }}>{st.overdue}</div><div className="text-2xs uppercase tracking-wide text-faint">Просрочено</div></div>
            <div className="card flex-1 px-4 py-3"><div className="text-xl font-semibold" style={{ color: '#27ae60' }}>{st.done}</div><div className="text-2xs uppercase tracking-wide text-faint">Выполнено</div></div>
          </div>

          {/* functions */}
          {myFunctions.length > 0 && (
            <div className="card p-4">
              <div className="mb-2 text-[13px] font-medium">Отвечает за функции</div>
              <div className="flex flex-col gap-1.5">
                {myFunctions.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-[13px]">
                    <span className="font-medium">{f.name}</span>
                    {f.expectedResult && <span className="flex items-center gap-1 text-2xs text-faint"><Target size={11} />{f.expectedResult}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* tasks */}
          <div className="card overflow-hidden">
            <div className="border-b border-border px-3 py-2 text-[13px] font-medium">Задачи сотрудника</div>
            {myTasks.map((t) => <TaskRow key={t.id} task={t} showProject />)}
            {myTasks.length === 0 && <div className="px-3 py-6 text-2xs text-muted">Задач нет</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

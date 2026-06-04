import {
  X,
  Sparkles,
  ShieldCheck,
  Repeat,
  CornerDownRight,
  Send,
} from 'lucide-react';
import {
  PRIORITY_META,
  RECURRENCE_META,
  STATUS_META,
  TASK_STATUSES,
  isOverdue,
  type TaskStatus,
} from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from './ui/Avatar';
import { PriorityIcon } from './ui/Badges';
import { formatDue, formatRelative } from '../lib/format';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-28 shrink-0 text-2xs uppercase tracking-wide text-faint">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">{children}</div>
    </div>
  );
}

export function TaskDetail() {
  const taskId = useStore((s) => s.selectedTaskId);
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const selectTask = useStore((s) => s.selectTask);
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const assignee = useStore((s) => s.userById(task?.assigneeId));
  const fn = useStore((s) => s.functionById(task?.functionId));
  const project = useStore((s) => s.projectById(task?.projectId));
  const users = useStore((s) => s.users);
  const allTasks = useStore((s) => s.tasks);
  const subtasks = allTasks.filter((t) => t.parentTaskId === taskId);

  if (!task) return null;
  const due = formatDue(task.dueAt);
  const overdue = isOverdue(task);
  const blockClose = task.proofRequired && task.attachments.length === 0;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={() => selectTask(null)} />
      <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[520px] flex-col border-l border-border bg-surface shadow-panel">
        {/* header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-2xs text-faint">{project?.name}</span>
          {overdue && (
            <span className="rounded bg-[#eb5757]/15 px-1.5 py-0.5 text-2xs text-[#eb5757]">
              Просрочено
            </span>
          )}
          <button className="btn-ghost ml-auto px-1.5 py-1" onClick={() => selectTask(null)}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <h1 className="mb-3 flex items-start gap-2 text-[17px] font-semibold leading-snug">
            <span className="mt-1">
              <PriorityIcon priority={task.priority} />
            </span>
            {task.title}
          </h1>

          {/* fields */}
          <div className="mb-4 divide-y divide-borderSoft rounded-lg border border-border bg-elevated px-3 py-1">
            <Field label="Статус">
              <select
                value={task.status}
                onChange={(e) => setTaskStatus(task.id, e.target.value as TaskStatus)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Исполнитель">
              <Avatar user={assignee} size={20} />
              <span>{assignee?.fullName ?? 'Не назначен'}</span>
            </Field>
            <Field label="Приоритет">
              <span style={{ color: PRIORITY_META[task.priority].color }}>
                {PRIORITY_META[task.priority].label}
              </span>
            </Field>
            <Field label="Срок">
              <span className={overdue ? 'text-[#eb5757]' : ''}>{due.label}</span>
            </Field>
            <Field label="Функция">
              <span className="rounded bg-hover px-1.5 py-0.5 text-2xs text-muted">
                {fn?.name ?? '—'}
              </span>
            </Field>
            {task.recurrence && task.recurrence.freq !== 'none' && (
              <Field label="Повторение">
                <Repeat size={14} className="text-muted" />
                {RECURRENCE_META[task.recurrence.freq].label}
                {task.recurrence.timeOfDay ? `, ${task.recurrence.timeOfDay}` : ''}
              </Field>
            )}
            <Field label="Участники">
              {task.participantIds.length === 0 ? (
                <span className="text-faint">—</span>
              ) : (
                <div className="flex -space-x-1.5">
                  {task.participantIds.map((id) => (
                    <Avatar key={id} user={users.find((u) => u.id === id)} size={20} />
                  ))}
                </div>
              )}
            </Field>
          </div>

          {/* description */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-faint">Описание</span>
              <button className="btn-ghost px-1.5 py-0.5 text-2xs">
                <Sparkles size={12} /> Сгенерировать (ChatPRD)
              </button>
            </div>
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-muted">
              {task.description || 'Описание не заполнено.'}
            </p>
          </div>

          {/* proof */}
          {task.proofRequired && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#f2c94c]/30 bg-[#f2c94c]/5 px-3 py-2 text-2xs text-[#f2c94c]">
              <ShieldCheck size={14} />
              Требуется доказательство выполнения (текст / ссылка / скриншот), иначе задачу нельзя закрыть.
            </div>
          )}

          {/* subtasks */}
          <div className="mb-4">
            <div className="mb-1.5 text-2xs uppercase tracking-wide text-faint">
              Подзадачи ({subtasks.length})
            </div>
            {subtasks.length === 0 ? (
              <button className="btn-ghost w-full justify-start border border-dashed border-border px-2.5 py-1.5">
                <CornerDownRight size={14} /> Добавить подзадачу
              </button>
            ) : (
              subtasks.map((st) => (
                <div key={st.id} className="flex items-center gap-2 border-b border-borderSoft py-1.5 text-[13px]">
                  <CornerDownRight size={13} className="text-faint" />
                  {st.title}
                </div>
              ))
            )}
          </div>

          {/* comments */}
          <div>
            <div className="mb-2 text-2xs uppercase tracking-wide text-faint">Комментарии</div>
            <div className="flex flex-col gap-3">
              {task.comments.map((c) => {
                const author = users.find((u) => u.id === c.authorId);
                return (
                  <div key={c.id} className="flex gap-2">
                    <Avatar user={author} size={22} />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium">{author?.fullName}</span>
                        <span className="text-2xs text-faint">{formatRelative(c.createdAt)}</span>
                      </div>
                      <p className="text-[13px] text-muted">{c.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-1.5">
              <input
                placeholder="Написать комментарий…"
                className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
              <button className="btn-ghost px-1.5 py-1">
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* footer actions */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
          <button
            disabled={blockClose}
            onClick={() => setTaskStatus(task.id, 'done')}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={blockClose ? 'Сначала приложите доказательство' : 'Закрыть задачу'}
          >
            Выполнено
          </button>
          <button className="btn-ghost border border-border">Перенести</button>
          <button className="btn-ghost ml-auto border border-border">В архив</button>
        </div>
      </div>
    </>
  );
}

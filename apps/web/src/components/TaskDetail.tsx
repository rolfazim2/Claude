import { X, Sparkles, ShieldCheck, Repeat, CornerDownRight, Send, Square, CheckSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  PRIORITY_META,
  RECURRENCE_META,
  STATUS_META,
  TASK_PRIORITIES,
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

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const editCls =
  'rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent';

export function TaskDetail() {
  const taskId = useStore((s) => s.selectedTaskId);
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const selectTask = useStore((s) => s.selectTask);
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const updateTask = useStore((s) => s.updateTask);
  const createTask = useStore((s) => s.createTask);
  const addComment = useStore((s) => s.addComment);
  const addProof = useStore((s) => s.addProof);
  const assignee = useStore((s) => s.userById(task?.assigneeId));
  const fn = useStore((s) => s.functionById(task?.functionId));
  const project = useStore((s) => s.projectById(task?.projectId));
  const users = useStore((s) => s.users);
  const functions = useStore((s) => s.functions);
  const allTasks = useStore((s) => s.tasks);
  const subtasks = allTasks.filter((t) => t.parentTaskId === taskId);

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [comment, setComment] = useState('');
  const [proof, setProof] = useState('');
  const [newSub, setNewSub] = useState('');

  useEffect(() => {
    setTitle(task?.title ?? '');
    setDesc(task?.description ?? '');
  }, [taskId]);

  if (!task) return null;
  const due = formatDue(task.dueAt);
  const overdue = isOverdue(task);
  const blockClose = task.proofRequired && task.attachments.filter((a) => a.kind === 'completion_proof').length === 0;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={() => selectTask(null)} />
      <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[520px] flex-col border-l border-border bg-surface shadow-panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-2xs text-faint">{project?.name}</span>
          {overdue && (
            <span className="rounded bg-[#eb5757]/15 px-1.5 py-0.5 text-2xs text-[#eb5757]">Просрочено</span>
          )}
          <button className="btn-ghost ml-auto px-1.5 py-1" onClick={() => selectTask(null)}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 flex items-start gap-2">
            <span className="mt-1.5">
              <PriorityIcon priority={task.priority} />
            </span>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== task.title && updateTask(task.id, { title: title.trim() })}
              rows={1}
              className="flex-1 resize-none break-words bg-transparent text-[17px] font-semibold leading-snug outline-none"
            />
          </div>

          <div className="mb-4 divide-y divide-borderSoft rounded-lg border border-border bg-elevated px-3 py-1">
            <Field label="Статус">
              <select value={task.status} onChange={(e) => setTaskStatus(task.id, e.target.value as TaskStatus)} className={editCls}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </Field>
            <Field label="Исполнитель">
              <Avatar user={assignee} size={20} />
              <select
                value={task.assigneeId ?? ''}
                onChange={(e) => updateTask(task.id, { assigneeId: e.target.value || null })}
                className={editCls}
              >
                <option value="">Не назначен</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </Field>
            <Field label="Приоритет">
              <select value={task.priority} onChange={(e) => updateTask(task.id, { priority: e.target.value })} className={editCls} style={{ color: PRIORITY_META[task.priority].color }}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_META[p].label}</option>
                ))}
              </select>
            </Field>
            <Field label="Срок">
              <input
                type="datetime-local"
                value={toLocalInput(task.dueAt)}
                onChange={(e) => updateTask(task.id, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className={`${editCls} ${overdue ? 'text-[#eb5757]' : ''}`}
              />
            </Field>
            <Field label="Функция">
              <select value={task.functionId ?? ''} onChange={(e) => updateTask(task.id, { functionId: e.target.value || null })} className={editCls}>
                <option value="">— не выбрана —</option>
                {functions.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </Field>
            {task.recurrence && task.recurrence.freq !== 'none' && (
              <Field label="Повторение">
                <Repeat size={14} className="text-muted" />
                {RECURRENCE_META[task.recurrence.freq].label}
                {task.recurrence.timeOfDay ? `, ${task.recurrence.timeOfDay}` : ''}
              </Field>
            )}
            <Field label="Доказательство">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={task.proofRequired} onChange={(e) => updateTask(task.id, { proofRequired: e.target.checked })} />
                требуется для закрытия
              </label>
            </Field>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-faint">Описание</span>
              <button className="btn-ghost px-1.5 py-0.5 text-2xs" title="Заглушка — подключается ChatPRD (Этап B)">
                <Sparkles size={12} /> Сгенерировать (ChatPRD)
              </button>
            </div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => desc !== (task.description ?? '') && updateTask(task.id, { description: desc })}
              placeholder="Добавить описание…"
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] outline-none focus:border-accent placeholder:text-faint"
            />
          </div>

          {task.proofRequired && (
            <div className="mb-4 rounded-lg border border-[#f2c94c]/30 bg-[#f2c94c]/5 px-3 py-2.5">
              <div className="mb-2 flex items-center gap-2 text-2xs text-[#f2c94c]">
                <ShieldCheck size={14} />
                Доказательство (текст / ссылка / скриншот) — без него нельзя закрыть.
              </div>
              {task.attachments.filter((a) => a.kind === 'completion_proof').map((a) => (
                <div key={a.id} className="mb-1 rounded bg-elevated px-2 py-1 text-2xs text-muted">✓ {a.value}</div>
              ))}
              <div className="flex items-center gap-2">
                <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Текст или ссылка…" className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent" />
                <button className="btn-ghost border border-border" disabled={!proof.trim()} onClick={async () => { await addProof(task.id, proof.trim()); setProof(''); }}>Приложить</button>
              </div>
            </div>
          )}

          <div className="mb-4">
            <div className="mb-1.5 text-2xs uppercase tracking-wide text-faint">Подзадачи ({subtasks.length})</div>
            {subtasks.map((st) => (
              <div key={st.id} className="flex items-center gap-2 border-b border-borderSoft py-1.5 text-[13px]">
                <button onClick={() => setTaskStatus(st.id, st.status === 'done' ? 'to_do' : 'done')} className="text-muted hover:text-text">
                  {st.status === 'done' ? <CheckSquare size={15} className="text-[#27ae60]" /> : <Square size={15} />}
                </button>
                <button onClick={() => selectTask(st.id)} className={`flex-1 text-left ${st.status === 'done' ? 'text-faint line-through' : ''}`}>
                  {st.title}
                </button>
              </div>
            ))}
            <form
              className="mt-1.5 flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newSub.trim()) return;
                const t = newSub.trim();
                setNewSub('');
                await createTask({ title: t, projectId: task.projectId, functionId: task.functionId, parentTaskId: task.id } as any);
              }}
            >
              <CornerDownRight size={14} className="text-faint" />
              <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Добавить подзадачу…" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
            </form>
          </div>

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
            <form
              className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-elevated px-2.5 py-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                const body = comment.trim();
                setComment('');
                await addComment(task.id, body);
              }}
            >
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Написать комментарий…" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
              <button type="submit" className="btn-ghost px-1.5 py-1"><Send size={15} /></button>
            </form>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
          <button
            disabled={blockClose}
            onClick={() => setTaskStatus(task.id, 'done')}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={blockClose ? 'Сначала приложите доказательство' : 'Закрыть задачу'}
          >
            Выполнено
          </button>
          <button
            className="btn-ghost ml-auto border border-border"
            onClick={async () => { await updateTask(task.id, { archived: true } as any); selectTask(null); }}
          >
            В архив
          </button>
        </div>
      </div>
    </>
  );
}

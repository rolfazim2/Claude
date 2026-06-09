import { X, Sparkles, ShieldCheck, Repeat, CornerDownRight, Send, Square, CheckSquare, Paperclip, History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { api, fileUrl, fileName } from '../api';

const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** Подсветка @упоминаний в тексте комментария. */
function renderMentions(body: string, names: string[]) {
  if (!body.includes('@') || names.length === 0) return body;
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts = body.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={i} className="rounded bg-accent/15 px-0.5 text-accent">@{p}</span>
    ) : (
      p
    ),
  );
}
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
  const [genBusy, setGenBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const uploadTaskFile = useStore((s) => s.uploadTaskFile);
  const proofFileRef = useRef<HTMLInputElement>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);

  // @упоминания: query после последней «@» в поле комментария.
  const mentionQuery = useMemo(() => {
    const m = comment.match(/@([^@\s][^@]*)?$/);
    return m ? (m[1] ?? '') : null;
  }, [comment]);
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return users.filter((u) => u.fullName.toLowerCase().includes(q)).slice(0, 5);
  }, [mentionQuery, users]);

  async function doUpload(file: File | undefined, kind: 'attachment' | 'completion_proof') {
    if (!file || !task) return;
    setUpBusy(true);
    try {
      await uploadTaskFile(task.id, file, kind);
    } catch (e: any) {
      alert(e.message ?? 'Не удалось загрузить файл');
    } finally {
      setUpBusy(false);
    }
  }

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

          {(project?.customFields?.length ?? 0) > 0 && (
            <div className="mb-4 divide-y divide-borderSoft rounded-lg border border-border bg-elevated px-3 py-1">
              {project!.customFields.map((def: any) => {
                const val = (task.customFields as any)?.[def.id];
                const save = (v: any) => updateTask(task.id, { customFields: { ...(task.customFields ?? {}), [def.id]: v } });
                return (
                  <Field key={def.id} label={def.name}>
                    {def.type === 'checkbox' ? (
                      <input type="checkbox" checked={!!val} onChange={(e) => save(e.target.checked)} />
                    ) : def.type === 'select' ? (
                      <select className={editCls} value={val ?? ''} onChange={(e) => save(e.target.value)}>
                        <option value="">—</option>
                        {def.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : def.type === 'user' ? (
                      <select className={editCls} value={val ?? ''} onChange={(e) => save(e.target.value)}>
                        <option value="">—</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                      </select>
                    ) : (
                      <input
                        className={editCls}
                        type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
                        defaultValue={val ?? ''}
                        placeholder={def.type === 'url' ? 'https://…' : ''}
                        onBlur={(e) => e.target.value !== (val ?? '') && save(def.type === 'number' ? Number(e.target.value) : e.target.value)}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          )}

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-faint">Описание</span>
              <button
                className="btn-ghost px-1.5 py-0.5 text-2xs disabled:opacity-50"
                disabled={genBusy}
                onClick={async () => {
                  setGenBusy(true);
                  try {
                    const { description } = await api.describe({
                      title: task.title,
                      projectName: project?.name,
                      functionName: fn?.name,
                    });
                    setDesc(description);
                    await updateTask(task.id, { description });
                  } catch (e: any) {
                    alert(e.message ?? 'Не удалось сгенерировать');
                  } finally {
                    setGenBusy(false);
                  }
                }}
              >
                <Sparkles size={12} /> {genBusy ? 'Генерирую…' : 'Сгенерировать (ChatPRD)'}
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
                <div key={a.id} className="mb-1 rounded bg-elevated px-2 py-1 text-2xs text-muted">
                  {a.format === 'file' ? (
                    <a href={fileUrl(a.value)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      ✓ 📎 {fileName(a.value)}
                    </a>
                  ) : (
                    <>✓ {a.value}</>
                  )}
                  {a.format === 'file' && IMG_EXT.test(a.value.split('|')[0]) && (
                    <img src={fileUrl(a.value)} alt="" className="mt-1 max-h-32 rounded border border-border" />
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Текст или ссылка…" className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none focus:border-accent" />
                <button className="btn-ghost border border-border" disabled={!proof.trim()} onClick={async () => { await addProof(task.id, proof.trim()); setProof(''); }}>Приложить</button>
                <button className="btn-ghost border border-border" disabled={upBusy} onClick={() => proofFileRef.current?.click()} title="Загрузить файл/скриншот">
                  <Paperclip size={14} /> Файл
                </button>
                <input ref={proofFileRef} type="file" className="hidden" onChange={(e) => { doUpload(e.target.files?.[0], 'completion_proof'); e.target.value = ''; }} />
              </div>
            </div>
          )}

          {/* Вложения */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-faint">
                Вложения ({task.attachments.filter((a) => a.kind === 'attachment').length})
              </span>
              <button className="btn-ghost px-1.5 py-0.5 text-2xs disabled:opacity-50" disabled={upBusy} onClick={() => attachFileRef.current?.click()}>
                <Paperclip size={12} /> {upBusy ? 'Загрузка…' : 'Добавить файл'}
              </button>
              <input ref={attachFileRef} type="file" className="hidden" onChange={(e) => { doUpload(e.target.files?.[0], 'attachment'); e.target.value = ''; }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {task.attachments.filter((a) => a.kind === 'attachment').map((a) => (
                <a
                  key={a.id}
                  href={a.format === 'file' ? fileUrl(a.value) : a.value}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2 py-1.5 text-2xs text-muted hover:border-accent hover:text-text"
                >
                  {a.format === 'file' && IMG_EXT.test(a.value.split('|')[0]) ? (
                    <img src={fileUrl(a.value)} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <Paperclip size={12} />
                  )}
                  {a.format === 'file' ? fileName(a.value) : a.value}
                </a>
              ))}
              {task.attachments.filter((a) => a.kind === 'attachment').length === 0 && (
                <span className="text-2xs text-faint">Нет вложений</span>
              )}
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-wide text-faint">Подзадачи ({subtasks.length})</span>
              <button
                className="btn-ghost px-1.5 py-0.5 text-2xs disabled:opacity-50"
                disabled={genBusy}
                onClick={async () => {
                  setGenBusy(true);
                  try {
                    const { subtasks: items } = await api.subtasks(task.title);
                    for (const t of items) {
                      await createTask({ title: t, projectId: task.projectId, functionId: task.functionId, parentTaskId: task.id } as any);
                    }
                  } catch (e: any) {
                    alert(e.message ?? 'Не удалось');
                  } finally {
                    setGenBusy(false);
                  }
                }}
              >
                <Sparkles size={12} /> Разбить (ChatPRD)
              </button>
            </div>
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
                      <p className="text-[13px] text-muted">{renderMentions(c.body, users.map((u) => u.fullName))}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="relative">
              {mentionQuery !== null && mentionOptions.length > 0 && (
                <div className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-panel">
                  {mentionOptions.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
                      onClick={() => setComment(comment.replace(/@([^@\s][^@]*)?$/, `@${u.fullName} `))}
                    >
                      <Avatar user={u} size={18} /> {u.fullName}
                    </button>
                  ))}
                </div>
              )}
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
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий… (@имя — упомянуть)" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
                <button type="submit" className="btn-ghost px-1.5 py-1"><Send size={15} /></button>
              </form>
            </div>
          </div>

          {/* История изменений */}
          {task.activity.length > 0 && (
            <div className="mt-4 border-t border-borderSoft pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-2xs uppercase tracking-wide text-faint">
                <History size={12} /> История
              </div>
              <div className="flex flex-col gap-1.5">
                {task.activity.map((a) => {
                  const actor = users.find((u) => u.id === a.actorId);
                  return (
                    <div key={a.id} className="flex items-center gap-2 text-2xs text-faint">
                      <Avatar user={actor} size={16} />
                      <span className="text-muted">{actor?.fullName}</span>
                      <span>{a.action}</span>
                      <span className="ml-auto shrink-0">{formatRelative(a.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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

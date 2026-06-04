import { useState } from 'react';
import { X } from 'lucide-react';
import {
  PRIORITY_META,
  RECURRENCE_META,
  RECURRENCE_FREQS,
  TASK_PRIORITIES,
} from '@taskflow/shared';
import { useStore } from '../store';

function canAssignOthers(role?: string) {
  return role === 'super_admin' || role === 'process_lead';
}

export function NewTaskModal() {
  const open = useStore((s) => s.composerOpen);
  const setOpen = useStore((s) => s.setComposerOpen);
  const projects = useStore((s) => s.projects);
  const functions = useStore((s) => s.functions);
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.userById(s.currentUserId ?? undefined));
  const createTask = useStore((s) => s.createTask);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [functionId, setFunctionId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [due, setDue] = useState('');
  const [recurrenceFreq, setRecurrenceFreq] = useState('none');
  const [proofRequired, setProofRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const canOthers = canAssignOthers(me?.role);

  async function submit() {
    if (!title.trim() || !projectId) return;
    setBusy(true);
    try {
      await createTask({
        title: title.trim(),
        projectId,
        functionId: functionId || undefined,
        assigneeId: (canOthers && assigneeId) || me?.id,
        priority: priority as any,
        dueAt: due ? new Date(due).toISOString() : undefined,
        recurrenceFreq: recurrenceFreq as any,
        proofRequired,
      } as any);
      reset();
      setOpen(false);
    } catch (e: any) {
      alert(e.message ?? 'Не удалось создать задачу');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTitle('');
    setProjectId('');
    setFunctionId('');
    setAssigneeId('');
    setPriority('medium');
    setDue('');
    setRecurrenceFreq('none');
    setProofRequired(false);
  }

  const fieldCls =
    'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24">
      <div className="card w-full max-w-lg bg-surface p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Новая задача</h2>
          <button className="btn-ghost px-1.5 py-1" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название задачи"
          className={`${fieldCls} mb-3 text-[14px]`}
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Проект / процесс</span>
            <select className={fieldCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— выбрать —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Функция</span>
            <select className={fieldCls} value={functionId} onChange={(e) => setFunctionId(e.target.value)}>
              <option value="">— не выбрана —</option>
              {functions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Исполнитель</span>
            <select
              className={fieldCls}
              value={assigneeId}
              disabled={!canOthers}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">{canOthers ? '— я —' : 'Только себе'}</option>
              {canOthers &&
                users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Приоритет</span>
            <select className={fieldCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Срок</span>
            <input type="datetime-local" className={fieldCls} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Повторение</span>
            <select
              className={fieldCls}
              value={recurrenceFreq}
              onChange={(e) => setRecurrenceFreq(e.target.value)}
            >
              {RECURRENCE_FREQS.map((f) => (
                <option key={f} value={f}>
                  {RECURRENCE_META[f].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={proofRequired}
            onChange={(e) => setProofRequired(e.target.checked)}
          />
          Требовать доказательство выполнения
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost border border-border" onClick={() => setOpen(false)}>
            Отмена
          </button>
          <button
            className="btn-primary disabled:opacity-40"
            disabled={busy || !title.trim() || !projectId}
            onClick={submit}
          >
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}

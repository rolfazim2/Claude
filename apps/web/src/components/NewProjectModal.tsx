import { useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store';

const COLORS = ['#5e6ad2', '#27ae60', '#f2994a', '#eb5757', '#4ea7fc', '#9b51e0'];

export function NewProjectModal() {
  const open = useStore((s) => s.projectModalOpen);
  const setOpen = useStore((s) => s.setProjectModalOpen);
  const users = useStore((s) => s.users);
  const createProject = useStore((s) => s.createProject);

  const [name, setName] = useState('');
  const [type, setType] = useState<'project' | 'process'>('project');
  const [color, setColor] = useState(COLORS[0]);
  const [leadId, setLeadId] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const field = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent';

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProject({ name: name.trim(), type, color, leadId: leadId || undefined } as any);
      setName(''); setType('project'); setColor(COLORS[0]); setLeadId('');
      setOpen(false);
    } catch (e: any) {
      alert(e.message ?? 'Не удалось создать');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-28">
      <div className="card w-full max-w-md bg-surface p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Новый проект / процесс</h2>
          <button className="btn-ghost px-1.5 py-1" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>

        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" className={`${field} mb-3`} />

        <div className="mb-3 flex gap-2">
          <button onClick={() => setType('project')} className={`flex-1 rounded-md border px-2 py-1.5 text-[13px] ${type === 'project' ? 'border-accent text-text' : 'border-border text-muted'}`}>Проект</button>
          <button onClick={() => setType('process')} className={`flex-1 rounded-md border px-2 py-1.5 text-[13px] ${type === 'process' ? 'border-accent text-text' : 'border-border text-muted'}`}>Процесс (повторяющийся)</button>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xs uppercase tracking-wide text-faint">Цвет</span>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className={`h-5 w-5 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface' : ''}`} style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }} />
          ))}
        </div>

        <label className="mb-4 flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-faint">Руководитель</span>
          <select className={field} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">— не выбран —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-border" onClick={() => setOpen(false)}>Отмена</button>
          <button className="btn-primary disabled:opacity-40" disabled={busy || !name.trim()} onClick={submit}>Создать</button>
        </div>
      </div>
    </div>
  );
}

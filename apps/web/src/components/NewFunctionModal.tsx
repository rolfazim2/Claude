import { useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store';

export function NewFunctionModal() {
  const modal = useStore((s) => s.functionModal);
  const close = useStore((s) => s.closeFunctionModal);
  const functions = useStore((s) => s.functions);
  const users = useStore((s) => s.users);
  const createFunction = useStore((s) => s.createFunction);
  const parent = useStore((s) => s.functionById(modal.parentId ?? undefined));

  const [name, setName] = useState('');
  const [expectedResult, setExpectedResult] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [busy, setBusy] = useState(false);

  if (!modal.open) return null;
  const field = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent';
  const effectiveParent = modal.parentId ?? (parentId || null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createFunction({
        name: name.trim(),
        expectedResult: expectedResult.trim() || undefined,
        parentId: effectiveParent ?? undefined,
        responsibleUserId: responsibleUserId || undefined,
      } as any);
      setName(''); setExpectedResult(''); setParentId(''); setResponsibleUserId('');
      close();
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
          <h2 className="text-[15px] font-semibold">
            Новая функция{parent ? ` → в «${parent.name}»` : ''}
          </h2>
          <button className="btn-ghost px-1.5 py-1" onClick={close}><X size={16} /></button>
        </div>

        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название функции" className={`${field} mb-3`} />
        <input value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} placeholder="Ожидаемый результат (ценный конечный продукт)" className={`${field} mb-3`} />

        {!modal.parentId && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-faint">Родительская функция</span>
            <select className={field} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— верхний уровень —</option>
              {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}

        <label className="mb-4 flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-faint">Ответственный</span>
          <select className={field} value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)}>
            <option value="">— не назначен —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-border" onClick={close}>Отмена</button>
          <button className="btn-primary disabled:opacity-40" disabled={busy || !name.trim()} onClick={submit}>Создать</button>
        </div>
      </div>
    </div>
  );
}

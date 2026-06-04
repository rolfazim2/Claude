import { useState } from 'react';
import { X } from 'lucide-react';
import type { CustomFieldType } from '@taskflow/shared';
import { useStore } from '../store';

const TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Текст' },
  { value: 'number', label: 'Число' },
  { value: 'date', label: 'Дата' },
  { value: 'select', label: 'Список' },
  { value: 'url', label: 'Сайт / ссылка' },
  { value: 'user', label: 'Участник' },
  { value: 'checkbox', label: 'Флажок' },
];

export function NewFieldModal() {
  const modal = useStore((s) => s.fieldModal);
  const close = useStore((s) => s.closeFieldModal);
  const createFieldDef = useStore((s) => s.createFieldDef);

  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const [busy, setBusy] = useState(false);

  if (!modal.open || !modal.projectId) return null;
  const field = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-accent';

  async function submit() {
    if (!name.trim() || !modal.projectId) return;
    setBusy(true);
    try {
      await createFieldDef(modal.projectId, {
        name: name.trim(),
        type,
        options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
      });
      setName(''); setType('text'); setOptions('');
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
          <h2 className="text-[15px] font-semibold">Новое поле</h2>
          <button className="btn-ghost px-1.5 py-1" onClick={close}><X size={16} /></button>
        </div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Название поля" className={`${field} mb-3`} />
        <label className="mb-3 flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-faint">Тип</span>
          <select className={field} value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        {type === 'select' && (
          <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Варианты через запятую" className={`${field} mb-3`} />
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost border border-border" onClick={close}>Отмена</button>
          <button className="btn-primary disabled:opacity-40" disabled={busy || !name.trim()} onClick={submit}>Создать</button>
        </div>
      </div>
    </div>
  );
}

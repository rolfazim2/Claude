import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PRIORITY_META, STATUS_META } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from './ui/Avatar';

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const userById = useStore((s) => s.userById);
  const selectTask = useStore((s) => s.selectTask);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (open) setQ('');
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = tasks.filter((t) => !t.archived);
    const filtered = query
      ? list.filter((t) => t.title.toLowerCase().includes(query))
      : list.slice(0, 8);
    return filtered.slice(0, 12);
  }, [q, tasks]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-24" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-xl overflow-hidden bg-surface shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={16} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск задач…"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && results[0]) {
                selectTask(results[0].id);
                setOpen(false);
              }
            }}
          />
          <kbd className="rounded bg-hover px-1.5 text-2xs text-faint">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {results.map((t) => {
            const project = projects.find((p) => p.id === t.projectId);
            return (
              <button
                key={t.id}
                onClick={() => { selectTask(t.id); setOpen(false); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover"
              >
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_META[t.status].color }} />
                <span className="flex-1 truncate text-[13px]">{t.title}</span>
                <span className="shrink-0 text-2xs" style={{ color: PRIORITY_META[t.priority].color }}>
                  {PRIORITY_META[t.priority].label}
                </span>
                <span className="hidden shrink-0 text-2xs text-faint sm:inline">{project?.name}</span>
                <Avatar user={userById(t.assigneeId)} size={18} />
              </button>
            );
          })}
          {results.length === 0 && <div className="px-3 py-6 text-center text-2xs text-faint">Ничего не найдено</div>}
        </div>
      </div>
    </div>
  );
}

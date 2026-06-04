import { NavLink } from 'react-router-dom';
import {
  Inbox,
  CheckSquare,
  Network,
  BarChart3,
  Hash,
  Repeat,
  Plus,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { Avatar } from './ui/Avatar';

const navItem =
  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors';

function navClass({ isActive }: { isActive: boolean }) {
  return clsx(navItem, isActive ? 'bg-hover text-text' : 'text-muted hover:bg-hover hover:text-text');
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const projects = useStore((s) => s.projects);
  const user = useStore((s) => s.userById(s.currentUserId));
  const unread = useStore((s) => s.notifications.filter((n) => !n.read).length);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">
          T
        </div>
        <span className="font-semibold">TaskFlow</span>
      </div>

      <button className="mx-3 mb-1 flex items-center gap-2 rounded-md border border-border bg-elevated px-2.5 py-1.5 text-[13px] text-muted hover:text-text">
        <Search size={14} /> Поиск
        <kbd className="ml-auto rounded bg-hover px-1.5 text-2xs text-faint">⌘K</kbd>
      </button>

      <button className="btn-primary mx-3 mb-3 mt-1">
        <Plus size={15} /> Новая задача
      </button>

      <nav className="flex flex-col gap-0.5 px-3" onClick={onClose}>
        <NavLink to="/inbox" className={navClass}>
          <Inbox size={16} /> Входящие
          {unread > 0 && (
            <span className="ml-auto rounded-full bg-accent px-1.5 text-2xs text-white">{unread}</span>
          )}
        </NavLink>
        <NavLink to="/my" className={navClass}>
          <CheckSquare size={16} /> Мои задачи
        </NavLink>
        <NavLink to="/scheme" className={navClass}>
          <Network size={16} /> Функциональная схема
        </NavLink>
        <NavLink to="/reports" className={navClass}>
          <BarChart3 size={16} /> Отчёты
        </NavLink>
      </nav>

      <div className="mt-5 px-3">
        <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-faint">
          Проекты и процессы
        </div>
        <nav className="flex flex-col gap-0.5" onClick={onClose}>
          {projects.map((p) => (
            <NavLink key={p.id} to={`/board/${p.id}`} className={navClass}>
              {p.type === 'process' ? (
                <Repeat size={16} style={{ color: p.color }} />
              ) : (
                <Hash size={16} style={{ color: p.color }} />
              )}
              <span className="truncate">{p.name}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-border px-3 py-2.5">
        <Avatar user={user} size={26} />
        <div className="min-w-0">
          <div className="truncate text-[13px]">{user?.fullName}</div>
          <div className="truncate text-2xs text-faint">{user?.position}</div>
        </div>
      </div>
    </aside>
  );
}

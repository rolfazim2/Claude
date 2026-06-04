import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { TaskDetail } from '../components/TaskDetail';
import { NewTaskModal } from '../components/NewTaskModal';
import { NewProjectModal } from '../components/NewProjectModal';
import { NewFunctionModal } from '../components/NewFunctionModal';
import { CommandPalette } from '../components/CommandPalette';
import { NewFieldModal } from '../components/NewFieldModal';
import { useStore } from '../store';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const currentUserId = useStore((s) => s.currentUserId);
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);
  const loadAll = useStore((s) => s.loadAll);
  const connectRealtime = useStore((s) => s.connectRealtime);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);

  useEffect(() => {
    if (!currentUserId) {
      navigate('/', { replace: true });
      return;
    }
    if (!loaded) {
      loadAll().then(() => connectRealtime());
    }
  }, [currentUserId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!currentUserId) return null;

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-muted">
        Загрузка…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-bg text-muted">
        <div className="text-[#eb5757]">{error}</div>
        <button className="btn-ghost border border-border" onClick={() => loadAll()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <button className="btn-ghost m-2 w-fit md:hidden" onClick={() => setMobileOpen(true)}>
          <Menu size={18} />
        </button>
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      <TaskDetail />
      <NewTaskModal />
      <NewProjectModal />
      <NewFunctionModal />
      <CommandPalette />
      <NewFieldModal />
    </div>
  );
}

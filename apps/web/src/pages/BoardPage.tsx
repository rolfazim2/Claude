import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LayoutGrid, List as ListIcon, Search, Repeat, Hash, ArrowUpDown } from 'lucide-react';
import { PRIORITY_META, isOverdue, type Task } from '@taskflow/shared';
import { useStore } from '../store';
import { KanbanBoard } from '../components/KanbanBoard';
import { TaskRow } from '../components/TaskRow';

type SortKey = 'priority' | 'due' | 'assignee';

export function BoardPage() {
  const { projectId } = useParams();
  const project = useStore((s) => s.projectById(projectId));
  const allTasks = useStore((s) => s.tasks);
  const userById = useStore((s) => s.userById);

  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('priority');

  const tasks = useMemo(() => {
    let list = allTasks.filter((t) => t.projectId === projectId && !t.archived);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q));
    }
    return sortTasks(list, sort, userById);
  }, [allTasks, projectId, query, sort, userById]);

  if (!project) return <div className="p-6 text-muted">Проект не найден</div>;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        {project.type === 'process' ? (
          <Repeat size={16} style={{ color: project.color }} />
        ) : (
          <Hash size={16} style={{ color: project.color }} />
        )}
        <h1 className="text-[15px] font-semibold">{project.name}</h1>
        <span className="rounded bg-hover px-1.5 py-0.5 text-2xs text-muted">
          {project.type === 'process' ? 'Процесс' : 'Проект'}
        </span>
        <span className="text-2xs text-faint">{tasks.length} задач</span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2 py-1">
            <Search size={13} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск…"
              className="w-28 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>
          <button
            onClick={() => setSort((s) => (s === 'priority' ? 'due' : s === 'due' ? 'assignee' : 'priority'))}
            className="btn-ghost border border-border"
            title="Сортировка"
          >
            <ArrowUpDown size={14} />
            {sort === 'priority' ? 'Приоритет' : sort === 'due' ? 'Срок' : 'Сотрудник'}
          </button>
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              onClick={() => setView('kanban')}
              className={`px-2 py-1.5 ${view === 'kanban' ? 'bg-hover text-text' : 'text-muted'}`}
              title="Канбан"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-2 py-1.5 ${view === 'list' ? 'bg-hover text-text' : 'text-muted'}`}
              title="Список"
            >
              <ListIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'kanban' ? (
          <KanbanBoard tasks={tasks} />
        ) : (
          <div>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function sortTasks(
  list: Task[],
  sort: SortKey,
  userById: (id?: string) => { fullName: string } | undefined,
): Task[] {
  const copy = [...list];
  copy.sort((a, b) => {
    if (sort === 'priority') return PRIORITY_META[b.priority].weight - PRIORITY_META[a.priority].weight;
    if (sort === 'due') {
      const av = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bv = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return av - bv;
    }
    const an = userById(a.assigneeId)?.fullName ?? 'я';
    const bn = userById(b.assigneeId)?.fullName ?? 'я';
    return an.localeCompare(bn);
  });
  return copy;
}

export { isOverdue };

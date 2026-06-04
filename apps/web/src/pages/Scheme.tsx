import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Target } from 'lucide-react';
import type { FunctionNode } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from '../components/ui/Avatar';

function Node({ node, depth }: { node: FunctionNode; depth: number }) {
  const functions = useStore((s) => s.functions);
  const responsible = useStore((s) => s.userById(node.responsibleUserId));
  const tasks = useStore((s) => s.tasks);
  const taskCount = tasks.filter((t) => t.functionId === node.id && !t.archived).length;
  const children = functions.filter((f) => f.parentId === node.id);
  const openFunctionModal = useStore((s) => s.openFunctionModal);
  const [open, setOpen] = useState(true);

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 hover:border-[#33363d]"
        style={{ marginLeft: depth * 22 }}
      >
        {children.length > 0 ? (
          <button onClick={() => setOpen((o) => !o)} className="text-faint hover:text-text">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="w-[15px]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{node.name}</div>
          {node.expectedResult && (
            <div className="flex items-center gap-1 text-2xs text-faint">
              <Target size={11} />
              {node.expectedResult}
            </div>
          )}
        </div>
        {taskCount > 0 && (
          <span className="rounded bg-hover px-1.5 py-0.5 text-2xs text-muted">{taskCount} задач</span>
        )}
        <div className="flex items-center gap-1.5">
          <Avatar user={responsible} size={22} />
          <span className="hidden text-2xs text-faint sm:inline">{responsible?.fullName}</span>
        </div>
        <button
          onClick={() => openFunctionModal(node.id)}
          className="text-faint hover:text-text"
          title="Добавить подфункцию"
        >
          <Plus size={14} />
        </button>
      </div>
      {open && children.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Scheme() {
  const functions = useStore((s) => s.functions);
  const openFunctionModal = useStore((s) => s.openFunctionModal);
  const roots = functions.filter((f) => f.parentId === null && !f.archived);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Функциональная схема</h1>
        <span className="text-2xs text-faint">от функций — к исполнителям</span>
        <button className="btn-ghost ml-auto border border-border" onClick={() => openFunctionModal(null)}>
          <Plus size={14} /> Функция
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          {roots.map((r) => (
            <Node key={r.id} node={r} depth={0} />
          ))}
        </div>
      </div>
    </div>
  );
}

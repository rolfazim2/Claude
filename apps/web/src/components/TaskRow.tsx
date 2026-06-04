import { Repeat, ShieldCheck } from 'lucide-react';
import { STATUS_META, isOverdue, type Task } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from './ui/Avatar';
import { PriorityIcon, StatusDot } from './ui/Badges';
import { formatDue } from '../lib/format';

export function TaskRow({ task, showProject }: { task: Task; showProject?: boolean }) {
  const assignee = useStore((s) => s.userById(task.assigneeId));
  const fn = useStore((s) => s.functionById(task.functionId));
  const project = useStore((s) => s.projectById(task.projectId));
  const selectTask = useStore((s) => s.selectTask);
  const due = formatDue(task.dueAt);
  const overdue = isOverdue(task);

  return (
    <button
      onClick={() => selectTask(task.id)}
      className="group flex w-full items-center gap-3 border-b border-borderSoft px-3 py-2 text-left hover:bg-hover"
    >
      <PriorityIcon priority={task.priority} />
      <StatusDot status={task.status} />
      <span className="flex-1 truncate text-[13px]">{task.title}</span>

      {showProject && project && (
        <span className="hidden items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-2xs text-muted md:inline-flex">
          {project.name}
        </span>
      )}
      {fn && (
        <span className="hidden truncate rounded bg-hover px-1.5 py-0.5 text-2xs text-muted lg:inline-block">
          {fn.name}
        </span>
      )}
      <span className="hidden items-center gap-1 text-faint sm:flex">
        {task.recurrence && task.recurrence.freq !== 'none' && <Repeat size={13} />}
        {task.proofRequired && <ShieldCheck size={13} />}
      </span>
      <span
        className={`w-24 shrink-0 text-right text-2xs ${
          overdue ? 'text-[#eb5757]' : due.tone === 'today' ? 'text-[#f2c94c]' : 'text-faint'
        }`}
      >
        {due.label}
      </span>
      <span className="hidden w-32 shrink-0 truncate text-right text-2xs text-faint xl:inline-block">
        {STATUS_META[task.status].label}
      </span>
      <Avatar user={assignee} size={20} />
    </button>
  );
}

import { MessageSquare, Paperclip, Repeat, ShieldCheck } from 'lucide-react';
import { isOverdue, type Task } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from './ui/Avatar';
import { PriorityIcon } from './ui/Badges';
import { formatDue } from '../lib/format';

export function TaskCardMini({ task }: { task: Task }) {
  const assignee = useStore((s) => s.userById(task.assigneeId));
  const fn = useStore((s) => s.functionById(task.functionId));
  const selectTask = useStore((s) => s.selectTask);
  const due = formatDue(task.dueAt);
  const overdue = isOverdue(task);

  const toneClass =
    overdue ? 'text-[#eb5757]' : due.tone === 'today' ? 'text-[#f2c94c]' : 'text-faint';

  return (
    <button
      onClick={() => selectTask(task.id)}
      className="card group w-full cursor-pointer p-2.5 text-left transition-colors hover:border-[#33363d] hover:bg-hover"
    >
      <div className="mb-1.5 flex items-start gap-2">
        <PriorityIcon priority={task.priority} />
        <span className="flex-1 text-[13px] leading-snug">{task.title}</span>
      </div>
      {fn && (
        <div className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate rounded bg-hover px-1.5 py-0.5 text-2xs text-muted">
          {fn.name}
        </div>
      )}
      <div className="flex items-center gap-2 text-faint">
        <Avatar user={assignee} size={18} />
        <span className={`text-2xs ${toneClass}`}>{due.label}</span>
        <div className="ml-auto flex items-center gap-1.5 text-faint">
          {task.recurrence && task.recurrence.freq !== 'none' && <Repeat size={12} />}
          {task.proofRequired && <ShieldCheck size={12} />}
          {task.comments.length > 0 && (
            <span className="flex items-center gap-0.5 text-2xs">
              <MessageSquare size={12} />
              {task.comments.length}
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="flex items-center gap-0.5 text-2xs">
              <Paperclip size={12} />
              {task.attachments.length}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

import {
  MessageSquare,
  RefreshCw,
  Clock,
  UserPlus,
  AtSign,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { NOTIFICATION_META, type NotificationType } from '@taskflow/shared';
import { useStore } from '../store';
import { Avatar } from '../components/ui/Avatar';
import { formatRelative } from '../lib/format';

const ICONS: Record<NotificationType, LucideIcon> = {
  assigned: CheckCircle2,
  commented: MessageSquare,
  status_changed: RefreshCw,
  due_soon: Clock,
  mentioned: AtSign,
  added_participant: UserPlus,
};

export function Inbox() {
  const me = useStore((s) => s.currentUserId);
  const allNotifications = useStore((s) => s.notifications);
  const notifications = allNotifications.filter((n) => n.userId === me);
  const tasks = useStore((s) => s.tasks);
  const userById = useStore((s) => s.userById);
  const selectTask = useStore((s) => s.selectTask);
  const markRead = useStore((s) => s.markNotificationRead);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Входящие</h1>
        <span className="text-2xs text-faint">
          {notifications.filter((n) => !n.read).length} непрочитанных
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {notifications.map((n) => {
          const task = tasks.find((t) => t.id === n.taskId);
          const Icon = ICONS[n.type];
          return (
            <button
              key={n.id}
              onClick={() => {
                markRead(n.id);
                selectTask(n.taskId);
              }}
              className="flex w-full items-center gap-3 border-b border-borderSoft px-4 py-2.5 text-left hover:bg-hover"
            >
              {!n.read ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0" />
              )}
              <span className="text-muted">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{task?.title}</div>
                <div className="text-2xs text-faint">{NOTIFICATION_META[n.type].label}</div>
              </div>
              <Avatar user={userById(task?.assigneeId)} size={20} />
              <span className="w-20 shrink-0 text-right text-2xs text-faint">
                {formatRelative(n.createdAt)}
              </span>
            </button>
          );
        })}
        {notifications.length === 0 && <div className="p-6 text-muted">Уведомлений нет</div>}
      </div>
    </div>
  );
}

import {
  PRIORITY_META,
  STATUS_META,
  type TaskPriority,
  type TaskStatus,
} from '@taskflow/shared';

export function StatusDot({ status, size = 8 }: { status: TaskStatus; size?: number }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: size, height: size, background: meta.color }}
      title={meta.label}
    />
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="status-pill" style={{ background: meta.color }}>
      {meta.label}
    </span>
  );
}

const PRIORITY_BARS: Record<TaskPriority, number> = { low: 1, medium: 2, high: 3, critical: 3 };

export function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const meta = PRIORITY_META[priority];
  const active = PRIORITY_BARS[priority];
  if (priority === 'critical') {
    return (
      <span title={meta.label} className="inline-flex items-end gap-[2px]" style={{ color: meta.color }}>
        ▲
      </span>
    );
  }
  return (
    <span className="inline-flex items-end gap-[2px]" title={`Приоритет: ${meta.label}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm"
          style={{
            height: 5 + i * 3,
            background: i < active ? meta.color : '#33363d',
          }}
        />
      ))}
    </span>
  );
}

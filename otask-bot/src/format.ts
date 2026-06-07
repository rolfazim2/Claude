import type { Priority, Task } from './otask/types.js';

const PRIORITY_LABEL: Record<Priority, string> = {
  critical: '🔴 Критический',
  high: '🟠 Высокий',
  normal: '🟡 Обычный',
  low: '🟢 Низкий',
  unknown: '⚪️ Без приоритета',
};

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  unknown: 4,
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function priorityLabel(p: Priority): string {
  return PRIORITY_LABEL[p];
}

/** Человекочитаемый дедлайн + относительный остаток времени. */
export function formatDeadline(iso: string | undefined, now = new Date()): string {
  if (!iso) return 'без срока';
  const d = new Date(iso);
  const date = d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const diffMs = d.getTime() - now.getTime();
  const rel = humanizeDiff(diffMs);
  return diffMs < 0 ? `${date} (просрочено ${rel})` : `${date} (через ${rel})`;
}

function humanizeDiff(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.round(abs / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  const days = Math.round(hours / 24);
  return `${days} дн`;
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return !task.done && !!task.deadline && new Date(task.deadline).getTime() < now.getTime();
}

/** Сортировка: сначала просроченные, затем по дедлайну, затем по приоритету. */
export function sortTasks(tasks: Task[], now = new Date()): Task[] {
  return [...tasks].sort((a, b) => {
    const ao = isOverdue(a, now) ? 0 : 1;
    const bo = isOverdue(b, now) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

/** Краткая строка задачи для списков (HTML). */
export function formatTaskLine(task: Task, now = new Date()): string {
  const overdue = isOverdue(task, now);
  const flag = overdue ? '⚠️ ' : '';
  const title = escapeHtml(task.title);
  const link = task.url ? `<a href="${escapeHtml(task.url)}">${title}</a>` : title;
  const prio = priorityLabel(task.priority).split(' ')[0]; // только эмодзи
  const due = task.deadline ? ` — ⏰ ${escapeHtml(formatDeadline(task.deadline, now))}` : '';
  return `${flag}${prio} ${link}${due}`;
}

/** Полная карточка задачи (HTML). */
export function formatTaskCard(task: Task, now = new Date()): string {
  const lines: string[] = [];
  const overdue = isOverdue(task, now);
  lines.push(`<b>${escapeHtml(task.title)}</b>`);
  if (overdue) lines.push('⚠️ <b>Просрочена</b>');
  lines.push(`Приоритет: ${priorityLabel(task.priority)}`);
  if (task.status) lines.push(`Статус: ${escapeHtml(task.status)}`);
  lines.push(`Срок: ${escapeHtml(formatDeadline(task.deadline, now))}`);
  if (task.description) {
    const desc = task.description.length > 800 ? task.description.slice(0, 800) + '…' : task.description;
    lines.push('');
    lines.push(escapeHtml(desc));
  }
  if (task.url) {
    lines.push('');
    lines.push(`🔗 <a href="${escapeHtml(task.url)}">Открыть в otask</a>`);
  }
  return lines.join('\n');
}

/** Список задач с заголовком; группирует на блоки, чтобы влезть в лимит Telegram. */
export function formatTaskList(title: string, tasks: Task[], now = new Date()): string[] {
  if (tasks.length === 0) return [`${title}\n\nНичего нет 🎉`];
  const sorted = sortTasks(tasks, now);
  const header = `${title} (${sorted.length})`;
  const messages: string[] = [];
  let buf = header;
  for (const t of sorted) {
    const line = '\n\n' + formatTaskLine(t, now);
    if (buf.length + line.length > 3800) {
      messages.push(buf);
      buf = line.trimStart();
    } else {
      buf += line;
    }
  }
  messages.push(buf);
  return messages;
}

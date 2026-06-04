// Форматирование дат по МСК (для отображения).

const MSK = 'Europe/Moscow';

export function formatDue(iso?: string): { label: string; tone: 'overdue' | 'today' | 'soon' | 'normal' } {
  if (!iso) return { label: '—', tone: 'normal' };
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  const time = date.toLocaleTimeString('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString('ru-RU', { timeZone: MSK, day: 'numeric', month: 'short' });

  let label: string;
  if (diffDays === 0) label = `Сегодня ${time}`;
  else if (diffDays === 1) label = `Завтра ${time}`;
  else if (diffDays === -1) label = `Вчера ${time}`;
  else label = `${dateStr}`;

  let tone: 'overdue' | 'today' | 'soon' | 'normal' = 'normal';
  if (date.getTime() < now.getTime()) tone = 'overdue';
  else if (diffDays === 0) tone = 'today';
  else if (diffDays <= 2) tone = 'soon';

  return { label, tone };
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  return `${days} дн назад`;
}

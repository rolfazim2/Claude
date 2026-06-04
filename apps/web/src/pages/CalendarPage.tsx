import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { STATUS_META, isOverdue, type Task } from '@taskflow/shared';
import { useStore } from '../store';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function CalendarPage() {
  const tasks = useStore((s) => s.tasks);
  const selectTask = useStore((s) => s.selectTask);
  const [cursor, setCursor] = useState(() => new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.dueAt || t.archived) continue;
      const key = ymd(new Date(t.dueAt));
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // понедельник = 0
    const start = new Date(first);
    start.setDate(1 - startOffset);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor]);

  const today = new Date();
  const isToday = (d: Date) => ymd(d) === ymd(today);
  const inMonth = (d: Date) => d.getMonth() === cursor.getMonth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Календарь событий</h1>
        <span className="text-2xs text-faint">задачи со сроком (МСК)</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn-ghost border border-border px-2 py-1" onClick={() => setCursor(new Date())}>
            Сегодня
          </button>
          <span className="min-w-[140px] text-center text-[13px] font-medium">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </span>
          <button className="btn-ghost border border-border px-1.5 py-1" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft size={15} />
          </button>
          <button className="btn-ghost border border-border px-1.5 py-1" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5 text-2xs uppercase tracking-wide text-faint">{w}</div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-auto">
        {grid.map((d) => {
          const items = byDay.get(ymd(d)) ?? [];
          return (
            <div
              key={d.toISOString()}
              className={`min-h-[96px] border-b border-r border-borderSoft p-1.5 ${inMonth(d) ? '' : 'opacity-40'}`}
            >
              <div className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full text-2xs ${isToday(d) ? 'bg-accent text-white' : 'text-muted'}`}>
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {items.slice(0, 4).map((t) => {
                  const time = new Date(t.dueAt!).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                  const over = isOverdue(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTask(t.id)}
                      className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-2xs hover:bg-hover"
                      style={{ background: `${STATUS_META[t.status].color}1a` }}
                    >
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_META[t.status].color }} />
                      <span className={`shrink-0 ${over ? 'text-[#eb5757]' : 'text-faint'}`}>{time}</span>
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {items.length > 4 && <span className="px-1 text-2xs text-faint">+{items.length - 4} ещё</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

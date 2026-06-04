import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { PAYMENT_STATUS_META, RECURRENCE_META, type PaymentEvent } from '@taskflow/shared';
import { useStore } from '../store';

function money(n: number, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}
function isOverdue(p: PaymentEvent) {
  return p.status === 'planned' && new Date(p.dueDate).getTime() < Date.now();
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PaymentsPage() {
  const payments = useStore((s) => s.payments);
  const createPayment = useStore((s) => s.createPayment);
  const markPaid = useStore((s) => s.markPaymentPaid);
  const me = useStore((s) => s.userById(s.currentUserId ?? undefined));

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

  const totals = useMemo(() => {
    let planned = 0, paid = 0, overdue = 0;
    for (const p of payments) {
      if (p.status === 'paid') paid += p.amount;
      else if (p.status === 'planned') {
        planned += p.amount;
        if (isOverdue(p)) overdue += p.amount;
      }
    }
    return { planned, paid, overdue };
  }, [payments]);

  const canEdit = me?.role !== 'member';

  async function add() {
    if (!title.trim() || !dueDate) return;
    await createPayment({
      title: title.trim(),
      amount: Number(amount) || 0,
      dueDate: new Date(dueDate).toISOString(),
    } as any);
    setTitle(''); setAmount(''); setDueDate(''); setAdding(false);
  }

  if (payments.length === 0 && me?.role === 'member') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center border-b border-border px-4 py-2.5">
          <h1 className="text-[15px] font-semibold">Платёжный календарь</h1>
        </div>
        <div className="p-6 text-muted">Раздел доступен администратору и руководителям.</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">Платёжный календарь</h1>
        {canEdit && (
          <button className="btn-ghost ml-auto border border-border" onClick={() => setAdding((v) => !v)}>
            <Plus size={14} /> Платёж
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div className="flex gap-3">
            <div className="card flex-1 px-4 py-3">
              <div className="text-xl font-semibold" style={{ color: '#4ea7fc' }}>{money(totals.planned)}</div>
              <div className="text-2xs uppercase tracking-wide text-faint">Запланировано</div>
            </div>
            <div className="card flex-1 px-4 py-3">
              <div className="text-xl font-semibold" style={{ color: '#27ae60' }}>{money(totals.paid)}</div>
              <div className="text-2xs uppercase tracking-wide text-faint">Оплачено</div>
            </div>
            <div className="card flex-1 px-4 py-3">
              <div className="text-xl font-semibold" style={{ color: '#eb5757' }}>{money(totals.overdue)}</div>
              <div className="text-2xs uppercase tracking-wide text-faint">Просрочено</div>
            </div>
          </div>

          {adding && (
            <div className="card flex flex-wrap items-end gap-2 p-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Назначение / контрагент" className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сумма" type="number" className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
              <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" className="rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent" />
              <button className="btn-primary disabled:opacity-40" disabled={!title.trim() || !dueDate} onClick={add}>Добавить</button>
            </div>
          )}

          <div className="card divide-y divide-borderSoft">
            {payments.map((p) => {
              const over = isOverdue(p);
              const meta = PAYMENT_STATUS_META[p.status];
              return (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-24 shrink-0 text-2xs" style={{ color: over ? '#eb5757' : '#8a8f98' }}>{fmtDate(p.dueDate)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{p.title}</div>
                    {p.counterparty && <div className="truncate text-2xs text-faint">{p.counterparty}</div>}
                  </div>
                  {p.recurrenceFreq !== 'none' && (
                    <span className="hidden rounded bg-hover px-1.5 py-0.5 text-2xs text-muted sm:inline">
                      {RECURRENCE_META[p.recurrenceFreq].label}
                    </span>
                  )}
                  <div className="w-32 shrink-0 text-right text-[13px] font-medium">{money(p.amount, p.currency)}</div>
                  <span className="w-28 shrink-0 text-right text-2xs" style={{ color: over ? '#eb5757' : meta.color }}>
                    {over ? 'Просрочен' : meta.label}
                  </span>
                  {canEdit && p.status === 'planned' && (
                    <button className="btn-ghost border border-border px-1.5 py-1" title="Отметить оплаченным" onClick={() => markPaid(p.id)}>
                      <Check size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {payments.length === 0 && <div className="px-3 py-6 text-2xs text-muted">Платежей нет</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

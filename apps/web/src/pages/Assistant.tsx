import { useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { api } from '../api';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = [
  'Что у меня просрочено?',
  'Какие задачи на сегодня?',
  'Сколько задач в работе?',
  'Сделай сводку по моим задачам',
];

export function Assistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const { answer } = await api.chat(question);
      setMessages((m) => [...m, { role: 'assistant', text: answer }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', text: e.message ?? 'Ошибка' }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles size={16} className="text-accent" />
        <h1 className="text-[15px] font-semibold">Ассистент</h1>
        <span className="text-2xs text-faint">вопросы по вашим задачам</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <Sparkles size={22} />
              </div>
              <div className="text-[13px] text-muted">Спросите что-нибудь о ваших задачах</div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="card px-3 py-1.5 text-2xs text-muted hover:border-accent hover:text-text">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] ${m.role === 'user' ? 'bg-accent text-white' : 'card'}`}>
                {m.text}
              </div>
            </div>
          ))}
          {busy && <div className="text-2xs text-faint">Ассистент печатает…</div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-border p-3">
        <form
          className="mx-auto flex max-w-2xl items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Сообщение ассистенту…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn-primary px-2.5 py-1.5 disabled:opacity-40">
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}

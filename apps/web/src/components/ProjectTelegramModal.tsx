import { useEffect, useRef, useState } from 'react';
import { X, Send, Check } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';

export function ProjectTelegramModal() {
  const modal = useStore((s) => s.projectTgModal);
  const close = useStore((s) => s.closeProjectTgModal);
  const project = useStore((s) => s.projectById(modal.projectId ?? undefined));
  const setProjectTelegram = useStore((s) => s.setProjectTelegram);

  const [code, setCode] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const linked = !!project?.telegramChatId;

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (!modal.open || !project) return null;

  async function getCode() {
    setErr(null);
    try {
      const r = await api.projectTgInit(project!.id);
      setCode(r.code);
      setBotUsername(r.botUsername);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const s = await api.projectTgStatus(project!.id);
        if (s.linked) {
          if (pollRef.current) clearInterval(pollRef.current);
          setProjectTelegram(project!.id, s.chatId);
        }
      }, 2000);
    } catch (e: any) {
      setErr(e.message ?? 'Ошибка');
    }
  }

  async function unlink() {
    await api.projectTgUnlink(project!.id);
    setProjectTelegram(project!.id, null);
    setCode(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24">
      <div className="card w-full max-w-md bg-surface p-4 shadow-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Send size={15} className="text-[#229ED9]" /> Telegram-группа проекта
          </h2>
          <button className="btn-ghost px-1.5 py-1" onClick={close}><X size={16} /></button>
        </div>

        <p className="mb-3 text-2xs text-faint">«{project.name}»</p>

        {linked ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-[#27ae60]/30 bg-[#27ae60]/10 px-3 py-2 text-[13px] text-[#27ae60]">
              <Check size={15} /> Группа привязана. События задач уходят в неё.
            </div>
            <button className="btn-ghost border border-border self-start" onClick={unlink}>Отвязать группу</button>
          </div>
        ) : !code ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">
              Привяжите Telegram-группу: задачи проекта (создание, смена статуса, комментарии) будут дублироваться в неё.
            </p>
            <button className="btn-primary self-start" onClick={getCode}>Получить код привязки</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ol className="list-decimal space-y-1.5 pl-4 text-[13px] text-muted">
              <li>Добавьте бота {botUsername ? <b>@{botUsername}</b> : 'TaskFlow'} в нужную группу.</li>
              <li>Отправьте в группе команду:</li>
            </ol>
            <div className="rounded-md border border-border bg-elevated px-3 py-2 text-center font-mono text-[15px] tracking-wide">
              /link {code}
            </div>
            <div className="flex items-center gap-2 text-2xs text-faint">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" /> Ожидаем привязку…
            </div>
          </div>
        )}
        {err && <div className="mt-3 text-2xs text-[#eb5757]">{err}</div>}
      </div>
    </div>
  );
}

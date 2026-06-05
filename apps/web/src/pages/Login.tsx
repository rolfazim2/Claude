import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, LogIn, Send } from 'lucide-react';
import type { User } from '@taskflow/shared';
import { ROLE_META } from '@taskflow/shared';
import { useStore } from '../store';
import { api } from '../api';
import { Avatar } from '../components/ui/Avatar';

export function Login() {
  const navigate = useNavigate();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const login = useStore((s) => s.login);

  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Telegram-вход
  const [tg, setTg] = useState<{ code: string; deepLink: string | null } | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api
      .listLoginUsers()
      .then(setUsers)
      .catch((e) => setError(e.message ?? 'API недоступен'));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function pick(u: User) {
    setBusy(true);
    await login(u.id);
    navigate('/my');
  }

  async function startTelegram() {
    setTgError(null);
    try {
      const init = await api.tgInit();
      setTg({ code: init.code, deepLink: init.deepLink });
      if (init.deepLink) window.open(init.deepLink, '_blank');
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const s = await api.tgStatus(init.code);
        if (s.status === 'confirmed' && s.user) {
          if (pollRef.current) clearInterval(pollRef.current);
          await login(s.user.id);
          navigate('/my');
        } else if (s.status === 'expired') {
          if (pollRef.current) clearInterval(pollRef.current);
          setTg(null);
          setTgError('Код истёк. Попробуйте снова.');
        }
      }, 2000);
    } catch (e: any) {
      setTgError(e.message ?? 'Не удалось начать вход');
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-text">
      <button
        onClick={toggleTheme}
        className="btn-ghost absolute right-4 top-4 px-2 py-1.5"
        title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-xl font-bold text-white">
            T
          </div>
          <h1 className="text-xl font-semibold">TaskFlow</h1>
          <p className="mt-1 text-[13px] text-muted">Войдите через Telegram</p>
        </div>

        {/* Telegram-вход */}
        <button
          onClick={startTelegram}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] px-3 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Send size={16} /> Войти через Telegram
        </button>
        {tg && (
          <div className="mb-3 rounded-lg border border-border bg-elevated px-3 py-2.5 text-2xs text-muted">
            Открываем бота… Если не открылось,{' '}
            {tg.deepLink ? (
              <a href={tg.deepLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">перейдите по ссылке</a>
            ) : (
              <span>отправьте боту команду <code className="rounded bg-hover px-1">/start {tg.code}</code></span>
            )}{' '}
            и нажмите Start. Ожидаем подтверждения…
          </div>
        )}
        {tgError && (
          <div className="mb-3 rounded-lg border border-[#eb5757]/30 bg-[#eb5757]/10 px-3 py-2 text-2xs text-[#eb5757]">{tgError}</div>
        )}

        <div className="mb-3 flex items-center gap-2 text-2xs text-faint">
          <div className="h-px flex-1 bg-border" /> или как сотрудник (демо) <div className="h-px flex-1 bg-border" />
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-[#eb5757]/30 bg-[#eb5757]/10 px-3 py-2 text-2xs text-[#eb5757]">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {users.map((u) => (
            <button
              key={u.id}
              disabled={busy}
              onClick={() => pick(u)}
              className="card flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-hover disabled:opacity-50"
            >
              <Avatar user={u} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{u.fullName}</div>
                <div className="truncate text-2xs text-faint">{u.position}</div>
              </div>
              <span className="rounded bg-hover px-1.5 py-0.5 text-2xs text-muted">
                {ROLE_META[u.role].label}
              </span>
              <LogIn size={15} className="text-faint" />
            </button>
          ))}
          {users.length === 0 && !error && (
            <div className="py-8 text-center text-2xs text-faint">Загрузка…</div>
          )}
        </div>
      </div>
    </div>
  );
}

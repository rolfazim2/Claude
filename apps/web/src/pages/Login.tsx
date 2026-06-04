import { useNavigate } from 'react-router-dom';
import { Send } from 'lucide-react';

export function Login() {
  const navigate = useNavigate();
  return (
    <div className="flex h-screen items-center justify-center bg-bg px-4 text-text">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-xl font-bold text-white">
          T
        </div>
        <h1 className="text-xl font-semibold">TaskFlow</h1>
        <p className="mt-1 text-[13px] text-muted">
          Корпоративный таск-менеджер. Вход — через Telegram.
        </p>

        <button
          onClick={() => navigate('/my')}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-[#2aabee] px-4 py-2.5 font-medium text-white transition-colors hover:bg-[#2095d3]"
        >
          <Send size={17} /> Войти через Telegram
        </button>

        <p className="mt-4 text-2xs text-faint">
          Демо-режим: вход открывает кабинет с тестовыми данными.
        </p>
      </div>
    </div>
  );
}

// Конфигурация из переменных окружения. На CI значения приходят из GitHub Secrets,
// локально — из .env (dotenv). Пароль НИКОГДА не хранится в коде/репозитории.
import 'dotenv/config';

export type AgentMode = 'safe' | 'full' | 'dry-run';
export type ImageSource = 'analog' | 'yandex' | 'analog+yandex';

export interface Config {
  baseUrl: string;
  login: string;
  password: string;
  anthropicApiKey: string;
  model: string;
  mode: AgentMode;
  confidenceThreshold: number;
  timeBudgetMs: number;
  maxTags: number; // 0 = без лимита
  headless: boolean;
  imageSource: ImageSource; // откуда брать картинку при создании карточки
}

export function loadConfig(): Config {
  // Собираем ВСЕ отсутствующие обязательные переменные сразу — одна понятная ошибка
  // вместо чехарды «исправил одну, упал на следующей».
  const missing = ['OPT_SPB_LOGIN', 'OPT_SPB_PASSWORD'].filter((n) => !process.env[n]);
  if (missing.length) {
    throw new Error(
      `Не заданы обязательные переменные окружения: ${missing.join(', ')}. ` +
        'На GitHub Actions: Settings → Secrets and variables → Actions → вкладка Secrets → ' +
        'Repository secrets (имена точно такими же, заглавными). Локально: файл .env.',
    );
  }
  const mode = (process.env.AGENT_MODE ?? 'full') as AgentMode;
  if (!['safe', 'full', 'dry-run'].includes(mode)) {
    throw new Error(`AGENT_MODE должен быть safe|full|dry-run, получено «${mode}»`);
  }
  const imageSource = (process.env.AGENT_IMAGE_SOURCE ?? 'analog+yandex') as ImageSource;
  if (!['analog', 'yandex', 'analog+yandex'].includes(imageSource)) {
    throw new Error(`AGENT_IMAGE_SOURCE должен быть analog|yandex|analog+yandex, получено «${imageSource}»`);
  }
  return {
    baseUrl: (process.env.OPT_SPB_BASE_URL ?? 'https://opt-spb.ru').replace(/\/+$/, ''),
    login: process.env.OPT_SPB_LOGIN!,
    password: process.env.OPT_SPB_PASSWORD!,
    // Ключ НЕобязателен: без него агент работает в детерминированном режиме
    // (однозначное привязывает, спорное → review). С ключом — LLM-арбитраж и vision-картинки.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AGENT_MODEL ?? 'claude-opus-4-8',
    mode,
    confidenceThreshold: Number(process.env.AGENT_CONFIDENCE_THRESHOLD ?? '0.95'),
    timeBudgetMs: Number(process.env.AGENT_TIME_BUDGET_MIN ?? '50') * 60_000,
    maxTags: Number(process.env.AGENT_MAX_TAGS ?? '0'),
    headless: (process.env.AGENT_HEADLESS ?? 'true') !== 'false',
    imageSource,
  };
}

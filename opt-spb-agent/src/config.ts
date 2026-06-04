// Конфигурация из переменных окружения. На CI значения приходят из GitHub Secrets,
// локально — из .env (dotenv). Пароль НИКОГДА не хранится в коде/репозитории.
import 'dotenv/config';

export type AgentMode = 'safe' | 'full' | 'dry-run';

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
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана обязательная переменная окружения ${name}`);
  return v;
}

export function loadConfig(): Config {
  const mode = (process.env.AGENT_MODE ?? 'full') as AgentMode;
  if (!['safe', 'full', 'dry-run'].includes(mode)) {
    throw new Error(`AGENT_MODE должен быть safe|full|dry-run, получено «${mode}»`);
  }
  return {
    baseUrl: (process.env.OPT_SPB_BASE_URL ?? 'https://opt-spb.ru').replace(/\/+$/, ''),
    login: req('OPT_SPB_LOGIN'),
    password: req('OPT_SPB_PASSWORD'),
    anthropicApiKey: req('ANTHROPIC_API_KEY'),
    model: process.env.AGENT_MODEL ?? 'claude-opus-4-8',
    mode,
    confidenceThreshold: Number(process.env.AGENT_CONFIDENCE_THRESHOLD ?? '0.95'),
    timeBudgetMs: Number(process.env.AGENT_TIME_BUDGET_MIN ?? '50') * 60_000,
    maxTags: Number(process.env.AGENT_MAX_TAGS ?? '0'),
    headless: (process.env.AGENT_HEADLESS ?? 'true') !== 'false',
  };
}

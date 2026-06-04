// Простой структурированный логгер. Маскирует пароль/ключи в выводе.
const SECRETS: string[] = [];

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 4) SECRETS.push(value);
}

function mask(s: string): string {
  let out = s;
  for (const sec of SECRETS) out = out.split(sec).join('«***»');
  return out;
}

function line(level: string, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  let tail = '';
  if (extra !== undefined) {
    try {
      tail = ' ' + mask(typeof extra === 'string' ? extra : JSON.stringify(extra));
    } catch {
      tail = ' [unserializable]';
    }
  }
  // eslint-disable-next-line no-console
  console.log(`${ts} ${level} ${mask(msg)}${tail}`);
}

export const log = {
  info: (msg: string, extra?: unknown) => line('INFO ', msg, extra),
  warn: (msg: string, extra?: unknown) => line('WARN ', msg, extra),
  error: (msg: string, extra?: unknown) => line('ERROR', msg, extra),
  step: (msg: string, extra?: unknown) => line('STEP ', msg, extra),
};

// Лёгкое состояние между почасовыми прогонами: множество тегов, уже вынесенных на
// согласование (review) или помеченных как «не товар». Чтобы каждый час не дёргать
// одни и те же спорные строки. Файл коммитится workflow'ом вместе с отчётом.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const STATE_PATH = 'state/reviewed.json';

export function tagKey(tag: string, supplierId: number | null): string {
  return createHash('sha1').update(`${supplierId ?? ''}::${tag.replace(/\s+/g, ' ').trim()}`).digest('hex').slice(0, 16);
}

export function loadReviewed(): Set<string> {
  if (!existsSync(STATE_PATH)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function saveReviewed(set: Set<string>): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify([...set], null, 0), 'utf8');
}

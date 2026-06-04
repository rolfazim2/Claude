// Формирование отчёта прогона (рулбук 6.7). Markdown, коммитится workflow'ом в reports/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentMode } from './config.js';
import type { TagOutcome } from './types.js';

export interface RunStats {
  mode: AgentMode;
  startedAt: Date;
  finishedAt: Date;
  queueStart: number;
  queueEnd: number;
  outcomes: TagOutcome[];
}

export function buildReport(s: RunStats): string {
  const bound = s.outcomes.filter((o) => o.decision === 'bind' && o.verified);
  const boundPending = s.outcomes.filter((o) => o.decision === 'bind' && !o.verified);
  const created = s.outcomes.filter((o) => o.decision === 'create');
  const review = s.outcomes.filter((o) => o.decision === 'review');
  const skipped = s.outcomes.filter((o) => o.decision === 'skip');
  const durMin = ((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000).toFixed(1);

  const lines: string[] = [];
  lines.push(`# Прогон агента opt-spb.ru — ${s.startedAt.toISOString()}`);
  lines.push('');
  lines.push(`- Режим: **${s.mode}**, длительность: ${durMin} мин`);
  lines.push(`- Очередь «Не найденные теги»: **${s.queueStart} → ${s.queueEnd}** (Δ ${s.queueEnd - s.queueStart})`);
  lines.push(`- Обработано тегов: ${s.outcomes.length}`);
  lines.push(`- Привязано (подтверждено reload): **${bound.length}**`);
  lines.push(`- Привязано, ожидает синхронизацию: ${boundPending.length}`);
  lines.push(`- Создано карточек: **${created.length}**`);
  lines.push(`- На согласование (review): **${review.length}**`);
  lines.push(`- Пропущено (заголовки/не товары): ${skipped.length}`);
  lines.push('');

  if (bound.length || boundPending.length) {
    lines.push('## Привязки');
    for (const o of [...bound, ...boundPending]) {
      lines.push(`- ${o.verified ? '✅' : '🕒'} «${o.tag}» → ID ${o.productId} (${o.supplier ?? '—'}) — ${o.detail}`);
    }
    lines.push('');
  }
  if (created.length) {
    lines.push('## Созданные карточки');
    for (const o of created) lines.push(`- «${o.tag}» → ID ${o.productId ?? '?'} — ${o.detail}`);
    lines.push('');
  }
  if (review.length) {
    lines.push('## ⚠️ Спорные карточки (требуют решения владельца)');
    for (const o of review) {
      lines.push(`### «${o.tag}» (${o.supplier ?? '—'})`);
      lines.push(`- Уверенность: ${o.confidence ?? 0}`);
      lines.push(`- ${o.detail}`);
      lines.push('');
    }
  }
  if (skipped.length) {
    lines.push('## Пропущенные');
    for (const o of skipped) lines.push(`- «${o.tag}» — ${o.detail}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function saveReport(content: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

export function reportPath(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}`;
  return `reports/cron_run_${name}.md`;
}

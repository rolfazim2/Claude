// Оркестратор прогона: вход → чтение очереди снизу вверх → для каждого тега
// (parse → search → decide → bind|create|review) в рамках бюджета времени → отчёт.
// Свежий контекст на каждый почасовой запуск; состояние = сама очередь + список уже
// вынесенных на review тегов (чтобы не дёргать их каждый час).

import { loadConfig } from './config.js';
import { log, registerSecret } from './logger.js';
import { AdminSession } from './browser/session.js';
import { TagQueue } from './browser/queue.js';
import { ProductSearch } from './browser/search.js';
import { Binder } from './browser/bind.js';
import { ImagePipeline } from './browser/image.js';
import { YandexImages } from './browser/yandex.js';
import { ProductCreator } from './browser/create.js';
import { Decider } from './matching/decide.js';
import { parseTag } from './matching/parse.js';
import { buildReport, reportPath, saveReport, type RunStats } from './report.js';
import { loadReviewed, saveReviewed, tagKey } from './state.js';
import type { BindDecision, CreateDecision, TagOutcome } from './types.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  registerSecret(cfg.password);
  registerSecret(cfg.anthropicApiKey);
  log.info(`Старт агента opt-spb.ru`, { mode: cfg.mode, model: cfg.model, budgetMin: cfg.timeBudgetMs / 60000 });

  const startedAt = new Date();
  const deadline = startedAt.getTime() + cfg.timeBudgetMs;
  const outcomes: TagOutcome[] = [];
  const reviewed = loadReviewed();

  const session = new AdminSession(cfg);
  let queueStart = 0;
  let queueEnd = 0;

  try {
    await session.open();
    await session.login();

    const queue = new TagQueue(session);
    const search = new ProductSearch(session);
    const decider = new Decider(cfg);
    const image = new ImagePipeline(session);
    const yandex = new YandexImages(session, decider);
    const creator = new ProductCreator(session, image, yandex, cfg.imageSource);
    const binder = new Binder(session, queue);

    await queue.open();
    queueStart = await queue.count();
    const rows = await queue.read(); // снизу вверх
    log.info(`Бюджет: до ${cfg.maxTags || '∞'} тегов / ${cfg.timeBudgetMs / 60000} мин`);

    let processed = 0;
    for (const row of rows) {
      if (Date.now() > deadline) {
        log.warn('Истёк бюджет времени — завершаю прогон');
        break;
      }
      if (cfg.maxTags && processed >= cfg.maxTags) {
        log.info('Достигнут лимит MAX_TAGS');
        break;
      }
      // Уже вынесенные на согласование теги пропускаем, чтобы не зацикливаться.
      if (reviewed.has(tagKey(row.tag, row.supplierId))) continue;

      processed++;
      const tag = parseTag(row.tag, row.supplierId);
      log.step(`[${processed}] «${row.tag}»`, { supplier: tag.supplierName });

      try {
        const candidates = tag.isSectionHeader ? [] : await search.findCandidates(tag);
        const decision = await decider.decide(tag, candidates);

        if (decision.action === 'skip') {
          outcomes.push({ tag: row.tag, supplier: tag.supplierName, decision: 'skip', detail: decision.reason });
          reviewed.add(tagKey(row.tag, row.supplierId)); // заголовки больше не трогаем
          continue;
        }

        if (decision.action === 'review') {
          outcomes.push({
            tag: row.tag,
            supplier: tag.supplierName,
            decision: 'review',
            confidence: decision.confidence,
            detail: `${decision.reason}${decision.recommendation ? ` | рекомендация: ${decision.recommendation}` : ''}` +
              (decision.candidates.length ? ` | кандидаты: ${decision.candidates.map((c) => `[${c.id}] ${c.name}`).join('; ')}` : ''),
          });
          reviewed.add(tagKey(row.tag, row.supplierId));
          continue;
        }

        if (cfg.mode === 'dry-run') {
          outcomes.push({
            tag: row.tag,
            supplier: tag.supplierName,
            decision: decision.action,
            confidence: 'confidence' in decision ? decision.confidence : undefined,
            detail: `[dry-run] ${describeIntent(decision)}`,
            productId: decision.action === 'bind' ? decision.productId : undefined,
          });
          continue;
        }

        if (decision.action === 'bind') {
          const term = bestSearchTerm(tag, decision.productName);
          const res = await binder.bind({ tagText: row.tag, productId: decision.productId, productName: decision.productName, searchTerm: term });
          outcomes.push({
            tag: row.tag,
            supplier: tag.supplierName,
            decision: 'bind',
            confidence: decision.confidence,
            productId: decision.productId,
            verified: res.verified,
            detail: res.note,
          });
          continue;
        }

        if (decision.action === 'create') {
          if (cfg.mode === 'safe') {
            outcomes.push({ tag: row.tag, supplier: tag.supplierName, decision: 'review', confidence: decision.confidence, detail: `safe-режим: создание отложено на ревью — ${decision.title}` });
            reviewed.add(tagKey(row.tag, row.supplierId));
            continue;
          }
          const res = await creator.create(tag, decision.title, decision.imageQuery, candidates);
          if (res.created && res.productId) {
            // Создали карточку — теперь привязываем тег к ней реальным кликом.
            const term = bestSearchTerm(tag, decision.title);
            const bindRes = await binder.bind({ tagText: row.tag, productId: res.productId, productName: decision.title, searchTerm: term });
            outcomes.push({ tag: row.tag, supplier: tag.supplierName, decision: 'create', productId: res.productId, verified: bindRes.verified, detail: `создан и ${bindRes.note}` });
          } else {
            outcomes.push({ tag: row.tag, supplier: tag.supplierName, decision: 'review', confidence: decision.confidence, detail: `создание отложено: ${res.reason}` });
            reviewed.add(tagKey(row.tag, row.supplierId));
          }
          // Вернуться на вкладку очереди для следующих итераций.
          await queue.open();
        }
      } catch (err) {
        log.error(`Ошибка на теге «${row.tag}»`, String(err));
        outcomes.push({ tag: row.tag, supplier: tag.supplierName, decision: 'review', detail: `исключение: ${String(err)}` });
      }
    }

    queueEnd = await queue.count();
  } finally {
    await session.close();
  }

  const stats: RunStats = { mode: cfg.mode, startedAt, finishedAt: new Date(), queueStart, queueEnd, outcomes };
  const report = buildReport(stats);
  const path = reportPath(startedAt);
  saveReport(report, path);
  saveReviewed(reviewed);
  log.info(`Отчёт сохранён: ${path}`);
  // Краткая сводка в stdout для логов CI.
  log.info('Итог', { queue: `${queueStart}->${queueEnd}`, bound: outcomes.filter((o) => o.decision === 'bind').length, created: outcomes.filter((o) => o.decision === 'create').length, review: outcomes.filter((o) => o.decision === 'review').length });
}

function describeIntent(d: BindDecision | CreateDecision): string {
  if (d.action === 'bind') return `привязал бы к ID ${d.productId} (${d.productName})`;
  return `создал бы карточку «${d.title}»`;
}

/** Короткий запрос, по которому товар точно появится в Select2 (модель + память/цвет). */
function bestSearchTerm(tag: { model: string | null; storageRaw: string | null; colorEn: string | null; generation: string | null }, productName: string): string {
  const base = (tag.model ?? tag.generation ?? productName).replace(/\b(iphone|apple|samsung|galaxy|5g|4g)\b/giu, ' ').replace(/\s+/g, ' ').trim();
  const short = base.split(/\s+/).slice(0, 3).join(' ');
  return [short, tag.storageRaw, tag.colorEn].filter(Boolean).join(' ').trim() || productName.slice(0, 25);
}

main().catch((err) => {
  log.error('Фатальная ошибка прогона', String(err?.stack ?? err));
  process.exitCode = 1;
});

// Решающий слой. ЭКОНОМИЯ ТОКЕНОВ + ТОЧНОСТЬ строятся на двухступенчатой схеме:
//
//  Ступень 1 — ДЕТЕРМИНИРОВАННЫЙ fast-path (0 токенов, deterministicDecision):
//   • секционный заголовок → skip;
//   • ровно ОДИН кандидат прошёл строгую 1:1 верификацию И тег информативен
//     (≥2 значимых сигнала: память/цвет/чип/партномер/связь) → bind без LLM —
//     верификатор уже доказал отсутствие конфликтов;
//   • НОЛЬ прошедших И тег распарсен полно (модель+память+цвет) → create без LLM,
//     название строит детерминированный конструктор по паттернам сайта (title.ts).
//
//  Ступень 2 — LLM (Claude) ТОЛЬКО для неоднозначных случаев: несколько прошедших
//  кандидатов, неполный парс, конфликтующие сигналы. Промпт ужат, системный рулбук
//  кэшируется (prompt caching), расход токенов копится в usage и попадает в отчёт.
//
//  Без ANTHROPIC_API_KEY агент работает «из коробки» в детерминированном режиме:
//  однозначное привязывает/создаёт, всё спорное честно уходит в review.

import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import type { Decision, ProductCandidate, TagConfig } from '../types.js';
import { TYPE_LABEL } from '../types.js';
import { RULEBOOK_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } from '../knowledge/rules.js';
import { strictFilter } from './verify.js';
import { buildTitle } from './title.js';
import { log } from '../logger.js';

const DECISION_SCHEMA = `Верни СТРОГО один JSON-объект без markdown, по одной из форм:
{"action":"bind","productId":<int>,"confidence":<0..1>,"reason":"<кратко>"}
{"action":"create","title":"<название по правилам>","confidence":<0..1>,"reason":"<кратко>","imageQuery":"<модель+цвет+версия для поиска картинки>"}
{"action":"review","confidence":<0..1>,"reason":"<в чём сомнение>","recommendation":"<что предлагаешь>"}
{"action":"skip","reason":"<почему это не товар>"}`;

/** Накопленный расход токенов за прогон (для отчёта). */
export interface LlmUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Сколько значимых сигналов распознано в теге (информативность для авто-решений). */
export function significantSignals(tag: TagConfig): number {
  let n = 0;
  if (tag.rom != null) n++;
  if (tag.ram != null) n++;
  if (tag.colorRu) n++;
  if (tag.chip || tag.generation) n++;
  if (tag.partNumber) n++;
  if (tag.connectivity) n++;
  return n;
}

/**
 * Ступень 1: решение без LLM, если случай однозначен. Возвращает null, когда нужна
 * LLM-арбитрация (или review при отсутствии ключа).
 */
export function deterministicDecision(
  tag: TagConfig,
  passed: ProductCandidate[],
  threshold: number,
): Decision | null {
  if (tag.isSectionHeader) {
    return { action: 'skip', reason: 'Секционный заголовок / пустая конфигурация — не товар' };
  }

  const signals = significantSignals(tag);

  // Единственный выживший после строгой верификации + информативный тег → bind.
  const BIND_CONF = 0.97;
  if (passed.length === 1 && signals >= 2 && BIND_CONF >= threshold) {
    return {
      action: 'bind',
      productId: passed[0].id,
      productName: passed[0].name,
      confidence: BIND_CONF,
      reason: `единственный кандидат прошёл строгую 1:1 верификацию (сигналов: ${signals})`,
    };
  }

  // Точного товара нет, тег распарсен полно → create с детерминированным названием.
  const CREATE_CONF = 0.96;
  const parseComplete =
    tag.model != null && tag.rom != null && tag.colorRu != null && (tag.brand != null || tag.generation != null || tag.chip != null);
  if (passed.length === 0 && parseComplete && CREATE_CONF >= threshold) {
    return {
      action: 'create',
      title: buildTitle(tag),
      type: tag.type,
      confidence: CREATE_CONF,
      reason: 'нет кандидатов после строгой верификации; конфигурация распознана полностью',
      imageQuery: [tag.brand, tag.model, tag.colorEn ?? tag.colorRu].filter(Boolean).join(' '),
    };
  }

  return null; // неоднозначно → ступень 2
}

export class Decider {
  private client: Anthropic | null;
  readonly usage: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  constructor(private cfg: Config) {
    this.client = cfg.anthropicApiKey ? new Anthropic({ apiKey: cfg.anthropicApiKey }) : null;
    if (!this.client) {
      log.warn('ANTHROPIC_API_KEY не задан — работаю в детерминированном режиме (спорное → review)');
    }
  }

  async decide(tag: TagConfig, candidates: ProductCandidate[]): Promise<Decision> {
    const { passed, rejected } = strictFilter(tag, candidates);

    // Ступень 1: бесплатное решение.
    const det = deterministicDecision(tag, passed, this.cfg.confidenceThreshold);
    if (det) return det;

    // Ступень 2: LLM-арбитраж. Без ключа — честный review.
    if (!this.client) {
      return {
        action: 'review',
        confidence: 0,
        reason: `неоднозначный случай (${passed.length} кандидатов прошли верификацию), LLM отключён`,
        recommendation: 'задайте ANTHROPIC_API_KEY либо разберите вручную',
        candidates: passed,
      };
    }

    const resp = await this.client.messages.create({
      model: this.cfg.model,
      max_tokens: 400,
      system: [
        { type: 'text', text: RULEBOOK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: DECISION_SCHEMA },
      ],
      messages: [{ role: 'user', content: this.buildUserPrompt(tag, passed, rejected) }],
    });
    this.track(resp);

    const raw = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return this.parseDecision(raw, tag, passed);
  }

  /** Vision-проверка: на картинке именно эта модель и именно этот цвет? (правило 6.4) */
  async verifyImageMatch(tag: TagConfig, imageUrl: string): Promise<{ match: boolean; confidence: number; reason: string }> {
    if (!this.client) return { match: false, confidence: 0, reason: 'LLM отключён (нет ANTHROPIC_API_KEY)' };
    const desc = [tag.brand, tag.model ?? tag.generation, tag.storageRaw].filter(Boolean).join(' ');
    const wantColor = tag.colorRu ? `${tag.colorRu}${tag.colorEn ? ` (${tag.colorEn})` : ''}` : 'не задан';
    const resp = await this.client.messages.create({
      model: this.cfg.model,
      max_tokens: 150,
      system: [{ type: 'text', text: VISION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Товар: «${desc}». Требуемый цвет: ${wantColor}. Это фото подходит для карточки?` },
            { type: 'image', source: { type: 'url', url: imageUrl } },
          ],
        },
      ],
    });
    this.track(resp);
    const json = extractJson(resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''));
    if (!json) return { match: false, confidence: 0, reason: 'не разобран ответ vision' };
    return { match: Boolean(json.match), confidence: clamp01(Number(json.confidence ?? 0)), reason: String(json.reason ?? '') };
  }

  private track(resp: Anthropic.Message): void {
    this.usage.calls++;
    this.usage.inputTokens += resp.usage.input_tokens ?? 0;
    this.usage.outputTokens += resp.usage.output_tokens ?? 0;
    this.usage.cacheReadTokens += (resp.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  }

  private buildUserPrompt(tag: TagConfig, passed: ProductCandidate[], rejected: Array<{ cand: ProductCandidate; reason: string }>): string {
    // Ужатый промпт: только заполненные поля, кандидаты с лимитом.
    const f = (label: string, v: unknown) => (v == null || v === '' ? null : `${label}:${v}`);
    const cfgLine = [
      f('бренд', tag.brand),
      f('модель', tag.model),
      f('чип', tag.chip),
      f('поколение', tag.generation),
      f('память', tag.storageRaw),
      f('цвет', tag.colorRu && `${tag.colorRu}/${tag.colorEn ?? ''}`),
      `страна:${tag.country ?? 'НЕТ'}`,
      `тип:${tag.type}${tag.typeExplicit ? '' : '(по поставщику)'}→«${TYPE_LABEL[tag.type] || 'Новый-без-подписи'}»`,
      f('связь', tag.connectivity),
      f('nfc', tag.nfc),
      f('диагональ', tag.diagonal),
      f('партномер', tag.partNumber),
    ]
      .filter(Boolean)
      .join(' | ');

    const passedLines = passed.length
      ? passed.slice(0, 10).map((c) => `[${c.id}] ${c.name}`).join('\n')
      : '(нет прошедших строгую верификацию)';
    const rejLines = rejected.length
      ? rejected.slice(0, 5).map((r) => `[${r.cand.id}] ${r.cand.name} — ОТКЛОНЁН: ${r.reason}`).join('\n')
      : '(нет)';

    return `Тег: ${tag.raw}
Поставщик: ${tag.supplierName ?? '—'} | Распознано: ${cfgLine}

ПРОШЛИ строгую 1:1 верификацию (bind возможен ТОЛЬКО к ним):
${passedLines}

Отклонены верификатором (контекст, НЕ привязывать):
${rejLines}

Реши по правилам ≥95%: один точный → bind; нет прошедших → create (название по паттернам сайта) или review при сомнении в параметрах/картинке; несколько/неоднозначно → review.`;
  }

  private parseDecision(raw: string, tag: TagConfig, passed: ProductCandidate[]): Decision {
    const json = extractJson(raw);
    if (!json) {
      log.warn('Не удалось распарсить ответ модели, выношу в review', { raw: raw.slice(0, 200) });
      return { action: 'review', confidence: 0, reason: 'Не разобран ответ модели', recommendation: raw.slice(0, 300), candidates: passed };
    }
    const conf = clamp01(Number(json.confidence ?? 0));

    if (json.action === 'bind') {
      const productId = Number(json.productId);
      const cand = passed.find((c) => c.id === productId);
      // Привязка разрешена только к прошедшему верификацию кандидату и при conf ≥ порога.
      if (!cand) {
        return { action: 'review', confidence: conf, reason: `Модель предложила id ${productId}, которого нет среди прошедших верификацию`, recommendation: raw.slice(0, 200), candidates: passed };
      }
      if (conf < this.cfg.confidenceThreshold) {
        return { action: 'review', confidence: conf, reason: `Уверенность ${conf} ниже порога ${this.cfg.confidenceThreshold}`, recommendation: `bind→${productId}`, candidates: passed };
      }
      return { action: 'bind', productId, productName: cand.name, confidence: conf, reason: String(json.reason ?? '') };
    }

    if (json.action === 'create') {
      if (conf < this.cfg.confidenceThreshold) {
        return { action: 'review', confidence: conf, reason: `Создание с уверенностью ${conf} < ${this.cfg.confidenceThreshold}`, recommendation: `create: ${json.title}`, candidates: passed };
      }
      return { action: 'create', title: String(json.title ?? buildTitle(tag)), type: tag.type, confidence: conf, reason: String(json.reason ?? ''), imageQuery: String(json.imageQuery ?? `${tag.model ?? ''} ${tag.colorEn ?? tag.colorRu ?? ''}`.trim()) };
    }

    if (json.action === 'skip') {
      return { action: 'skip', reason: String(json.reason ?? 'не товар') };
    }

    return { action: 'review', confidence: conf, reason: String(json.reason ?? 'спорный случай'), recommendation: String(json.recommendation ?? ''), candidates: passed };
  }
}

function extractJson(s: string): any | null {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// Решающий слой: Claude выносит вердикт по тегу с учётом рулбука и строгой верификации.
// Детерминированный verify.ts уже отсеял конфликтующих кандидатов — LLM выбирает между
// «привязать к одному из прошедших», «создать новый» и «вынести на согласование»,
// и честно проставляет confidence (правило ≥95%).

import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import type { Decision, ProductCandidate, TagConfig } from '../types.js';
import { TYPE_LABEL } from '../types.js';
import { RULEBOOK_SYSTEM_PROMPT } from '../knowledge/rules.js';
import { strictFilter } from './verify.js';
import { log } from '../logger.js';

const DECISION_SCHEMA = `Верни СТРОГО один JSON-объект без markdown, по одной из форм:
{"action":"bind","productId":<int>,"confidence":<0..1>,"reason":"<кратко>"}
{"action":"create","title":"<название по правилам>","confidence":<0..1>,"reason":"<кратко>","imageQuery":"<модель+цвет+версия для поиска точной картинки>"}
{"action":"review","confidence":<0..1>,"reason":"<в чём сомнение>","recommendation":"<что предлагаешь>"}
{"action":"skip","reason":"<почему это не товар>"}`;

export class Decider {
  private client: Anthropic;
  constructor(private cfg: Config) {
    this.client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  }

  async decide(tag: TagConfig, candidates: ProductCandidate[]): Promise<Decision> {
    // Секционные заголовки даже не отправляем в модель.
    if (tag.isSectionHeader) {
      return { action: 'skip', reason: 'Секционный заголовок / пустая конфигурация — не товар' };
    }

    // Детерминированный предохранитель: отсекаем конфликтующих кандидатов.
    const { passed, rejected } = strictFilter(tag, candidates);

    const userPrompt = this.buildUserPrompt(tag, passed, rejected);
    const resp = await this.client.messages.create({
      model: this.cfg.model,
      max_tokens: 700,
      system: [
        // Рулбук постоянен между вызовами → кэшируем для экономии и скорости.
        { type: 'text', text: RULEBOOK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: DECISION_SCHEMA },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return this.parseDecision(raw, tag, passed);
  }

  private buildUserPrompt(tag: TagConfig, passed: ProductCandidate[], rejected: Array<{ cand: ProductCandidate; reason: string }>): string {
    const cfgLines = [
      `Тег (дословно): ${tag.raw}`,
      `Поставщик: ${tag.supplierName ?? '—'} (id ${tag.supplierId ?? '—'})`,
      `Распознано → бренд:${tag.brand ?? '—'} модель:${tag.model ?? '—'} чип:${tag.chip ?? '—'} поколение:${tag.generation ?? '—'}`,
      `  память: ram=${tag.ram ?? '—'} rom=${tag.rom ?? '—'} (${tag.storageRaw ?? '—'})`,
      `  цвет: ${tag.colorRu ?? '—'} / ${tag.colorEn ?? '—'}`,
      `  страна: ${tag.country ?? 'НЕТ СТРАНЫ'} (источник: ${tag.countrySource ?? '—'})`,
      `  тип: ${tag.type}${tag.typeExplicit ? ' (явно в теге)' : ' (по умолчанию поставщика)'} → подпись «${TYPE_LABEL[tag.type] || 'без подписи (Новый)'}»`,
      `  связь:${tag.connectivity ?? '—'} nfc:${tag.nfc ?? '—'} диагональ:${tag.diagonal ?? '—'} партномер:${tag.partNumber ?? '—'}`,
    ].join('\n');

    const passedLines = passed.length
      ? passed.map((c) => `  [${c.id}] ${c.name}`).join('\n')
      : '  (нет кандидатов, прошедших строгую верификацию)';

    const rejLines = rejected.length
      ? rejected.slice(0, 8).map((r) => `  [${r.cand.id}] ${r.cand.name} — ОТКЛОНЁН: ${r.reason}`).join('\n')
      : '  (нет)';

    return `${cfgLines}

Кандидаты, ПРОШЕДШИЕ строгую 1:1 верификацию (можно привязывать только к ним):
${passedLines}

Кандидаты, отклонённые верификатором (НЕ привязывать, дано для контекста):
${rejLines}

Задача: реши действие по правилам ≥95%. Если среди прошедших есть ровно один точный — bind.
Если прошедших нет — create (составь название по правилам) либо review, если не уверен в
параметрах/картинке. Если кандидатов несколько и выбор неоднозначен — review.`;
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
      return { action: 'create', title: String(json.title ?? tag.model ?? tag.raw), type: tag.type, confidence: conf, reason: String(json.reason ?? ''), imageQuery: String(json.imageQuery ?? `${tag.model ?? ''} ${tag.colorEn ?? tag.colorRu ?? ''}`.trim()) };
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

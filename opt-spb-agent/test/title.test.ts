import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag } from '../src/matching/parse.js';
import { buildTitle } from '../src/matching/title.js';
import { deterministicDecision, significantSignals } from '../src/matching/decide.js';

// ── buildTitle: детерминированный конструктор названия (правила 6.3) ─────────

test('флаг страны → каноническое слово, буллет/эмодзи убраны', () => {
  const t = parseTag('•S26 Ultra 12/256 Pink Gold 🇮🇩', 16);
  assert.equal(buildTitle(t), 'S26 Ultra 12/256 Pink Gold Индонезия');
});

test('слово «Новый» никогда не пишется, тип new — без подписи', () => {
  const t = parseTag('🔥 Pitaka 16 Pro Ultra Slim Case Ocean', 5);
  const title = buildTitle(t);
  assert.ok(!/новый/i.test(title));
  assert.ok(!title.includes('('));
  assert.ok(title.startsWith('Pitaka 16 Pro'));
});

test('тип Восстановленный → подпись в скобках, маркер из текста убран', () => {
  const t = parseTag('13 128 black ref', 2);
  const title = buildTitle(t);
  assert.ok(title.includes('(Восстановленный)'), title);
  assert.ok(!/\bref\b/i.test(title.replace('(Восстановленный)', '')), title);
});

test('страна словом не дублируется', () => {
  const t = parseTag('Marshall Woburn III black Европа', 5);
  const title = buildTitle(t);
  assert.equal((title.match(/Европа/g) ?? []).length, 1);
});

test('цена вырезается из названия', () => {
  const t = parseTag('16 Pro Max 256 Black 89900 руб', 5);
  assert.ok(!/руб|89900/.test(buildTitle(t)));
});

// ── deterministicDecision: fast-path без LLM ─────────────────────────────────

test('единственный прошедший кандидат + информативный тег → bind без LLM', () => {
  const tag = parseTag('• Air 13 M5 16/512 Silver MDH74', 16);
  assert.ok(significantSignals(tag) >= 2);
  const d = deterministicDecision(tag, [{ id: 23931, name: 'Macbook Air 13 M5 16/512 Silver (2026) (MDH74)' }], 0.95);
  assert.equal(d?.action, 'bind');
  if (d?.action === 'bind') assert.equal(d.productId, 23931);
});

test('ноль кандидатов + полный парс → create с детерминированным названием', () => {
  const tag = parseTag('•S26 Ultra 12/256 Pink Gold 🇮🇩', 16);
  const d = deterministicDecision(tag, [], 0.95);
  assert.equal(d?.action, 'create');
  if (d?.action === 'create') assert.equal(d.title, 'S26 Ultra 12/256 Pink Gold Индонезия');
});

test('несколько прошедших кандидатов → null (нужна LLM-арбитрация)', () => {
  const tag = parseTag('S26 Ultra 12/256 Pink Gold', 16);
  const d = deterministicDecision(
    tag,
    [
      { id: 1, name: 'S26 ultra 12/256 Pink Gold' },
      { id: 2, name: 'S26 ultra 12/256 Pink Gold SM-S948' },
    ],
    0.95,
  );
  assert.equal(d, null);
});

test('малоинформативный тег (1 сигнал) НЕ привязывается автоматически', () => {
  const tag = parseTag('HomePod mini Space gray', 3); // только цвет — 1 сигнал
  const d = deterministicDecision(tag, [{ id: 24334, name: 'HomePod mini, Space Gray' }], 0.95);
  assert.equal(d, null); // уходит на LLM/review, не auto-bind
});

test('секционный заголовок → skip без LLM', () => {
  const tag = parseTag('Игры Релиз:', 3);
  assert.equal(deterministicDecision(tag, [], 0.95)?.action, 'skip');
});

test('порог выше детерминированной уверенности → fast-path не срабатывает', () => {
  const tag = parseTag('• Air 13 M5 16/512 Silver MDH74', 16);
  const d = deterministicDecision(tag, [{ id: 23931, name: 'Macbook Air 13 M5 16/512 Silver (MDH74)' }], 0.99);
  assert.equal(d, null);
});

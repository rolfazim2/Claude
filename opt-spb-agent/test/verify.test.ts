import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag } from '../src/matching/parse.js';
import { verifyCandidate, strictFilter } from '../src/matching/verify.js';

test('M5 тег НЕ проходит верификацию против M4 карточки (инцидент 17.05)', () => {
  const tag = parseTag('MacBook Pro 14 M5 MAX 128/2TB', 5);
  const r = verifyCandidate(tag, { id: 1, name: 'MacBook Pro 14 M4 Max 64/2Tb' });
  assert.equal(r.ok, false);
});

test('точное совпадение проходит', () => {
  const tag = parseTag('• Air 13 M5 16/512 Silver MDH74', 16);
  const r = verifyCandidate(tag, { id: 23931, name: 'Macbook Air 13 M5 16/512 Silver (2026) (MDH74)' });
  assert.equal(r.ok, true);
});

test('тег без страны НЕ привязывается к карточке со страной', () => {
  const tag = parseTag('S26 Ultra 12/256 Pink Gold', 16);
  const r = verifyCandidate(tag, { id: 1, name: 'S26 ultra 12/256 Pink Gold Индонезия' });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /без страны/i);
});

test('тег со страной НЕ привязывается к карточке без страны', () => {
  const tag = parseTag('S26 Ultra 12/256 Pink Gold 🇮🇩', 16);
  const r = verifyCandidate(tag, { id: 1, name: 'S26 ultra 12/256 Pink Gold' });
  assert.equal(r.ok, false);
});

test('разная память отклоняется', () => {
  const tag = parseTag('iPhone 16 Pro 256 Black', 5);
  const r = verifyCandidate(tag, { id: 1, name: '16 Pro 128 Black' });
  assert.equal(r.ok, false);
});

test('Denim ≠ Синий', () => {
  const tag = parseTag('Sennheiser Momentum 4 Denim', 5);
  const r = verifyCandidate(tag, { id: 1, name: 'Sennheiser Momentum 4 Синий' });
  assert.equal(r.ok, false);
});

test('strictFilter делит кандидатов на прошедших и отклонённых', () => {
  const tag = parseTag('S26 Ultra 12/256 Pink Gold', 16);
  const { passed, rejected } = strictFilter(tag, [
    { id: 24408, name: 'S26 ultra 12/256 Pink Gold' }, // без страны — ок
    { id: 24447, name: 'S26 ultra 12/256 Pink Gold Индонезия' }, // со страной — отклонён
  ]);
  assert.equal(passed.length, 1);
  assert.equal(passed[0].id, 24408);
  assert.equal(rejected.length, 1);
});

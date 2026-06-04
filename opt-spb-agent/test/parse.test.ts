import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag } from '../src/matching/parse.js';

test('S26 Ultra с памятью, цветом, страной (флаг) и партномером', () => {
  const t = parseTag('•S26 Ultra 12/256 Pink Gold SMS948B/DS🇮🇩', 16);
  assert.equal(t.generation, 'S26 Ultra');
  assert.equal(t.ram, 12);
  assert.equal(t.rom, 256);
  assert.equal(t.colorRu, 'Розовое золото');
  assert.equal(t.country, 'Индонезия');
  assert.equal(t.countrySource, 'flag');
  assert.equal(t.type, 'new'); // поставщик 16 — by-tag, тип не указан → Новый
});

test('тег без страны → country null (фундаментальное правило 6.1)', () => {
  const t = parseTag('•S26 Ultra 12/256 Pink Gold', 16);
  assert.equal(t.country, null);
  assert.equal(t.countrySource, null);
});

test('MacBook Air M5 с партномером и без страны', () => {
  const t = parseTag('• Air 13 M5 16/512 Silver MDH74', 16);
  assert.equal(t.chip, 'M5');
  assert.equal(t.ram, 16);
  assert.equal(t.rom, 512);
  assert.equal(t.colorRu, 'Серебристый');
  assert.equal(t.partNumber, 'MDH74');
  assert.equal(t.country, null);
});

test('поставщик 1-Опт (id 2) → тип по умолчанию refurbished', () => {
  const t = parseTag('iPhone 13 128 black', 2);
  assert.equal(t.type, 'refurbished');
  assert.equal(t.typeExplicit, false);
});

test('явный тип Восстановленный перекрывает дефолт поставщика', () => {
  const t = parseTag('iPhone 13 128 black восстановленный', 5);
  assert.equal(t.type, 'refurbished');
  assert.equal(t.typeExplicit, true);
});

test('Global сохраняется как региональный маркер', () => {
  const t = parseTag('Xiaomi Pad 6 8/256Gb Global Wi-Fi gold', 9);
  assert.equal(t.country, 'Global');
  assert.equal(t.connectivity, 'Wi-Fi');
  assert.equal(t.colorRu, 'Золотой');
  assert.equal(t.generation, 'Pad 6');
});

test('секционный заголовок распознаётся', () => {
  assert.equal(parseTag('iPad Air M4 ()', 3).isSectionHeader, true);
  assert.equal(parseTag('Игры Релиз:', 3).isSectionHeader, true);
  assert.equal(parseTag('iPhone 16 Pro Max 256 Black', 3).isSectionHeader, false);
});

test('диагональ и Wi-Fi у планшета', () => {
  const t = parseTag('10.9" Планшет Apple iPad Air 2022, 64 Гб, Wi-Fi, space gray', 3);
  assert.equal(t.diagonal, '10.9');
  assert.equal(t.connectivity, 'Wi-Fi');
  assert.equal(t.rom, 64);
  assert.equal(t.colorRu, 'Серый');
});

test('значимые токены собираются для верификации', () => {
  const t = parseTag('S26 Ultra 12/256 Pink Gold 🇮🇩', 16);
  assert.ok(t.tokens.includes('256'));
  assert.ok(t.tokens.includes('12'));
  assert.ok(t.tokens.includes('Розовое золото'));
  assert.ok(t.tokens.includes('Индонезия'));
});

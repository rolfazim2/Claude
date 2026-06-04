// Строгая 1:1 верификация тега против названия товара-кандидата (recipe 7.9).
// Это ДЕТЕРМИНИРОВАННЫЙ предохранитель. Он не «оценивает похожесть» — он отклоняет
// всё, где есть конфликт по значимому параметру. Привязка разрешается, только если
// ВСЕ значимые токены тега присутствуют как подстроки И нет конфликтующих значений.

import type { ProductCandidate, TagConfig } from '../types.js';
import { colorSynonyms } from '../knowledge/colors.js';

export interface VerifyResult {
  ok: boolean;
  reasons: string[]; // почему отклонено / на что обратить внимание
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const has = (hay: string, needle: string) => norm(hay).includes(norm(needle));

/** Граница-словное вхождение числа памяти (чтобы 256 не матчило 2560). */
function hasMemory(name: string, value: number | string): boolean {
  const v = String(value);
  return new RegExp(`(?:^|[^0-9])${v.replace('TB', '\\s*tb')}(?:$|[^0-9])`, 'iu').test(name);
}

/** Конфликтующие чипы/поколения, которые НЕ должны встречаться в названии товара. */
const CHIP_FAMILY = ['M1', 'M2', 'M3', 'M4', 'M5'];

export function verifyCandidate(tag: TagConfig, cand: ProductCandidate): VerifyResult {
  const name = cand.name;
  const reasons: string[] = [];

  // 1) Память — должна совпадать точно.
  if (tag.ram != null && !hasMemory(name, tag.ram)) {
    return fail(`RAM ${tag.ram} не найдена в «${name}»`);
  }
  if (tag.rom != null) {
    const romTok = tag.rom >= 1024 ? `${tag.rom / 1024}TB` : String(tag.rom);
    if (!hasMemory(name, romTok)) return fail(`ROM ${romTok} не найдена в «${name}»`);
  }

  // 2) Чип Apple Silicon — точно, без конфликтующего поколения.
  if (tag.chip) {
    const base = tag.chip.split(' ')[0].toUpperCase(); // M5
    if (!has(name, tag.chip) && !has(name, base)) {
      return fail(`чип ${tag.chip} не найден в «${name}»`);
    }
    for (const other of CHIP_FAMILY) {
      if (other !== base && new RegExp(`\\b${other}\\b`, 'i').test(name)) {
        return fail(`конфликт чипа: тег ${base}, карточка содержит ${other}`);
      }
    }
  }

  // 3) Поколение/серия — точно.
  if (tag.generation && !has(name, tag.generation) && !has(name, tag.generation.replace(/\s+/g, ''))) {
    return fail(`поколение «${tag.generation}» не найдено в «${name}»`);
  }

  // 4) Цвет — хотя бы один синоним должен присутствовать; конфликтующий — запрет.
  if (tag.colorRu) {
    const syns = colorSynonyms(tag.colorRu).concat(tag.colorRu);
    const present = syns.some((s) => has(name, s));
    if (!present) return fail(`цвет «${tag.colorRu}» не найден в «${name}»`);
  }

  // 5) СТРАНА — фундаментально. Включая отсутствие.
  const nameCountry = detectCountryInName(name);
  if (tag.country == null && nameCountry != null) {
    return fail(`тег без страны, а карточка со страной «${nameCountry}»`);
  }
  if (tag.country != null && nameCountry == null) {
    return fail(`тег со страной «${tag.country}», а карточка без страны`);
  }
  if (tag.country != null && nameCountry != null && norm(tag.country) !== norm(nameCountry)) {
    return fail(`разные страны: тег «${tag.country}» vs карточка «${nameCountry}»`);
  }

  // 6) Связь и партномер — если есть в теге, должны присутствовать.
  if (tag.connectivity && !has(name, tag.connectivity) && !connectivityLoose(name, tag.connectivity)) {
    return fail(`версия связи «${tag.connectivity}» не найдена в «${name}»`);
  }
  if (tag.partNumber && !has(name, tag.partNumber)) {
    // партномер — сильный сигнал, но не у всех карточек он есть; не валим, лишь отмечаем
    reasons.push(`партномер ${tag.partNumber} не виден в названии — проверить вручную`);
  }

  return { ok: true, reasons };

  function fail(msg: string): VerifyResult {
    return { ok: false, reasons: [msg] };
  }
}

function connectivityLoose(name: string, conn: string): boolean {
  if (conn === 'Wi-Fi') return /\bwifi\b/i.test(name) || /\bwi-fi\b/i.test(name);
  return false;
}

/** Найти страну в названии карточки (по тем же словам/канонам, что у тега). */
import { WORD_TO_COUNTRY } from '../knowledge/countries.js';
function detectCountryInName(name: string): string | null {
  const lower = norm(name);
  for (const [word, country] of Object.entries(WORD_TO_COUNTRY)) {
    const re = new RegExp(`(?:^|[^a-zа-я0-9])${word}(?:$|[^a-zа-я0-9])`, 'iu');
    if (re.test(lower)) return country;
  }
  return null;
}

/** Отфильтровать кандидатов строгой верификацией. Возвращает прошедших + журнал отклонений. */
export function strictFilter(
  tag: TagConfig,
  candidates: ProductCandidate[],
): { passed: ProductCandidate[]; rejected: Array<{ cand: ProductCandidate; reason: string }> } {
  const passed: ProductCandidate[] = [];
  const rejected: Array<{ cand: ProductCandidate; reason: string }> = [];
  for (const c of candidates) {
    const r = verifyCandidate(tag, c);
    if (r.ok) passed.push(c);
    else rejected.push({ cand: c, reason: r.reasons.join('; ') });
  }
  return { passed, rejected };
}

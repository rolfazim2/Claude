// Парсер тега поставщика → структурированный TagConfig.
// Извлекает модель, поколение/чип, память, цвет, страну, тип, связь, NFC, диагональ, партномер.
// Это детерминированный слой; финальное решение принимает LLM (decide.ts) с этими полями.

import type { ProductType, TagConfig } from '../types.js';
import { supplierName, supplierDefaultType } from '../knowledge/suppliers.js';
import { FLAG_TO_COUNTRY, WORD_TO_COUNTRY, extractFlags } from '../knowledge/countries.js';
import { canonicalColor, colorSynonyms } from '../knowledge/colors.js';

const BRANDS = [
  'Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Poco', 'Google', 'Pixel', 'Sony', 'Marshall',
  'Sennheiser', 'JBL', 'Bose', 'DJI', 'GoPro', 'Pitaka', 'Dyson', 'Nvidia', 'Amazon',
  'Kindle', 'Ray-Ban', 'Meta', 'Nothing', 'Honor', 'Huawei', 'OnePlus', 'Realme',
];

// Маркеры типа. Порядок важен: «актив/распак» проверяется раньше «asis», т.к. перекрывает.
// ВНИМАНИЕ: \b в JS — ASCII-граница и НЕ работает с кириллицей, поэтому используем
// явную границу слева через wordStart() (см. ниже), допуская продолжение основы справа.
const TYPE_MARKERS: Array<{ markers: string[]; type: ProductType }> = [
  { markers: ['актив', 'распак'], type: 'asis-active' },
  { markers: ['восстановл', 'реф', 'ref', 'cpo', 'refurbished'], type: 'refurbished' },
  { markers: ['asis', 'асис'], type: 'asis-inactive' },
  { markers: ['б/у', 'b/u'], type: 'used' },
  { markers: ['без коробки'], type: 'asis-nobox' },
];

/** Вхождение слова/основы с границей слева (работает для кириллицы и латиницы). */
function wordStart(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-zа-яё0-9])${esc}`, 'iu').test(text);
}

/** Нормализовать память «8/256», «12/512», «128/2TB», «1TB», «256» в ram/rom (ГБ) + сырой токен. */
function parseStorage(text: string): { ram: number | null; rom: number | null; raw: string | null } {
  // RAM/ROM вида 8/256, 12/512, 128/2TB
  const dual = text.match(/(\d{1,3})\s*\/\s*(\d{1,4})\s*(tb|тб)?/iu);
  if (dual) {
    const rom = dual[3] ? Number(dual[2]) * 1024 : Number(dual[2]);
    return { ram: Number(dual[1]), rom, raw: `${dual[1]}/${dual[2]}${dual[3] ? 'TB' : ''}` };
  }
  // Одиночный объём в ТБ
  const tb = text.match(/(\d)\s*(?:tb|тб)\b/iu);
  if (tb) {
    return { ram: null, rom: Number(tb[1]) * 1024, raw: `${tb[1]}TB` };
  }
  // Объём с явной единицей (приоритет): «64 Гб», «256GB»
  const unit = text.match(/(\d{2,4})\s*(?:gb|гб|г)\b/iu);
  if (unit) {
    return { ram: null, rom: Number(unit[1]), raw: unit[1] };
  }
  // Одиночный объём без единицы — только типовые значения памяти, чтобы НЕ спутать
  // с номером модели (iPhone 16) или годом (2022). 16/32 ГБ исключены как легаси.
  const bare = text.match(/(?:^|[^\d])(64|128|256|512|1024)(?:[^\d]|$)/);
  if (bare) {
    return { ram: null, rom: Number(bare[1]), raw: bare[1] };
  }
  return { ram: null, rom: null, raw: null };
}

/** Страна: сначала по флаг-эмодзи, затем по словам. */
function parseCountry(text: string): { country: string | null; source: 'flag' | 'word' | null } {
  const flags = extractFlags(text);
  for (const f of flags) {
    if (FLAG_TO_COUNTRY[f]) return { country: FLAG_TO_COUNTRY[f], source: 'flag' };
  }
  const lower = text.toLowerCase();
  for (const [word, country] of Object.entries(WORD_TO_COUNTRY)) {
    // границы слова с учётом кириллицы/латиницы
    const re = new RegExp(`(?:^|[^a-zа-яё0-9])${word}(?:$|[^a-zа-яё0-9])`, 'iu');
    if (re.test(lower)) return { country, source: 'word' };
  }
  return { country: null, source: null };
}

/** Цвет: ищем самый длинный совпавший синоним (чтобы «space gray» бил «gray»). */
function parseColor(text: string): { ru: string | null; en: string | null } {
  const lower = text.toLowerCase();
  let bestCanon: string | null = null;
  let bestLen = 0;
  // соберём все синонимы и проверим вхождение
  for (let canon of canonicalColorsAll()) {
    for (const syn of colorSynonyms(canon)) {
      const re = new RegExp(`(?:^|[^a-zа-яё])${escapeRe(syn)}(?:$|[^a-zа-яё])`, 'iu');
      if (re.test(lower) && syn.length > bestLen) {
        bestLen = syn.length;
        bestCanon = canon;
      }
    }
  }
  if (!bestCanon) return { ru: null, en: null };
  const syns = colorSynonyms(bestCanon);
  // англоязычный вариант = первый латинский синоним
  const en = syns.find((s) => /[a-z]/.test(s)) ?? null;
  return { ru: bestCanon, en };
}

function parseType(text: string, supplierId: number | null): { type: ProductType; explicit: boolean } {
  for (const { markers, type } of TYPE_MARKERS) {
    if (markers.some((m) => wordStart(text, m))) return { type, explicit: true };
  }
  const def = supplierDefaultType(supplierId);
  if (def !== 'by-tag') return { type: def, explicit: false };
  return { type: 'new', explicit: false };
}

/** Чип Apple Silicon / Bionic. */
function parseChip(text: string): string | null {
  const m = text.match(/\b(M[1-5](?:\s?(?:Pro|Max|Ultra))?|A1[0-9](?:\s?Pro)?)\b/iu);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/** Партномер: MK183RU/A, MDH74, KI1501PA, SM-S948B. */
function parsePartNumber(text: string): string | null {
  const m =
    text.match(/\b([A-Z]{2}\d{3,4}[A-Z]{0,2}\/?[A-Z]?)\b/) || // MK183RU/A
    text.match(/\b(SM-[A-Z0-9]+)\b/) || // Samsung SM-...
    text.match(/\b([A-Z]{3}\d{2,3})\b/); // MDH74
  return m ? m[1] : null;
}

/** Связь и NFC. */
function parseConnectivity(text: string): string | null {
  if (/\bcellular\b/iu.test(text)) return 'Cellular';
  if (/\blte\b/iu.test(text)) return 'LTE';
  if (/\b5g\b/iu.test(text)) return '5G';
  if (/\b4g\b/iu.test(text)) return '4G';
  if (/\bwi-?fi\b/iu.test(text)) return 'Wi-Fi';
  return null;
}
function parseNfc(text: string): boolean | null {
  if (/\bбез\s*nfc\b/iu.test(text) || /\bno\s*nfc\b/iu.test(text)) return false;
  if (/\bnfc\b/iu.test(text)) return true;
  return null;
}

function parseDiagonal(text: string): string | null {
  const m = text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:"|''|”|дюйм|inch)/iu);
  return m ? m[1].replace(',', '.') : null;
}

function parseBrand(text: string): string | null {
  for (const b of BRANDS) {
    if (new RegExp(`\\b${escapeRe(b)}\\b`, 'iu').test(text)) return b;
  }
  return null;
}

/** Секционный заголовок без конфигурации: «iPad Air M4 ()», «Игры Релиз:», пустое. */
function isSectionHeader(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/\(\s*\)\s*$/.test(t)) return true; // оканчивается на «()»
  if (/(релиз|games|игры)\s*:?\s*$/iu.test(t)) return true;
  // нет ни одной цифры и нет бренда — вероятно заголовок раздела
  if (!/\d/.test(t) && !parseBrand(t)) return true;
  return false;
}

/**
 * Значимые токены тега для строгой 1:1 верификации (recipe 7.9).
 * Включают: память (8, 256), чип/поколение, цвет (рус+англ), страну, тип, связь, партномер.
 */
function buildTokens(c: Omit<TagConfig, 'tokens'>): string[] {
  const t = new Set<string>();
  if (c.ram) t.add(String(c.ram));
  if (c.rom) t.add(String(c.rom >= 1024 ? `${c.rom / 1024}TB` : c.rom));
  if (c.storageRaw) t.add(c.storageRaw);
  if (c.chip) t.add(c.chip);
  if (c.generation) t.add(c.generation);
  if (c.colorRu) t.add(c.colorRu);
  if (c.colorEn) t.add(c.colorEn);
  if (c.country) t.add(c.country);
  if (c.connectivity) t.add(c.connectivity);
  if (c.partNumber) t.add(c.partNumber);
  if (c.diagonal) t.add(c.diagonal);
  return [...t];
}

export function parseTag(raw: string, supplierId: number | null): TagConfig {
  const text = raw.replace(/\s+/g, ' ').trim();
  const header = isSectionHeader(text);

  const brand = parseBrand(text);
  const chip = parseChip(text);
  const { ram, rom, raw: storageRaw } = parseStorage(text);
  const color = parseColor(text);
  const { country, source } = parseCountry(text);
  const { type, explicit } = parseType(text, supplierId);
  const connectivity = parseConnectivity(text);
  const nfc = parseNfc(text);
  const diagonal = parseDiagonal(text);
  const partNumber = parsePartNumber(text);
  const generation = parseGeneration(text);
  const model = parseModel(text, brand);

  const base: Omit<TagConfig, 'tokens'> = {
    raw,
    supplierId,
    supplierName: supplierName(supplierId),
    brand,
    model,
    chip,
    generation,
    ram,
    rom,
    storageRaw,
    colorRu: color.ru,
    colorEn: color.en,
    country,
    countrySource: source,
    type,
    typeExplicit: explicit,
    connectivity,
    nfc,
    diagonal,
    partNumber,
    isSectionHeader: header,
  };
  return { ...base, tokens: buildTokens(base) };
}

/** Серия/поколение: S24/S26 Ultra, Watch 5, Series 8, Note 14, Pad 6. */
function parseGeneration(text: string): string | null {
  const m =
    text.match(/\b(S\d{2}(?:\s?(?:Ultra|Plus|FE))?)\b/iu) || // Samsung S24 Ultra
    text.match(/\b(Series\s?\d{1,2})\b/iu) || // Apple Watch Series 8
    text.match(/\b(Watch\s?\d{1,2})\b/iu) || // Galaxy Watch 5
    text.match(/\b(Note\s?\d{1,2})\b/iu) ||
    text.match(/\b(Pad\s?\d{1,2})\b/iu);
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

/** Грубая нормализация модели: убрать бренд-слова, страну-флаги, цену. Для поиска и отчёта. */
function parseModel(text: string, brand: string | null): string | null {
  let t = text;
  // убрать флаги
  for (const f of extractFlags(t)) t = t.split(f).join(' ');
  // убрать «Apple iPhone» / лидирующий бренд (по правилам названия бренд в карточке не пишется)
  t = t.replace(/\bApple\b/giu, ' ').replace(/\biPhone\b/giu, ' ');
  if (brand && brand !== 'Apple') {
    // прочие бренды оставляем в модели для читаемости отчёта, но чистим дубли пробелов
  }
  // убрать тип-описания в кавычках/скобках «планшет», «смартфон», «ноутбук» и единицы
  t = t.replace(/\b(планшет|смартфон|ноутбук|умные?\s+часы|колонка|наушники|фитнес-браслет)\b/giu, ' ');
  t = t.replace(/[«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

// ── утилиты ──────────────────────────────────────────────────────────────────
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
import { COLOR_SYNONYMS } from '../knowledge/colors.js';
function canonicalColorsAll(): string[] {
  return Object.keys(COLOR_SYNONYMS);
}
// re-export для удобства тестов/других модулей
export { canonicalColor };

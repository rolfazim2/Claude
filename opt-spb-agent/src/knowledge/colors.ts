// Соответствие цветов рус↔англ. При поиске и верификации пробуем оба варианта
// (рулбук 5.1, 6.3). Цвет — значимый параметр SKU: Denim ≠ Синий, Ocean ≠ Blue.

/** Каноническое русское имя цвета → набор синонимов (рус и англ, нижний регистр). */
export const COLOR_SYNONYMS: Record<string, string[]> = {
  'Чёрный': ['черный', 'чёрный', 'black', 'space black', 'midnight'],
  'Белый': ['белый', 'white', 'starlight'],
  'Серый': ['серый', 'gray', 'grey', 'space gray', 'space grey', 'серый космос', 'графит', 'graphite'],
  'Серебристый': ['серебристый', 'серебро', 'silver'],
  'Золотой': ['золотой', 'золото', 'gold'],
  'Розовое золото': ['розовое золото', 'pink gold', 'rose gold'],
  'Розовый': ['розовый', 'pink'],
  'Синий': ['синий', 'голубой', 'blue', 'sierra blue', 'sapphire'],
  'Зелёный': ['зеленый', 'зелёный', 'green', 'lime green', 'lime', 'alpine green'],
  'Красный': ['красный', 'red', 'product red'],
  'Фиолетовый': ['фиолетовый', 'purple', 'deep purple'],
  'Жёлтый': ['желтый', 'жёлтый', 'yellow'],
  'Оранжевый': ['оранжевый', 'orange'],
  'Титановый': ['титановый', 'titanium', 'natural titanium', 'natural'],
  'Бежевый': ['бежевый', 'beige', 'desert', 'desert titanium'],
  'Denim': ['denim'],
  'Ocean': ['ocean'],
  'Charcoal': ['charcoal', 'угольный'],
};

/** По любому синониму вернуть каноническое русское имя цвета (или null). */
export function canonicalColor(token: string): string | null {
  const t = token.trim().toLowerCase();
  for (const [canon, syns] of Object.entries(COLOR_SYNONYMS)) {
    if (syns.includes(t)) return canon;
  }
  return null;
}

/** Все синонимы цвета по канону (для поиска по обоим языкам). */
export function colorSynonyms(canon: string | null): string[] {
  if (!canon) return [];
  return COLOR_SYNONYMS[canon] ?? [canon.toLowerCase()];
}

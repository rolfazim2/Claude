// Известные ID фильтров / категорий / производителей опт-сайта.
// Источник: «База проекта opt-spb.ru» (разделы 5.5, 7, 8) и отчёт 28.05.2026.
// Это СПРАВОЧНИК-кэш. Если нужного значения нет — агент ищет его у аналога на сайте
// (browser/create.ts → resolveCategoryAndFilters) и НЕ подставляет «ближайшее по смыслу».

/** Группы фильтров (filter_group_id). */
export const FILTER_GROUPS = {
  romMemory: 1, // Объём памяти (ROM)
  ram: 7, // Оперативная память (RAM)
  country: 46, // Страна
  color: 28, // Цвет
} as const;

/** Объём памяти ROM (ГБ) → filter_id. */
export const ROM_FILTER: Record<number, number> = {
  256: 2,
  512: 127,
};

/** Оперативная память RAM (ГБ) → filter_id. */
export const RAM_FILTER: Record<number, number> = {
  12: 160,
};

/** Цвет (нормализованное русское имя) → filter_id. */
export const COLOR_FILTER: Record<string, number> = {
  Чёрный: 143,
  'Розовое золото': 216,
  Denim: 409,
};

/** Страна (нормализованное имя) → filter_id. */
export const COUNTRY_FILTER: Record<string, number> = {
  Европа: 341,
  Индонезия: 384,
};

/** Якоря категорий по моделям (main_category_id). */
export const CATEGORY_ANCHORS: Record<string, number> = {
  'Samsung S26': 2296,
  'Samsung S24 Ultra': 1564,
  'Sennheiser Momentum 4': 1421,
};

/** Производители (manufacturer_id). */
export const MANUFACTURERS: Record<string, number> = {
  Samsung: 17,
  Sennheiser: 72,
};

// Общие типы агента.

export type ProductType =
  | 'new' // Новый — слово «Новый» в название НЕ добавляется
  | 'refurbished' // Восстановленный
  | 'asis-active' // Обменка (актив)
  | 'asis-inactive' // Обменка (не актив)
  | 'used' // Б/У
  | 'asis-nobox'; // Обменка (без коробки)

/** Человекочитаемая подпись типа для названия карточки (рулбук 6.2/6.3). */
export const TYPE_LABEL: Record<ProductType, string> = {
  new: '', // не добавляется
  refurbished: '(Восстановленный)',
  'asis-active': '(Обменка актив)',
  'asis-inactive': '(Обменка не актив)',
  used: '(Б/У)',
  'asis-nobox': '(Обменка без коробки)',
};

/** Распарсенная конфигурация тега поставщика. */
export interface TagConfig {
  raw: string; // дословный текст тега из админки
  supplierId: number | null;
  supplierName: string | null;

  brand: string | null; // Apple / Samsung / Xiaomi / ...
  model: string | null; // нормализованная модель без бренда: «16 Pro Max», «S26 Ultra»
  chip: string | null; // M1..M5, A17 Pro и т.п.
  generation: string | null; // S24, Series 8, Watch 5 — серия/поколение

  ram: number | null; // ГБ
  rom: number | null; // ГБ (1TB → 1024)
  storageRaw: string | null; // как в теге: «8/256», «1TB», «256»

  colorRu: string | null; // каноническое русское имя цвета
  colorEn: string | null; // англоязычный вариант (для поиска)

  country: string | null; // каноническое имя страны/региона или null (нет страны)
  countrySource: 'flag' | 'word' | null;

  type: ProductType;
  typeExplicit: boolean; // тип явно в теге (true) либо взят по дефолту поставщика (false)

  connectivity: string | null; // Wi-Fi | LTE | Cellular | 4G | 5G
  nfc: boolean | null; // true/false если явно, иначе null
  diagonal: string | null; // «6.67», «11»
  partNumber: string | null; // MK183RU/A, MDH74, KI1501PA

  tokens: string[]; // значимые токены для строгой 1:1 верификации
  isSectionHeader: boolean; // «iPad Air M4 ()», «Игры Релиз:» — это не товар
}

export interface ProductCandidate {
  id: number;
  name: string;
}

export interface BindDecision {
  action: 'bind';
  productId: number;
  productName: string;
  confidence: number;
  reason: string;
}
export interface CreateDecision {
  action: 'create';
  title: string;
  type: ProductType;
  confidence: number;
  reason: string;
  imageQuery: string; // что искать в качестве картинки (модель+цвет+версия)
}
export interface ReviewDecision {
  action: 'review';
  confidence: number;
  reason: string;
  recommendation: string;
  candidates: ProductCandidate[];
}
export interface SkipDecision {
  action: 'skip';
  reason: string; // секционный заголовок / пустая конфигурация
}

export type Decision = BindDecision | CreateDecision | ReviewDecision | SkipDecision;

/** Результат обработки одного тега — строка отчёта. */
export interface TagOutcome {
  tag: string;
  supplier: string | null;
  decision: Decision['action'];
  detail: string;
  confidence?: number;
  productId?: number;
  verified?: boolean; // для bind: строка ушла из очереди после reload
}

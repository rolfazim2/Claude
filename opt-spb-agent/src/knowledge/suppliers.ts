// Идентификаторы поставщиков (data-supplier на строках тегов) и их тип по умолчанию.
// Источник: «База проекта opt-spb.ru», раздел 4 и 6.2.
import type { ProductType } from '../types.js';

export interface Supplier {
  id: number;
  name: string;
  /** Тип товара по умолчанию для поставщика, если в самом теге тип не указан явно. */
  defaultType: ProductType | 'by-tag';
}

export const SUPPLIERS: Record<number, Supplier> = {
  2: { id: 2, name: '1-Опт', defaultType: 'refurbished' }, // вся линейка iPhone 7–16 — восстановленные
  3: { id: 3, name: 'Amt-opt', defaultType: 'by-tag' },
  5: { id: 5, name: 'Sold-out', defaultType: 'new' }, // вся линейка — новые
  7: { id: 7, name: 'Boroda-Samsung', defaultType: 'by-tag' },
  9: { id: 9, name: 'KATALOG OPT', defaultType: 'by-tag' },
  13: { id: 13, name: 'Yard opt', defaultType: 'by-tag' },
  16: { id: 16, name: 'TOP PRICE', defaultType: 'by-tag' },
  18: { id: 18, name: 'Поставщик 18', defaultType: 'by-tag' }, // формат «• A37 8/128 Charcoal», требует policy
  19: { id: 19, name: 'PriceSpb', defaultType: 'by-tag' },
  22: { id: 22, name: 'Поставщик 22', defaultType: 'by-tag' },
  24: { id: 24, name: 'ReFresh Обменки', defaultType: 'asis-active' }, // обменка, актив/не актив по тегу
  27: { id: 27, name: 'IPRO opt', defaultType: 'by-tag' },
  28: { id: 28, name: 'Поставщик 28', defaultType: 'by-tag' },
};

export function supplierName(id: number | null): string | null {
  if (id == null) return null;
  return SUPPLIERS[id]?.name ?? `Поставщик ${id}`;
}

export function supplierDefaultType(id: number | null): ProductType | 'by-tag' {
  if (id == null) return 'by-tag';
  return SUPPLIERS[id]?.defaultType ?? 'by-tag';
}

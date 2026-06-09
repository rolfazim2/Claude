// Детерминированный конструктор названия карточки по правилам 6.3.
// Название строится из самого тега (он близок к паттерну сайта), очищенного от мусора:
// буллеты/эмодзи/флаги, бренд-слова Apple/iPhone, слова-маркеры типа, цена.
// Страна добавляется каноническим словом (если была флагом), тип — подписью в скобках
// (кроме «Новый»). Это точнее и дешевле LLM-генерации: ноль токенов, ноль фантазий.

import type { TagConfig } from '../types.js';
import { TYPE_LABEL } from '../types.js';

/** Слова-маркеры типа, которые не должны попадать в название (тип идёт подписью в скобках). */
const TYPE_WORDS = /(?:^|[\s,])(восстановленн\w*|реф|ref|cpo|refurbished|актив\w*|распак\w*|asis|асис|б\/у|обменк\w*|новый)(?=$|[\s,.)])/giu;

/** Цена: «12 500 ₽», «12500 руб», «$999» — никогда не часть названия. */
const PRICE = /(?:[\d\s]{2,}(?:₽|руб\.?|р\.)|\$\s?\d[\d\s]*)/giu;

/** Эмодзи/буллеты/декор (флаги уже вырезаны парсером из model). */
const DECOR = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}•·▪◦※*]+/gu;

export function buildTitle(tag: TagConfig): string {
  let t = tag.model ?? tag.raw;

  t = t.replace(DECOR, ' ');
  t = t.replace(PRICE, ' ');
  t = t.replace(TYPE_WORDS, ' ');
  // мусорная пунктуация по краям и дубли пробелов/запятых
  t = t.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-–—.:;\s]+|[-–—,:;\s]+$/g, '');

  // Страна: если распознана по ФЛАГУ — слова в тексте нет, добавляем канон.
  // Если по слову — оно уже в названии, не дублируем.
  if (tag.country && tag.countrySource === 'flag' && !containsWord(t, tag.country)) {
    t = `${t} ${tag.country}`;
  }

  // Тип в скобках для всех, кроме «Новый» (слово «Новый» не пишется никогда).
  const label = TYPE_LABEL[tag.type];
  if (label && !t.toLowerCase().includes(label.toLowerCase())) {
    t = `${t} ${label}`;
  }

  return t.replace(/\s+/g, ' ').trim();
}

function containsWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-zа-яё0-9])${esc}(?:$|[^a-zа-яё0-9])`, 'iu').test(text);
}

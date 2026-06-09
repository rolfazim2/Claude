// Локальное файловое хранилище для вложений (uploads/). Имена — случайные,
// оригинальное имя сохраняется в Attachment.value после "|" для отображения.
// Для нескольких инстансов API заменяется на S3-совместимое хранилище.
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ

const SAFE_EXT = /^\.[a-z0-9]{1,8}$/i;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function isImage(name: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extname(name).toLowerCase());
}

/** Сохраняет поток в uploads/, возвращает имя сохранённого файла. */
export async function saveStream(filename: string, stream: NodeJS.ReadableStream): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  let ext = extname(filename).toLowerCase();
  if (!SAFE_EXT.test(ext)) ext = '.bin';
  const stored = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${ext}`;
  await pipeline(stream, createWriteStream(join(UPLOAD_DIR, stored)));
  return stored;
}

export async function fileResponse(stored: string): Promise<{ stream: NodeJS.ReadableStream; type: string; size: number } | null> {
  // Защита от выхода из каталога.
  if (!/^[a-z0-9.-]+$/i.test(stored) || stored.includes('..')) return null;
  const path = join(UPLOAD_DIR, stored);
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    const type = MIME[extname(stored).toLowerCase()] ?? 'application/octet-stream';
    return { stream: createReadStream(path), type, size: s.size };
  } catch {
    return null;
  }
}

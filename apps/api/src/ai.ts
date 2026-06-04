// Генерация описания задачи. Если задан ключ ChatPRD/Anthropic — используем его;
// иначе возвращаем разумный структурированный черновик (работает без ключа).
// Подключение реального ChatPRD — Этап B (нужен ключ API/MCP, см. DESIGN.md §8a).

interface DescribeInput {
  title: string;
  projectName?: string;
  functionName?: string;
}

export async function generateDescription(input: DescribeInput): Promise<string> {
  const key = process.env.CHATPRD_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      return await callLLM(input, key);
    } catch (e) {
      console.error('AI provider error, fallback to template', e);
    }
  }
  return template(input);
}

function template({ title, projectName, functionName }: DescribeInput): string {
  const ctx = [
    functionName ? `Функция: ${functionName}.` : '',
    projectName ? `Проект/процесс: ${projectName}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    `Задача: ${title}.`,
    ctx,
    '',
    'Цель: кратко опишите ожидаемый результат.',
    '',
    'Что сделать:',
    '— шаг 1;',
    '— шаг 2;',
    '— шаг 3.',
    '',
    'Критерий готовности: задача считается выполненной, когда результат проверен и приложено доказательство.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

// --- Чат-ассистент ---
interface ChatTask {
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
}

export async function chatAnswer(question: string, tasks: ChatTask[]): Promise<string> {
  const key = process.env.CHATPRD_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      return await chatLLM(question, tasks, key);
    } catch (e) {
      console.error('chat LLM error, fallback', e);
    }
  }
  return chatFallback(question, tasks);
}

function isOverdue(t: ChatTask): boolean {
  return !!t.dueAt && new Date(t.dueAt).getTime() < Date.now() && t.status !== 'done' && t.status !== 'canceled';
}
function isToday(t: ChatTask): boolean {
  if (!t.dueAt) return false;
  const d = new Date(t.dueAt), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function chatFallback(question: string, tasks: ChatTask[]): string {
  const q = question.toLowerCase();
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'canceled');
  const overdue = tasks.filter(isOverdue);
  const today = active.filter(isToday);
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  const list = (arr: ChatTask[]) => (arr.length ? arr.map((t) => `• ${t.title}`).join('\n') : '— нет');

  if (q.includes('просроч')) return `Просроченные задачи (${overdue.length}):\n${list(overdue)}`;
  if (q.includes('сегодня')) return `Задачи на сегодня (${today.length}):\n${list(today)}`;
  if (q.includes('в работе') || q.includes('в процессе')) return `В работе (${inProgress.length}):\n${list(inProgress)}`;
  if (q.includes('сколько') || q.includes('статус')) {
    return `Всего активных: ${active.length}. В работе: ${inProgress.length}. Просрочено: ${overdue.length}. На сегодня: ${today.length}.`;
  }
  return [
    `Сводка по вашим задачам:`,
    `— активных: ${active.length}`,
    `— в работе: ${inProgress.length}`,
    `— на сегодня: ${today.length}`,
    `— просрочено: ${overdue.length}`,
    '',
    overdue.length ? `Сначала разберитесь с просроченными:\n${list(overdue.slice(0, 5))}` : 'Просроченных нет — отлично!',
    '',
    '(Подсказка: подключите ключ ИИ, чтобы я отвечал свободно по любым вопросам.)',
  ].join('\n');
}

async function chatLLM(question: string, tasks: ChatTask[], key: string): Promise<string> {
  const ctx = tasks
    .map((t) => `- ${t.title} [${t.status}, приоритет ${t.priority}${t.dueAt ? `, срок ${t.dueAt}` : ''}]`)
    .join('\n');
  const system = `Ты ассистент в корпоративном таск-менеджере. Отвечай кратко на русском. Текущая дата: ${new Date().toISOString()}. Задачи пользователя:\n${ctx}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: question }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data: any = await res.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

// Подключение к Anthropic (если задан ANTHROPIC_API_KEY). ChatPRD — по аналогии,
// когда будет доступ к API/ключ.
async function callLLM(input: DescribeInput, key: string): Promise<string> {
  const prompt = `Ты помощник проджект-менеджера. Напиши на русском чёткое описание задачи с разделами «Цель», «Что сделать» (списком) и «Критерий готовности». Контекст: задача «${input.title}»${input.functionName ? `, функция «${input.functionName}»` : ''}${input.projectName ? `, проект «${input.projectName}»` : ''}. Только текст описания, без преамбулы.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data: any = await res.json();
  return data.content?.[0]?.text?.trim() ?? '';
}

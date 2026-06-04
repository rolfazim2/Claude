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

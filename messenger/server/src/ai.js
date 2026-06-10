'use strict';

// Интеграция с Claude API: мозг встроенного бота @gram_ai.
// Ключ берётся из ANTHROPIC_API_KEY; без ключа бот отвечает инструкцией по настройке.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.GRAM_AI_MODEL || 'claude-opus-4-8';

const SYSTEM_PROMPT = `Ты — Gram AI, ассистент внутри корпоративного мессенджера Gram.
Ты помогаешь сотрудникам: отвечаешь на вопросы, пишешь и правишь тексты,
делаешь выжимки переписки, помогаешь с кодом и планированием задач.
Отвечай на языке собеседника (по умолчанию — русский), по делу и без лишней воды.
Форматирование: обычный текст без Markdown — сообщения отображаются как есть.
Ответ должен помещаться в сообщение мессенджера: до 3500 символов.`;

const NO_KEY_REPLY =
  'Я пока не подключён к Claude API. Администратору нужно запустить сервер ' +
  'с переменной окружения ANTHROPIC_API_KEY (ключ выдаётся на platform.claude.com), ' +
  'после этого я смогу отвечать на вопросы, делать выжимки чатов и помогать с задачами.';

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const isConfigured = () => !!client;

/**
 * history — массив сообщений чата в хронологическом порядке:
 * [{senderName, isBot, text}], последнее — то, на которое отвечаем.
 */
async function reply(history) {
  if (!client) return NO_KEY_REPLY;

  // Сообщения собеседников помечаем именами — в группах участников несколько
  const messages = [];
  for (const m of history) {
    const role = m.isBot ? 'assistant' : 'user';
    const text = m.isBot ? m.text : `${m.senderName}: ${m.text}`;
    // API допускает подряд идущие сообщения одной роли — склеиваем для компактности
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += '\n' + text;
    else messages.push({ role, content: text });
  }
  if (!messages.length || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: '(начало диалога)' });
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  const response = await stream.finalMessage();

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || 'Не получилось сформулировать ответ, попробуйте переформулировать вопрос.';
}

module.exports = { reply, isConfigured, MODEL };

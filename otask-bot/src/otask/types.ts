/**
 * Нормализованное представление задачи otask внутри бота.
 *
 * otask отдаёт сырые поля под своими именами; client.ts приводит их к этой
 * форме, поэтому остальной код не зависит от точных имён в ответе API.
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  /** Дедлайн в ISO-формате, если задан. */
  deadline?: string;
  /** Нормализованный приоритет. */
  priority: Priority;
  /** Исходное название статуса из otask. */
  status?: string;
  /** Завершена ли задача (closed/done). Такие задачи не напоминаем и не считаем просрочкой. */
  done: boolean;
  /** Ссылка на карточку задачи в веб-интерфейсе, если её можно построить. */
  url?: string;
}

export type Priority = 'low' | 'normal' | 'high' | 'critical' | 'unknown';

export interface CreateTaskInput {
  title: string;
  description?: string;
  deadline?: string;
  priority?: Priority;
  /** Идентификатор проекта, если задаём задачу в конкретный проект. */
  projectId?: string;
}

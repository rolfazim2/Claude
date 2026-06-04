// Простой real-time хаб: рассылка событий всем подключённым WebSocket-клиентам.
// Веб применяет события и обновляет кэш мгновенно (как в Linear).
import type { WebSocket } from '@fastify/websocket';

const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export type RealtimeEvent =
  | { type: 'task.created'; taskId: string }
  | { type: 'task.updated'; taskId: string }
  | { type: 'notification.created'; userId: string };

export function broadcast(event: RealtimeEvent) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

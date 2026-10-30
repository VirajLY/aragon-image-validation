import type { Response } from 'express';
import { redisSub, redis } from '../lib/redis';

/** Channel name for validation events published via Redis pub/sub. */
const VALIDATION_CHANNEL = 'validation-events';

/** Map of sessionId → Set of active SSE Response objects. */
const clients = new Map<string, Set<Response>>();

/** Whether the Redis subscriber has been initialized. */
let subscriberInitialized = false;

/**
 * SSE event payload structure published via Redis.
 */
export interface SSEEvent {
  sessionId: string;
  event: string;
  data: unknown;
}

/**
 * Initializes the Redis subscriber for validation events.
 * Messages received on the channel are forwarded to connected SSE clients.
 */
export function initSSESubscriber(): void {
  if (subscriberInitialized) return;
  subscriberInitialized = true;

  redisSub.subscribe(VALIDATION_CHANNEL, (err) => {
    if (err) {
      console.error('❌ Failed to subscribe to validation-events:', err.message);
    } else {
      console.log('✅ Subscribed to Redis channel: validation-events');
    }
  });

  redisSub.on('message', (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message) as SSEEvent;
      broadcastToClients(parsed.sessionId, parsed.event, parsed.data);
    } catch (err) {
      console.error('Failed to parse SSE message from Redis:', err);
    }
  });
}

/**
 * Registers a new SSE client for a given session.
 * Sets the appropriate headers and sends an initial connection event.
 *
 * @param sessionId - The upload session ID
 * @param res - The Express response object to use as an SSE stream
 */
export function addClient(sessionId: string, res: Response): void {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  // Register client
  if (!clients.has(sessionId)) {
    clients.set(sessionId, new Set());
  }
  clients.get(sessionId)!.add(res);

  // Clean up on disconnect
  res.on('close', () => {
    removeClient(sessionId, res);
  });
}

/**
 * Removes an SSE client from the active connections.
 *
 * @param sessionId - The upload session ID
 * @param res - The Express response object to remove
 */
export function removeClient(sessionId: string, res: Response): void {
  const sessionClients = clients.get(sessionId);
  if (sessionClients) {
    sessionClients.delete(res);
    if (sessionClients.size === 0) {
      clients.delete(sessionId);
    }
  }
}

/**
 * Sends an SSE event to all connected clients for a given session.
 *
 * @param sessionId - The upload session ID
 * @param event - The event name
 * @param data - The event payload
 */
function broadcastToClients(sessionId: string, event: string, data: unknown): void {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients || sessionClients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of sessionClients) {
    client.write(payload);
  }
}

/**
 * Publishes an SSE event via Redis pub/sub so that all server instances
 * (including workers) can broadcast to connected clients.
 *
 * @param sessionId - The upload session ID
 * @param event - The event name
 * @param data - The event payload
 */
export async function publishEvent(
  sessionId: string,
  event: string,
  data: unknown
): Promise<void> {
  const message: SSEEvent = { sessionId, event, data };
  try {
    if (redis.status === 'ready') {
      await redis.publish(VALIDATION_CHANNEL, JSON.stringify(message));
      return;
    }
  } catch (err) {
    // Redis not ready or failed, fallback to local broadcast
  }
  broadcastToClients(sessionId, event, data);
}

/**
 * WebSocketService
 * 
 * Manages WebSocket connection to the cloud server.
 * Features:
 * - Exponential backoff reconnection
 * - Heartbeat ping/pong
 * - Message sequencing
 * - Binary (audio PCM) and JSON (control) multiplexing
 */

import type { ClientMessage, ServerMessage } from '../types/protocol';

type MessageHandler = (msg: ServerMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

interface WebSocketServiceOptions {
  url: string;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly maxReconnectAttempts: number;
  private readonly heartbeatIntervalMs: number;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private isIntentionallyClosed = false;

  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();

  constructor(options: WebSocketServiceOptions) {
    this.url = options.url;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get nextSeq(): number {
    return ++this.seq;
  }

  // ── Event registration ──────────────────────────────────

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  // ── Connection lifecycle ────────────────────────────────

  connect(): void {
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.createSocket();
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  // ── Send methods ────────────────────────────────────────

  /** Send a JSON control message */
  sendJSON(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send — not connected');
      return false;
    }
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Send binary audio data (raw PCM Int16 LE) */
  sendBinary(buffer: ArrayBuffer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(buffer);
    return true;
  }

  // ── Internal ────────────────────────────────────────────

  private createSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.notifyConnection(true);
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as ServerMessage;
            this.notifyMessage(msg);
          } catch (e) {
            console.error('[WS] Failed to parse message', e);
          }
        }
        // Binary messages from server (e.g., TTS audio) handled elsewhere
      };

      this.ws.onerror = (event) => {
        console.error('[WS] Error', event);
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Closed: ${event.code} ${event.reason}`);
        this.stopHeartbeat();
        this.notifyConnection(false);

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('[WS] Failed to create socket', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.createSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendJSON({ type: 'ping', timestamp: Date.now() } as ClientMessage);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private notifyMessage(msg: ServerMessage): void {
    for (const handler of this.messageHandlers) {
      try { handler(msg); } catch { /* ignore */ }
    }
  }

  private notifyConnection(connected: boolean): void {
    for (const handler of this.connectionHandlers) {
      try { handler(connected); } catch { /* ignore */ }
    }
  }
}

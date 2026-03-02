/**
 * DevToolsProxy — Maintains WebSocket connection to ws://localhost:8001/devtools/ws
 * and forwards received events to the WebView panel via postMessage.
 *
 * Reconnects automatically every 3 seconds on disconnect.
 */
import * as WebSocket from 'ws';

type EventCallback = (event: Record<string, unknown>) => void;

export class DevToolsProxy {
  private readonly url: string;
  private readonly onEvent: EventCallback;
  private ws: WebSocket.WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(url: string, onEvent: EventCallback) {
    this.url = url;
    this.onEvent = onEvent;
  }

  connect(): void {
    if (this.disposed) return;
    this._clearReconnectTimer();
    this._doConnect();
  }

  reconnect(): void {
    this._closeWs();
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    this._clearReconnectTimer();
    this._closeWs();
  }

  private _doConnect(): void {
    if (this.disposed) return;
    console.log(`[DevToolsProxy] Connecting to ${this.url}`);

    try {
      this.ws = new WebSocket.WebSocket(this.url);
    } catch (err) {
      console.error('[DevToolsProxy] Failed to create WebSocket:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[DevToolsProxy] Connected');
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        this.onEvent(event);
      } catch (err) {
        console.warn('[DevToolsProxy] Failed to parse event:', err);
      }
    });

    this.ws.on('close', () => {
      console.log('[DevToolsProxy] Disconnected — will retry in 3s');
      this.onEvent({
        type: 'devtools_disconnected',
        timestamp: Date.now() / 1000,
        session_id: '',
        payload: {},
      });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.warn('[DevToolsProxy] WS error:', err.message);
      // 'close' event fires afterward, handling reconnect
    });
  }

  private _scheduleReconnect(): void {
    if (this.disposed) return;
    this._clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this._doConnect();
    }, 3000);
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _closeWs(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }
}

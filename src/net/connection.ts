/**
 * WebSocket client for the Phase 6 deathmatch server. Starts disconnected;
 * call connect() to open a binary WebSocket, receive the Welcome message,
 * and begin the tick loop.
 *
 * See docs/netcode.md §3 for the transport handshake sequence.
 */

import { decodeWelcome, type Welcome } from './protocol';

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; welcome: Welcome }
  | { status: 'error'; reason: string };

export interface Connection {
  readonly state: ConnectionState;
  /** Begin the connection to `wsUrl`. Non-blocking. */
  connect(wsUrl: string): void;
  /** Graceful close. */
  close(): void;
}

export function createConnection(): Connection {
  let ws: WebSocket | null = null;
  let state: ConnectionState = { status: 'disconnected' };

  const conn: Connection = {
    get state() {
      return state;
    },
    connect(wsUrl: string): void {
      if (ws) {
        ws.close();
      }
      state = { status: 'connecting' };
      try {
        ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
      } catch (e) {
        state = { status: 'error', reason: `WebSocket constructor failed: ${String(e)}` };
        return;
      }

      ws.onopen = () => {
        // Wait for Welcome — the server sends it immediately on connect.
      };

      ws.onmessage = (e: MessageEvent) => {
        if (!(e.data instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(e.data);
        const welcome = decodeWelcome(bytes);
        if (welcome) {
          state = { status: 'connected', welcome };
        }
      };

      ws.onclose = () => {
        if (state.status !== 'error') {
          state = { status: 'disconnected' };
        }
        ws = null;
      };

      ws.onerror = () => {
        if (state.status === 'connecting') {
          state = { status: 'error', reason: 'WebSocket error during connect' };
        }
      };
    },
    close(): void {
      ws?.close();
    },
  };

  return conn;
}

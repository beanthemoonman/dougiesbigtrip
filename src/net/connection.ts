/**
 * WebSocket client for the Phase 6 deathmatch server. Starts disconnected;
 * call connect() to open a binary WebSocket, receive the Welcome message,
 * and begin the tick loop.
 *
 * See docs/netcode.md §3 for the transport handshake sequence.
 */

import { decodeBye, decodeSnapshot, decodeWelcome, type Snapshot, type Welcome } from './protocol';

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; welcome: Welcome }
  | { status: 'byed'; reason: string }
  | { status: 'error'; reason: string };

export interface Connection {
  readonly state: ConnectionState;
  /** Begin the connection to `wsUrl`. Non-blocking. */
  connect(wsUrl: string): void;
  /** Send a binary frame (e.g. an encoded CommandFrame). No-op if not open. */
  send(bytes: Uint8Array): void;
  /** Called once when the Welcome arrives. */
  onWelcome?: (w: Welcome) => void;
  /** Called for every Snapshot received. */
  onSnapshot?: (s: Snapshot) => void;
  /** Called when the server sends a Bye (kicked/full). */
  onBye?: (reason: string) => void;
  /** Called when the socket closes or errors out (failed connect or drop). */
  onClose?: () => void;
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
    send(bytes: Uint8Array): void {
      // `as BufferSource`: TS 5.7's generic Uint8Array<ArrayBufferLike> doesn't
      // unify with send()'s ArrayBufferView<ArrayBuffer>, but a byte view is a
      // valid BufferSource at runtime.
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(bytes as BufferSource);
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
        const bye = decodeBye(bytes);
        if (bye) {
          state = { status: 'byed', reason: bye.reason };
          conn.onBye?.(bye.reason);
          ws?.close();
          return;
        }
        const welcome = decodeWelcome(bytes);
        if (welcome) {
          state = { status: 'connected', welcome };
          conn.onWelcome?.(welcome);
          return;
        }
        const snap = decodeSnapshot(bytes);
        if (snap) conn.onSnapshot?.(snap);
      };

      ws.onclose = () => {
        if (state.status !== 'error') {
          state = { status: 'disconnected' };
        }
        ws = null;
        conn.onClose?.();
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

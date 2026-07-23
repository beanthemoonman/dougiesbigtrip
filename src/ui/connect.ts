/**
 * Connect overlay — a plain-DOM text input + Connect button shown before the
 * client joins a server. Mirrors the server's default bind address and the
 * `?connect=…` URL parameter. See docs/connect-and-scoreboard.md §1.
 *
 * Mounted on load when the client is in networked mode; hidden once connected.
 *
 * Default server address is sourced from `src/core/settings.ts` — a single
 * source of truth across the connect overlay and the in-game settings panel.
 */

import { DEFAULT_WS_URL } from '../core/settings';

export interface ConnectOverlay {
  readonly el: HTMLElement;
  url(): string;
  /** Poll this in the render loop — returns status text, or '' when connected. */
  statusText(): string;
  setConnected(connected: boolean): void;
  setError(reason: string): void;
}

export function createConnectOverlay(
  onConnect: (url: string) => void,
  defaultUrl: string = DEFAULT_WS_URL,
): ConnectOverlay {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);color:#ccc;font:14px monospace;z-index:1000;';

  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:320px;';

  const label = document.createElement('div');
  label.textContent = 'Server URL:';
  label.style.color = '#888';

  const input = document.createElement('input');
  input.value = defaultUrl;
  input.style.cssText =
    'padding:6px 8px;background:#1a1a1a;color:#eee;border:1px solid #444;font:14px monospace;';

  const btn = document.createElement('button');
  btn.textContent = 'Connect';
  btn.style.cssText =
    'padding:6px 12px;background:#2a5a2a;color:#eee;border:none;cursor:pointer;font:14px monospace;';

  const status = document.createElement('div');
  status.style.cssText = 'color:#888;font-size:12px;min-height:16px;';

  btn.onclick = (): void => {
    const url = input.value.trim();
    if (!url) return;
    status.textContent = 'connecting…';
    status.style.color = '#888';
    onConnect(url);
  };
  input.onkeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') btn.click();
  };

  box.appendChild(label);
  box.appendChild(input);
  box.appendChild(btn);
  box.appendChild(status);
  el.appendChild(box);

  return {
    el,
    url: () => input.value.trim(),
    statusText: () => status.textContent ?? '',
    setConnected(connected: boolean): void {
      el.style.display = connected ? 'none' : 'flex';
      if (connected) status.textContent = '';
    },
    setError(reason: string): void {
      status.textContent = reason;
      status.style.color = '#c44';
    },
  };
}

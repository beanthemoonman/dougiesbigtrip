/**
 * Player settings — the single config object the game reads for its three
 * user-facing knobs: mouse sensitivity, world FOV, master volume.
 *
 * No localStorage/sessionStorage: CLAUDE.md says this may be embedded, so don't
 * assume web storage exists. The `Settings` object itself is the "config object"
 * the plan asks these to persist to; a host that wants durability can serialise
 * it however it likes. A caller wires `onChange` to push each value into
 * input / renderer / audio.
 */

export interface Settings {
  /** Mouse look, radians per pixel. */
  sensitivity: number;
  /** World (not viewmodel) horizontal FOV, degrees. */
  worldFovDeg: number;
  /** Master volume, 0..1. */
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 0.0022,
  worldFovDeg: 90,
  volume: 1,
};

export const DEFAULT_SERVER_ADDRESS = '127.0.0.1';
export const DEFAULT_SERVER_PORT = '9876';

export type ConnectState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerConnectionOpts {
  defaultAddress?: string;
  defaultPort?: string;
  onConnect(url: string): void;
  onDisconnect(): void;
}

interface Field {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Value → readout text. */
  fmt: (v: number) => string;
}

// Ranges: sensitivity spans a slow-to-twitchy spread; FOV covers CS's usual
// 70–110 band; volume is 0..1. The native <input type=range> clamps to these
// for us — no hand-rolled validation needed.
const FIELDS: Field[] = [
  { key: 'sensitivity', label: 'Sensitivity', min: 0.0005, max: 0.006, step: 0.0001, fmt: (v) => v.toFixed(4) },
  { key: 'worldFovDeg', label: 'FOV', min: 70, max: 110, step: 1, fmt: (v) => `${v.toFixed(0)}°` },
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
];

export interface SettingsPanel {
  show(): void;
  hide(): void;
  setConnected(state: ConnectState, address?: string): void;
}

/**
 * A DOM overlay with one range slider per setting. Mutates `settings` in place
 * and calls `onChange(settings)` on every slider move so the game applies the
 * value live. Shown while not in pointer lock (the "menu" state), hidden in play.
 */
export function createSettingsPanel(
  settings: Settings,
  onChange: (s: Settings) => void,
  serverOpts?: ServerConnectionOpts,
): SettingsPanel {
  // wss:// from an https page, ws:// otherwise — a browser blocks ws:// from a
  // secure page as mixed content, so the scheme must follow the page.
  const wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';

  // Build the WebSocket URL from the address/port fields. Supports three forms:
  //   - full URL typed         → "wss://host/ws"      (used verbatim)
  //   - bare host with a path  → "host/ws"            (scheme prefixed, no port)
  //   - bare host              → "127.0.0.1" + "9876" → "ws://127.0.0.1:9876"
  // The path forms let clients reach a TLS reverse-proxy endpoint like
  // wss://counterdouggo.yikersis.land/ws where the port is 443 and implicit.
  const buildWsUrl = (addr: string, port: string): string => {
    if (/^wss?:\/\//.test(addr)) return addr;
    if (addr.includes('/')) return `${wsScheme}//${addr}`;
    return `${wsScheme}//${addr}:${port}`;
  };
  // Port only matters for the bare-host form.
  const needsPort = (addr: string): boolean => !/^wss?:\/\//.test(addr) && !addr.includes('/');

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(20,24,28,0.92);color:#dfe6ee;font:14px/1.6 monospace;' +
    'padding:20px 24px;border:1px solid #3a4450;border-radius:6px;min-width:260px;' +
    'display:none;z-index:10;user-select:none';

  const title = document.createElement('div');
  title.textContent = 'Settings';
  title.style.cssText = 'font-size:16px;margin-bottom:12px;letter-spacing:1px';
  panel.appendChild(title);

  for (const f of FIELDS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin:6px 0';

    const name = document.createElement('span');
    name.textContent = f.label;
    name.style.cssText = 'flex:0 0 90px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(f.min);
    slider.max = String(f.max);
    slider.step = String(f.step);
    slider.value = String(settings[f.key]);
    slider.style.flex = '1';

    const readout = document.createElement('span');
    readout.textContent = f.fmt(settings[f.key]);
    readout.style.cssText = 'flex:0 0 48px;text-align:right';

    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      settings[f.key] = v;
      readout.textContent = f.fmt(v);
      onChange(settings);
    });

    row.append(name, slider, readout);
    panel.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.textContent = 'click to play · Esc for settings';
  hint.style.cssText = 'margin-top:12px;opacity:0.6;font-size:12px';
  panel.appendChild(hint);

  let serverSection: HTMLDivElement | null = null;
  let addrInput: HTMLInputElement | null = null;
  let portInput: HTMLInputElement | null = null;
  let connBtn: HTMLButtonElement | null = null;
  let connStatus: HTMLDivElement | null = null;
  let addrReadonly: HTMLDivElement | null = null;

  if (serverOpts) {
    serverSection = document.createElement('div');
    serverSection.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #3a4450';

    const serverLabel = document.createElement('div');
    serverLabel.textContent = 'Server';
    serverLabel.style.cssText = 'font-size:13px;margin-bottom:8px;letter-spacing:1px;opacity:0.8';
    serverSection.appendChild(serverLabel);

    // Row: Address input + Port input + button
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px';

    addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.value = serverOpts.defaultAddress ?? DEFAULT_SERVER_ADDRESS;
    addrInput.placeholder = 'address';
    addrInput.style.cssText =
      'flex:1;min-width:0;padding:4px 6px;background:#1a1a1a;color:#eee;border:1px solid #444;font:12px monospace';

    portInput = document.createElement('input');
    portInput.type = 'text';
    portInput.value = serverOpts.defaultPort ?? DEFAULT_SERVER_PORT;
    portInput.placeholder = 'port';
    portInput.style.cssText =
      'width:52px;padding:4px 6px;background:#1a1a1a;color:#eee;border:1px solid #444;font:12px monospace;text-align:center';

    connBtn = document.createElement('button');
    connBtn.textContent = 'Connect';
    connBtn.style.cssText =
      'padding:4px 10px;background:#2a5a2a;color:#eee;border:none;cursor:pointer;font:12px monospace;white-space:nowrap';

    connStatus = document.createElement('div');
    connStatus.style.cssText = 'margin-top:4px;color:#888;font-size:11px;min-height:14px;display:none';

    // Read-only connected address display (replaces inputs when connected)
    addrReadonly = document.createElement('div');
    addrReadonly.style.cssText = 'flex:1;padding:4px 6px;color:#6a9;font:12px monospace;display:none';

    const connect = (): void => {
      const addr = addrInput!.value.trim();
      const port = portInput!.value.trim();
      if (!addr || (needsPort(addr) && !port)) return;
      serverOpts.onConnect(buildWsUrl(addr, port));
    };

    connBtn.onclick = connect;
    addrInput.onkeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') connect();
    };
    portInput.onkeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') connect();
    };

    row.appendChild(addrInput);
    row.appendChild(portInput);
    row.appendChild(addrReadonly);
    row.appendChild(connBtn);
    serverSection.appendChild(row);
    serverSection.appendChild(connStatus);
    panel.appendChild(serverSection);
  }

  document.body.appendChild(panel);

  return {
    show: () => (panel.style.display = 'block'),
    hide: () => (panel.style.display = 'none'),
    setConnected(state: ConnectState, address?: string): void {
      if (!serverSection) return;
      const isConnected = state === 'connected';
      // Show the read-only address (and hide the inputs) while connecting *and*
      // connected, so the panel reflects the server you're actually talking to
      // as soon as the attempt starts — not only once Welcome decodes.
      const showAddr = isConnected || state === 'connecting';
      if (addrInput) addrInput.style.display = showAddr ? 'none' : '';
      if (portInput) portInput.style.display = showAddr ? 'none' : '';
      if (addrReadonly) {
        if (address) addrReadonly.textContent = address;
        addrReadonly.style.display = showAddr ? '' : 'none';
      }
      if (connBtn) {
        if (isConnected) {
          connBtn.textContent = 'Disconnect';
          connBtn.style.background = '#6a2a2a';
          connBtn.onclick = (): void => { serverOpts?.onDisconnect(); };
        } else {
          connBtn.textContent = 'Connect';
          connBtn.style.background = '#2a5a2a';
          connBtn.onclick = (): void => {
            const addr = addrInput!.value.trim();
            const port = portInput!.value.trim();
            if (!addr || (needsPort(addr) && !port)) return;
            serverOpts?.onConnect(buildWsUrl(addr, port));
          };
        }
      }
      if (connStatus) {
        if (state === 'connecting') {
          connStatus.textContent = 'connecting\u2026';
          connStatus.style.color = '#888';
          connStatus.style.display = '';
        } else if (state === 'error') {
          connStatus.textContent = 'connection failed';
          connStatus.style.color = '#c44';
          connStatus.style.display = '';
        } else {
          connStatus.style.display = 'none';
        }
      }
    },
  };
}

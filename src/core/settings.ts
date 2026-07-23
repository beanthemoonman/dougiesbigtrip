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

// Phase 17.1: when the page is served over HTTPS, default to the same-origin
// proxy endpoint (wss://<host>/ws). On plain HTTP (local dev, bare cargo run),
// keep the direct-connect default that points at the server's game port.
const _isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
export const DEFAULT_SERVER_ADDRESS = _isHttps ? `${location.hostname}/ws` : '127.0.0.1';
export const DEFAULT_SERVER_PORT = _isHttps ? '443' : '9876';

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

export interface GameActions {
  onSpectate?(): void;
  onJoinT?(): void;
  onJoinCt?(): void;
}

export type GamePanelMode = 'playing' | 'spectating' | 'none';

/** Fields exposed in the "New Match" section of the settings panel.
 *  ponytail: placeholder UI, superseded by Phase 19 entry screen. */
export interface MatchConfigFields {
  botCount: number;
  roundsToWin: number;
  botCountMin: number;
  botCountMax: number;
  roundsMin: number;
  roundsMax: number;
  onNewMatch(botCount: number, roundsToWin: number): void;
}

export interface SettingsPanel {
  show(): void;
  hide(): void;
  setConnected(state: ConnectState, address?: string): void;
  setGameMode(mode: GamePanelMode): void;
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
  gameOpts?: GameActions,
  matchConfig?: MatchConfigFields,
): SettingsPanel {
  // wss:// from an https page, ws:// otherwise — a browser blocks ws:// from a
  // secure page as mixed content, so the scheme must follow the page.
  const wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Over TLS a bare host reaches the server through the :443 reverse proxy, not
  // the raw game port — so default the port field to 443 on https.
  const defaultPort = wsScheme === 'wss:' ? '443' : DEFAULT_SERVER_PORT;

  // Build the WebSocket URL from the address/port fields. Supports three forms:
  //   - full URL typed         → "wss://host/ws"      (used verbatim)
  //   - bare host with a path  → "host/ws"            (scheme prefixed, no port)
  //   - bare host              → "127.0.0.1" + "9876" → "ws://127.0.0.1:9876"
  // The path forms let clients reach a TLS reverse-proxy endpoint like
  // wss://counterdouggo.yikersis.land/ws where the port is 443 and implicit.
  // Returns null if an explicit URL uses a non-ws scheme (http:// etc.).
  const buildWsUrl = (addr: string, port: string): string | null => {
    if (/^wss?:\/\//.test(addr)) return addr;
    // Reject explicit non-ws schemes (http://, https://, etc.).
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(addr)) return null;
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
  /** Set when the server section is built; re-bound by setConnected(). */
  let connectFromInputs: (() => void) | null = null;

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
    portInput.value = serverOpts.defaultPort ?? defaultPort;
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
      const url = buildWsUrl(addr, port);
      if (!url) {
        if (connStatus) { connStatus.textContent = 'invalid URL'; connStatus.style.color = '#c44'; connStatus.style.display = ''; }
        return;
      }
      serverOpts.onConnect(url);
    };
    connectFromInputs = connect;

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

  let gameSection: HTMLDivElement | null = null;
  let teamRow: HTMLDivElement | null = null;
  let specBtn: HTMLButtonElement | null = null;
  let joinTBtn: HTMLButtonElement | null = null;
  let joinCtBtn: HTMLButtonElement | null = null;

  if (gameOpts) {
    gameSection = document.createElement('div');
    gameSection.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #3a4450;display:none';

    const gameLabel = document.createElement('div');
    gameLabel.textContent = 'Game';
    gameLabel.style.cssText = 'font-size:13px;margin-bottom:8px;letter-spacing:1px;opacity:0.8';
    gameSection.appendChild(gameLabel);

    teamRow = document.createElement('div');
    teamRow.style.cssText = 'display:flex;gap:6px;display:none';

    const mkBtn = (label: string, bg: string, cb: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        `padding:4px 10px;background:${bg};color:#eee;border:none;cursor:pointer;font:12px monospace;white-space:nowrap`;
      b.onclick = cb;
      return b;
    };

    specBtn = mkBtn('Spectate', '#555', () => gameOpts.onSpectate?.());
    joinTBtn = mkBtn('Join T', '#6a4a2a', () => gameOpts.onJoinT?.());
    joinCtBtn = mkBtn('Join CT', '#2a4a6a', () => gameOpts.onJoinCt?.());

    teamRow.appendChild(specBtn);
    teamRow.appendChild(joinTBtn);
    teamRow.appendChild(joinCtBtn);
    gameSection.appendChild(teamRow);
    panel.appendChild(gameSection);
  }

  let configSection: HTMLDivElement | null = null;
  if (matchConfig) {
    configSection = document.createElement('div');
    configSection.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #3a4450';

    const configLabel = document.createElement('div');
    configLabel.textContent = 'New Match';
    configLabel.style.cssText = 'font-size:13px;margin-bottom:8px;letter-spacing:1px;opacity:0.8';
    configSection.appendChild(configLabel);

    const mkCfgSlider = (label: string, min: number, max: number, val: number, cb: (v: number) => void): void => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin:6px 0';
      const name = document.createElement('span');
      name.textContent = label;
      name.style.cssText = 'flex:0 0 90px';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = '1';
      slider.value = String(val);
      slider.style.flex = '1';
      const readout = document.createElement('span');
      readout.textContent = String(val);
      readout.style.cssText = 'flex:0 0 32px;text-align:right';
      slider.addEventListener('input', () => {
        readout.textContent = slider.value;
        cb(Number(slider.value));
      });
      row.append(name, slider, readout);
      configSection!.appendChild(row);
    };

    let selectedBots = matchConfig.botCount;
    let selectedRounds = matchConfig.roundsToWin;
    mkCfgSlider('Bots', matchConfig.botCountMin, matchConfig.botCountMax, matchConfig.botCount, (v) => { selectedBots = v; });
    mkCfgSlider('Rounds', matchConfig.roundsMin, matchConfig.roundsMax, matchConfig.roundsToWin, (v) => { selectedRounds = v; });

    const btn = document.createElement('button');
    btn.textContent = 'New Match';
    btn.style.cssText =
      'margin-top:12px;padding:6px 16px;background:#2a5a2a;color:#eee;border:none;' +
      'cursor:pointer;font:14px monospace;width:100%';
    btn.onclick = (): void => matchConfig.onNewMatch(selectedBots, selectedRounds);
    configSection.appendChild(btn);

    panel.appendChild(configSection);
  }

  document.body.appendChild(panel);

  return {
    show: () => (panel.style.display = 'block'),
    hide: () => (panel.style.display = 'none'),
    setConnected(state: ConnectState, address?: string): void {
      if (!serverSection) return;
      const isConnected = state === 'connected';
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
          connBtn.onclick = (): void => { connectFromInputs?.(); };
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
    setGameMode(mode: GamePanelMode): void {
      if (!gameSection) return;
      if (mode === 'none') {
        gameSection.style.display = 'none';
        return;
      }
      gameSection.style.display = '';
      if (specBtn) specBtn.style.display = mode === 'playing' ? '' : 'none';
      if (joinTBtn) joinTBtn.style.display = mode === 'spectating' ? '' : 'none';
      if (joinCtBtn) joinCtBtn.style.display = mode === 'spectating' ? '' : 'none';
      if (teamRow) teamRow.style.display = '';
    },
  };
}

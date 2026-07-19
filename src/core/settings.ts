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
}

/**
 * A DOM overlay with one range slider per setting. Mutates `settings` in place
 * and calls `onChange(settings)` on every slider move so the game applies the
 * value live. Shown while not in pointer lock (the "menu" state), hidden in play.
 */
export function createSettingsPanel(settings: Settings, onChange: (s: Settings) => void): SettingsPanel {
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

  document.body.appendChild(panel);

  return {
    show: () => (panel.style.display = 'block'),
    hide: () => (panel.style.display = 'none'),
  };
}

/**
 * Settings screen — Phase 19.3.
 *
 * Three-tab left-nav layout: Graphics, Game, Bindings.
 * Plain DOM, inline styles, follows the same visual language as the rest.
 */

import type { Settings } from '../core/settings';
import { getBinding, rebindAction, ACTION_NAMES, ACTION_ORDER, type ActionId } from '../core/input';

export interface SettingsScreen {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

type TabId = 'graphics' | 'game' | 'bindings';

const BG = 'rgba(20,24,28,0.95)';
const FG = '#dfe6ee';
const BORDER = '#3a4450';
const MUTED = '#8899aa';
const ACCENT = '#4a7a5a';

export function createSettingsScreen(opts: {
  settings: Settings;
  onChange(s: Settings): void;
  onBack(): void;
}): SettingsScreen {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:none;' +
    `background:${BG};color:${FG};font:14px monospace;z-index:2000;`;

  // ---- header ----
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;' +
    `padding:12px 20px;border-bottom:1px solid ${BORDER};`;
  const headerTitle = document.createElement('div');
  headerTitle.textContent = 'Settings';
  headerTitle.style.cssText = 'font-size:18px;letter-spacing:2px;';
  header.appendChild(headerTitle);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  closeBtn.style.cssText =
    'background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 8px;';
  closeBtn.onclick = opts.onBack;
  header.appendChild(closeBtn);
  el.appendChild(header);

  // ---- body: left-nav + content pane ----
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex:1;height:calc(100% - 50px);';

  const tabs: { id: TabId; label: string }[] = [
    { id: 'graphics', label: 'Graphics' },
    { id: 'game', label: 'Game' },
    { id: 'bindings', label: 'Bindings' },
  ];

  // Left nav
  const nav = document.createElement('div');
  nav.style.cssText =
    `width:160px;border-right:1px solid ${BORDER};padding-top:16px;flex-shrink:0;`;
  const navBtns: HTMLButtonElement[] = [];

  // Right content area
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;padding:20px;overflow-y:auto;';

  let activeTab: TabId = 'graphics';

  // ---- Graphics tab ----
  const graphicsPane = document.createElement('div');
  graphicsPane.style.display = 'none';
  {
    const sliderLabel = (label: string, _v: number, fmt: string): { row: HTMLLabelElement; readout: HTMLSpanElement } => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;margin:10px 0;';
      const name = document.createElement('span');
      name.textContent = label;
      name.style.cssText = 'flex:0 0 100px;';
      const r = document.createElement('span');
      r.textContent = fmt;
      r.style.cssText = 'flex:0 0 48px;text-align:right;';
      row.append(name, r);
      return { row, readout: r };
    };

    const fovRow = sliderLabel('FOV', opts.settings.worldFovDeg, `${opts.settings.worldFovDeg.toFixed(0)}\u00b0`);
    const fovSlider = document.createElement('input');
    fovSlider.type = 'range';
    fovSlider.min = '70';
    fovSlider.max = '110';
    fovSlider.step = '1';
    fovSlider.value = String(opts.settings.worldFovDeg);
    fovSlider.style.flex = '1';
    fovSlider.addEventListener('input', () => {
      opts.settings.worldFovDeg = Number(fovSlider.value);
      fovRow.readout.textContent = `${fovSlider.value}\u00b0`;
      opts.onChange(opts.settings);
    });
    fovRow.row.appendChild(fovSlider);
    graphicsPane.appendChild(fovRow.row);
  }

  // ---- Game tab ----
  const gamePane = document.createElement('div');
  gamePane.style.display = 'none';
  {
    const mkSlider = (
      label: string,
      key: keyof Settings,
      min: string,
      max: string,
      step: string,
      fmt: (v: number) => string,
    ): void => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;margin:10px 0;';
      const name = document.createElement('span');
      name.textContent = label;
      name.style.cssText = 'flex:0 0 110px;';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.value = String(opts.settings[key]);
      slider.style.flex = '1';
      const readout = document.createElement('span');
      readout.textContent = fmt(opts.settings[key]);
      readout.style.cssText = 'flex:0 0 52px;text-align:right;';
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        (opts.settings as unknown as Record<string, number>)[key] = v;
        readout.textContent = fmt(v);
        opts.onChange(opts.settings);
      });
      row.append(name, slider, readout);
      gamePane.appendChild(row);
    };
    mkSlider('Sensitivity', 'sensitivity', '0.0005', '0.006', '0.0001', (v) => v.toFixed(4));
    mkSlider('Volume', 'volume', '0', '1', '0.01', (v) => `${Math.round(v * 100)}%`);
  }

  // ---- Bindings tab ----
  const bindingsPane = document.createElement('div');
  bindingsPane.style.display = 'none';
  {
    let rebindingAction: number | null = null;

    function renderBindings(): void {
      bindingsPane.innerHTML = '';

      const hint = document.createElement('div');
      hint.textContent = 'Click an action to rebind, then press the new key.';
      hint.style.cssText = `margin-bottom:16px;font-size:12px;opacity:0.6;color:${MUTED};`;
      bindingsPane.appendChild(hint);

      for (const actionId of ACTION_ORDER) {
        const name = ACTION_NAMES[actionId] ?? `Action ${actionId}`;
        const bindings = getBinding(actionId as ActionId);

        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;justify-content:space-between;' +
          `padding:6px 8px;margin:2px 0;border:1px solid transparent;`;

        const label = document.createElement('span');
        label.textContent = name;
        row.appendChild(label);

        const keyCaps = document.createElement('span');
        keyCaps.textContent = bindings.join(', ') || '(none)';
        keyCaps.style.cssText = `color:${ACCENT};`;
        row.appendChild(keyCaps);

        if (rebindingAction === actionId) {
          row.style.border = `1px solid ${ACCENT}`;
          keyCaps.textContent = '...';
        }

        row.onclick = (): void => {
          rebindingAction = actionId;
          renderBindings();
        };
        row.style.cursor = 'pointer';
        row.onmouseenter = (): void => { row.style.background = '#2a2a2a'; };
        row.onmouseleave = (): void => { row.style.background = 'none'; };

        bindingsPane.appendChild(row);
      }

      if (rebindingAction !== null) {
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style.cssText =
          `margin-top:12px;padding:6px 16px;background:#555;color:#eee;border:none;cursor:pointer;font:13px monospace;`;
        cancel.onclick = (): void => {
          rebindingAction = null;
          renderBindings();
        };
        bindingsPane.appendChild(cancel);
      }
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (rebindingAction === null || el.style.display === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      rebindAction(rebindingAction as ActionId, e.code);
      rebindingAction = null;
      renderBindings();
    }

    // Intercept keydown for rebinding when this pane is active.
    window.addEventListener('keydown', onKeyDown, { capture: true });

    renderBindings();
  }

  // Append nav + content panes
  for (const { id, label } of tabs) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'display:block;width:100%;padding:10px 16px;background:none;color:#aaa;border:none;' +
      'text-align:left;font:13px monospace;cursor:pointer;';
    btn.onmouseenter = (): void => { if (activeTab !== id) btn.style.color = '#eee'; };
    btn.onmouseleave = (): void => { if (activeTab !== id) btn.style.color = '#aaa'; };
    btn.onclick = (): void => { activateTab(id); };
    nav && nav.appendChild(btn);
    navBtns.push(btn);
  }
  body.appendChild(nav);
  body.appendChild(content);
  el.appendChild(body);

  [graphicsPane, gamePane, bindingsPane].forEach((p) => content.appendChild(p));

  function activateTab(id: TabId): void {
    activeTab = id;
    for (const b of navBtns) {
      b.style.color = b.textContent?.toLowerCase() === id ? '#eee' : '#aaa';
    }
    graphicsPane.style.display = id === 'graphics' ? '' : 'none';
    gamePane.style.display = id === 'game' ? '' : 'none';
    bindingsPane.style.display = id === 'bindings' ? '' : 'none';
  }

  activateTab('graphics');

  document.body.appendChild(el);

  return {
    el,
    show: (): void => { el.style.display = ''; },
    hide: (): void => { el.style.display = 'none'; },
  };
}

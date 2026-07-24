/**
 * Pause screen — shown when P/Esc is pressed mid-game. Resume, Settings, or
 * Exit to the main menu. Plain DOM, inline styles (mirrors entry.ts).
 */

export interface PauseScreen {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

const BG = 'rgba(12,14,18,0.92)';
const FG = '#dfe6ee';

export function createPauseScreen(opts: {
  onResume(): void;
  onSettings(): void;
  onExit(): void;
}): PauseScreen {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
    `background:${BG};color:${FG};font:14px monospace;z-index:1900;`;

  const title = document.createElement('div');
  title.textContent = 'Paused';
  title.style.cssText = 'font-size:28px;margin-bottom:32px;letter-spacing:4px;color:#fff;';
  el.appendChild(title);

  const mkBtn = (label: string, bg: string, cb: () => void): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `display:block;margin:8px auto;padding:12px 48px;background:${bg};color:#eee;` +
      'border:none;cursor:pointer;font:15px monospace;letter-spacing:1px;min-width:240px;';
    b.onclick = cb;
    el.appendChild(b);
  };

  mkBtn('Resume', '#4a6a3a', opts.onResume);
  mkBtn('Settings', '#3a4a7a', opts.onSettings);
  mkBtn('Exit to Menu', '#6a3a3a', opts.onExit);

  document.body.appendChild(el);

  return {
    el,
    show: (): void => { el.style.display = 'flex'; },
    hide: (): void => { el.style.display = 'none'; },
  };
}

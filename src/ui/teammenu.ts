/**
 * Team choice menu — shown before the game starts and whenever the player
 * chooses to switch team / spectate from the settings panel or by pressing M.
 * Plain DOM with three buttons, mirroring the connect.ts style.
 *
 * Phase 9: the entry point before any game state exists. The round loop does
 * not begin until a side is picked (SP) or the server acknowledges your Join
 * (MP). Spectate starts free-fly with no body.
 */

export type TeamChoice = 'T' | 'CT' | 'spec';

export interface TeamMenu {
  readonly el: HTMLElement;
  /** Update which buttons are enabled based on team capacity info. */
  setCounts(players: number, maxPlayers: number, spectators: number, specCap: number): void;
  /** Called when Esc is pressed while the menu is visible. The caller should
   *  hide the menu and return to the previous game state. */
  onEsc: (() => void) | null;
}

export function createTeamMenu(
  onPick: (choice: TeamChoice) => void,
): TeamMenu {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);color:#dfe6ee;font:14px monospace;z-index:1000;';

  const title = document.createElement('div');
  title.textContent = 'Counter Douglas Globally Offended';
  title.style.cssText = 'font-size:22px;margin-bottom:6px;letter-spacing:2px';
  el.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = 'Choose Team';
  sub.style.cssText = 'font-size:13px;margin-bottom:24px;opacity:0.6;letter-spacing:1px';
  el.appendChild(sub);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px';

  function btn(label: string, bg: string, choice: TeamChoice): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `padding:10px 28px;background:${bg};color:#eee;border:none;cursor:pointer;font:14px monospace;letter-spacing:1px;min-width:160px;`;
    b.onclick = () => onPick(choice);
    return b;
  }

  const tBtn = btn('Terrorists', '#6a4a2a', 'T');
  const ctBtn = btn('Counter-Terrorists', '#2a4a6a', 'CT');
  const specBtn = btn('Spectate', '#555', 'spec');

  row.appendChild(tBtn);
  row.appendChild(ctBtn);
  row.appendChild(specBtn);
  el.appendChild(row);

  // Keybind guide.
  const guide = document.createElement('div');
  guide.style.cssText =
    'margin-top:28px;display:grid;grid-template-columns:auto auto;gap:4px 16px;' +
    'font-size:12px;opacity:0.6;text-align:left;';
  const binds: [string, string][] = [
    ['Move', 'WASD'],
    ['Jump', 'Space'],
    ['Duck', 'Ctrl'],
    ['Walk', 'Shift'],
    ['Reload', 'R'],
    ['Use', 'E'],
    ['Weapons', '1 / 2'],
    ['Scoreboard', 'Tab'],
    ['Team menu', 'M'],
    ['Pause', 'P'],
  ];
  for (const [action, key] of binds) {
    const a = document.createElement('span');
    a.textContent = action;
    a.style.opacity = '0.7';
    const k = document.createElement('span');
    k.textContent = key;
    k.style.cssText = 'text-align:right;color:#dfe6ee;';
    guide.append(a, k);
  }
  el.appendChild(guide);

  const hint = document.createElement('div');
  hint.textContent = 'M / Esc to return';
  hint.style.cssText = 'margin-top:18px;opacity:0.4;font-size:12px';
  el.appendChild(hint);

  let escCb: (() => void) | null = null;

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyM') {
      // If already visible, Esc/M dismisses.
      if (el.style.display !== 'none' && escCb) escCb();
    }
  }
  window.addEventListener('keydown', onKeyDown);

  const menu: TeamMenu = {
    el,
    setCounts(players: number, maxPlayers: number, spectators: number, specCap: number): void {
      const teamsFull = players >= maxPlayers;
      const specFull = spectators >= specCap;
      tBtn.disabled = teamsFull;
      ctBtn.disabled = teamsFull;
      specBtn.disabled = specFull;
      const dim = 'opacity:0.35;cursor:not-allowed';
      tBtn.style.cssText += teamsFull ? dim : '';
      ctBtn.style.cssText += teamsFull ? dim : '';
      specBtn.style.cssText += specFull ? dim : '';
    },
    get onEsc() {
      return escCb;
    },
    set onEsc(cb: (() => void) | null) {
      escCb = cb;
    },
  };

  return menu;
}

/**
 * Entry screen — Phase 19.2.
 *
 * Title "Counter Douglas", user menu with display name + logout/settings/admin,
 * Singleplayer (→ match config popup) and Multi-player (→ server connect popup).
 * Plain DOM, inline styles.
 */

import type { AuthState } from '../core/auth';

export interface EntryScreen {
  el: HTMLElement;
  show(): void;
  hide(): void;
  setAuth(auth: AuthState | null): void;
}

const BG = 'rgba(20,24,28,0.95)';
const FG = '#dfe6ee';
const BORDER = '#3a4450';
const MUTED = '#8899aa';

const POPUP_BG = 'rgba(16,18,22,0.98)';

interface SpOptions {
  botCountMin: number;
  botCountMax: number;
  roundsMin: number;
  roundsMax: number;
  onStart(bots: number, rounds: number): void;
}

interface MpOptions {
  defaultAddress: string;
  defaultPort: string;
  onConnect(url: string, name: string): void;
}

export function createEntryScreen(opts: {
  onSettings(): void;
  onAdmin(): void;
  sp: SpOptions;
  mp: MpOptions;
}): EntryScreen {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
    `background:${BG};color:${FG};font:14px monospace;z-index:2000;`;

  const container = document.createElement('div');
  container.style.cssText = 'text-align:center;';

  const title = document.createElement('div');
  title.textContent = 'Counter Douglas';
  title.style.cssText = 'font-size:36px;margin-bottom:8px;letter-spacing:4px;color:#fff;';

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Globally Offended';
  subtitle.style.cssText = `font-size:13px;margin-bottom:40px;opacity:0.5;letter-spacing:2px;color:${MUTED};`;

  container.appendChild(title);
  container.appendChild(subtitle);

  const mkBtn = (label: string, bg: string, cb: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `display:block;margin:8px auto;padding:12px 48px;background:${bg};color:#eee;` +
      'border:none;cursor:pointer;font:15px monospace;letter-spacing:1px;min-width:240px;';
    b.onclick = cb;
    return b;
  };

  // -- SP config popup --
  const spPopup = document.createElement('div');
  spPopup.style.cssText =
    `position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;` +
    `background:${POPUP_BG};z-index:2100;`;
  {
    const box = document.createElement('div');
    box.style.cssText = `padding:24px 32px;border:1px solid ${BORDER};min-width:300px;text-align:left;`;
    const h = document.createElement('div');
    h.textContent = 'New Match';
    h.style.cssText = 'font-size:16px;margin-bottom:16px;letter-spacing:1px;';
    box.appendChild(h);

    let bots = 6;
    let rounds = 16;

    function mkSlider(label: string, min: number, max: number, val: number, cb: (v: number) => void): void {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;margin:8px 0;';
      const name = document.createElement('span');
      name.textContent = label;
      name.style.cssText = 'flex:0 0 100px;';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = '1';
      slider.value = String(val);
      slider.style.flex = '1';
      const rd = document.createElement('span');
      rd.textContent = String(val);
      rd.style.cssText = 'flex:0 0 32px;text-align:right;';
      slider.addEventListener('input', () => {
        rd.textContent = slider.value;
        cb(Number(slider.value));
      });
      row.append(name, slider, rd);
      box.appendChild(row);
    }

    mkSlider('Bots', opts.sp.botCountMin, opts.sp.botCountMax, bots, (v) => { bots = v; });
    mkSlider('Rounds', opts.sp.roundsMin, opts.sp.roundsMax, rounds, (v) => { rounds = v; });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'flex:1;padding:8px;background:#555;color:#eee;border:none;cursor:pointer;font:13px monospace;';
    cancel.onclick = (): void => { spPopup.style.display = 'none'; };
    const start = document.createElement('button');
    start.textContent = 'Start';
    start.style.cssText = 'flex:1;padding:8px;background:#4a6a3a;color:#eee;border:none;cursor:pointer;font:13px monospace;';
    start.onclick = (): void => opts.sp.onStart(bots, rounds);
    btnRow.appendChild(cancel);
    btnRow.appendChild(start);
    box.appendChild(btnRow);
    spPopup.appendChild(box);
  }
  el.appendChild(spPopup);

  // -- MP connect popup --
  const mpPopup = document.createElement('div');
  mpPopup.style.cssText =
    `position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;` +
    `background:${POPUP_BG};z-index:2100;`;
  const nameInput = document.createElement('input'); // hoisted so mpBtn can prefill it
  {
    const box = document.createElement('div');
    box.style.cssText = `padding:24px 32px;border:1px solid ${BORDER};min-width:300px;text-align:left;`;
    const h = document.createElement('div');
    h.textContent = 'Connect to Server';
    h.style.cssText = 'font-size:16px;margin-bottom:16px;letter-spacing:1px;';
    box.appendChild(h);

    nameInput.type = 'text';
    nameInput.placeholder = 'username';
    nameInput.maxLength = 24;
    nameInput.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 8px;margin-bottom:12px;background:#1a1a1a;color:#eee;border:1px solid #444;font:13px monospace;';
    box.appendChild(nameInput);

    const addrRow = document.createElement('div');
    addrRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:12px;';
    const addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.value = opts.mp.defaultAddress;
    addrInput.placeholder = 'address';
    addrInput.style.cssText = 'flex:1;padding:6px 8px;background:#1a1a1a;color:#eee;border:1px solid #444;font:13px monospace;';

    const portInput = document.createElement('input');
    portInput.type = 'text';
    portInput.value = opts.mp.defaultPort;
    portInput.placeholder = 'port';
    portInput.style.cssText = 'width:52px;padding:6px 4px;background:#1a1a1a;color:#eee;border:1px solid #444;font:13px monospace;text-align:center;';

    addrRow.appendChild(addrInput);
    addrRow.appendChild(portInput);
    box.appendChild(addrRow);

    const statusEl = document.createElement('div');
    statusEl.style.cssText = `min-height:16px;font-size:12px;color:${MUTED};margin-bottom:8px;`;
    box.appendChild(statusEl);

    const buildUrl = (addr: string, port: string): string | null => {
      if (/^wss?:\/\//.test(addr)) return addr;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(addr)) return null;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (addr.includes('/')) return `${scheme}//${addr}`;
      return `${scheme}//${addr}:${port}`;
    };

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'flex:1;padding:8px;background:#555;color:#eee;border:none;cursor:pointer;font:13px monospace;';
    cancel.onclick = (): void => { mpPopup.style.display = 'none'; };
    const connect = document.createElement('button');
    connect.textContent = 'Connect';
    connect.style.cssText = 'flex:1;padding:8px;background:#3a4a7a;color:#eee;border:none;cursor:pointer;font:13px monospace;';
    connect.onclick = (): void => {
      const name = nameInput.value.trim();
      if (!name) {
        statusEl.textContent = 'Pick a username';
        statusEl.style.color = '#c44';
        return;
      }
      const addr = addrInput.value.trim();
      const port = portInput.value.trim();
      const needsPort = !/^wss?:\/\//.test(addr) && !addr.includes('/');
      if (!addr || (needsPort && !port)) {
        statusEl.textContent = 'Enter address and port';
        statusEl.style.color = '#c44';
        return;
      }
      const url = buildUrl(addr, port);
      if (!url) {
        statusEl.textContent = 'Invalid URL';
        statusEl.style.color = '#c44';
        return;
      }
      statusEl.textContent = 'connecting\u2026';
      statusEl.style.color = MUTED;
      opts.mp.onConnect(url, name);
    };
    btnRow.appendChild(cancel);
    btnRow.appendChild(connect);
    box.appendChild(btnRow);
    mpPopup.appendChild(box);
  }
  el.appendChild(mpPopup);

  const spBtn = mkBtn('Singleplayer', '#4a6a3a', () => { spPopup.style.display = 'flex'; });
  const mpBtn = mkBtn('Multi-player', '#3a4a7a', () => {
    // Multi-player needs an account: send unauthenticated users to Keycloak.
    if (!_authRef?.authenticated) {
      void _authRef?.login();
      return;
    }
    // Prefill the handle with the signed-in display name (editable).
    if (!nameInput.value) nameInput.value = _authRef?.name ?? '';
    mpPopup.style.display = 'flex';
  });
  container.appendChild(spBtn);
  container.appendChild(mpBtn);

  el.appendChild(container);

  // User menu — top-right pill with dropdown.
  const userArea = document.createElement('div');
  userArea.style.cssText = 'position:absolute;top:16px;right:16px;';
  el.appendChild(userArea);

  const userBtn = document.createElement('button');
  userBtn.style.cssText =
    `padding:6px 14px;background:${BG};color:${FG};border:1px solid ${BORDER};` +
    'font:13px monospace;cursor:pointer;';

  const dropdown = document.createElement('div');
  dropdown.style.cssText =
    `position:absolute;top:100%;right:0;margin-top:4px;padding:4px 0;background:${BG};` +
    `border:1px solid ${BORDER};display:none;min-width:140px;`;
  userArea.appendChild(userBtn);
  userArea.appendChild(dropdown);

  let dropdownOpen = false;

  function toggleDropdown(): void {
    dropdownOpen = !dropdownOpen;
    dropdown.style.display = dropdownOpen ? '' : 'none';
  }

  document.addEventListener('click', (e) => {
    if (dropdownOpen && !userArea.contains(e.target as Node)) {
      dropdownOpen = false;
      dropdown.style.display = 'none';
    }
  });

  function ddItem(label: string, cb: () => void): HTMLButtonElement {
    const item = document.createElement('button');
    item.textContent = label;
    item.style.cssText =
      'display:block;width:100%;padding:6px 14px;background:none;color:#dfe6ee;' +
      'border:none;text-align:left;font:13px monospace;cursor:pointer;';
    item.onclick = (): void => {
      dropdownOpen = false;
      dropdown.style.display = 'none';
      cb();
    };
    item.onmouseenter = (): void => { item.style.background = '#333'; };
    item.onmouseleave = (): void => { item.style.background = 'none'; };
    dropdown.appendChild(item);
    return item;
  }

  ddItem('Settings', opts.onSettings);

  const logoutItem = document.createElement('button');
  logoutItem.textContent = 'Log out';
  logoutItem.style.cssText =
    'display:block;width:100%;padding:6px 14px;background:none;color:#dfe6ee;' +
    'border:none;text-align:left;font:13px monospace;cursor:pointer;';
  logoutItem.onmouseenter = (): void => { logoutItem.style.background = '#333'; };
  logoutItem.onmouseleave = (): void => { logoutItem.style.background = 'none'; };
  dropdown.appendChild(logoutItem);

  const adminItem = document.createElement('button');
  adminItem.textContent = 'Admin';
  adminItem.style.cssText =
    'display:none;width:100%;padding:6px 14px;background:none;color:#dfe6ee;' +
    'border:none;text-align:left;font:13px monospace;cursor:pointer;';
  adminItem.onclick = (): void => {
    dropdownOpen = false;
    dropdown.style.display = 'none';
    opts.onAdmin();
  };
  adminItem.onmouseenter = (): void => { adminItem.style.background = '#333'; };
  adminItem.onmouseleave = (): void => { adminItem.style.background = 'none'; };
  dropdown.appendChild(adminItem);

  let _authRef: AuthState | null = null;

  function refreshUserMenu(): void {
    const auth = _authRef;
    const authed = !!auth?.authenticated;
    if (authed) {
      userBtn.textContent = `Hello, ${auth?.name ?? auth?.sub ?? '?'}`;
      adminItem.style.display = auth?.isAdmin ? '' : 'none';
    } else {
      userBtn.textContent = 'Log in';
      adminItem.style.display = 'none';
    }
  }

  logoutItem.onclick = (): void => {
    dropdownOpen = false;
    dropdown.style.display = 'none';
    void _authRef?.logout();
  };
  userBtn.onclick = (): void => {
    if (!_authRef?.authenticated) {
      void _authRef?.login();
    } else {
      toggleDropdown();
    }
  };

  document.body.appendChild(el);
  refreshUserMenu(); // start gated until auth resolves

  return {
    el,
    show: (): void => { el.style.display = 'flex'; },
    hide: (): void => { el.style.display = 'none'; },
    setAuth(auth: AuthState | null): void {
      _authRef = auth;
      refreshUserMenu();
    },
  };
}

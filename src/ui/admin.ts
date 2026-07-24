/**
 * Admin screen — Phase 20.2.
 *
 * Form over the three server config knobs (bot count, rounds-to-win, map).
 * Loads via GET, saves via PUT. Only visible to role_admin; the server
 * enforces the gate, the hidden button is not the control.
 *
 * Plain DOM, inline styles.
 */

const BG = 'rgba(20,24,28,0.95)';
const FG = '#dfe6ee';
const BORDER = '#3a4450';
const MUTED = '#8899aa';

export interface AdminScreen {
  el: HTMLElement;
  show(): void;
  hide(): void;
}

export interface AdminConfigData {
  botCount: number;
  roundsToWin: number;
  map: string;
}

export function createAdminScreen(opts: {
  /**
   * Base URL the `/api/config` calls go to. Same-origin in both stacks:
   * nginx proxies `/api/` to the server's API port in compose, the vite dev
   * server proxies it to 127.0.0.1:9877. ponytail: this means you administer
   * the server behind your own origin — there is no "pick a remote server to
   * admin" flow, and it doesn't need one until there is more than one server.
   */
  apiBase: string;
  /** JWT to include in the Authorization header. */
  token(): string | undefined;
  onBack(): void;
}): AdminScreen {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;' +
    `background:${BG};color:${FG};font:14px monospace;z-index:2000;`;

  const container = document.createElement('div');
  container.style.cssText =
    `padding:24px 32px;border:1px solid ${BORDER};min-width:320px;max-width:420px;`;

  const title = document.createElement('div');
  title.textContent = 'Server Config';
  title.style.cssText = 'font-size:18px;margin-bottom:20px;letter-spacing:2px;';
  container.appendChild(title);

  // Status line
  const status = document.createElement('div');
  status.style.cssText = `min-height:18px;margin-bottom:12px;font-size:12px;color:${MUTED};`;
  container.appendChild(status);

  // Fields
  const fields: { id: string; label: string; val: HTMLInputElement | HTMLSelectElement }[] = [];

  function mkRow(label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin:10px 0;display:flex;align-items:center;gap:12px;';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'flex:0 0 110px;';
    row.appendChild(lbl);
    // The input/select is appended by the caller
    return row;
  }

  function mkNumField(label: string, id: string, min: number, max: number): void {
    const row = mkRow(label);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(min);
    inp.style.cssText =
      'flex:1;padding:4px 8px;background:#1a1a1a;color:#eee;border:1px solid #444;font:13px monospace;';
    row.appendChild(inp);
    fields.push({ id, label, val: inp });
    container.appendChild(row);
  }

  mkNumField('Bot count', 'botCount', 2, 6);
  mkNumField('Rounds to win', 'roundsToWin', 1, 30);

  {
    const row = mkRow('Map');
    const sel = document.createElement('select');
    sel.style.cssText =
      'flex:1;padding:4px 8px;background:#1a1a1a;color:#eee;border:1px solid #444;font:13px monospace;';
    const opt = document.createElement('option');
    opt.value = 'de_douglas';
    opt.textContent = 'de_douglas';
    sel.appendChild(opt);
    row.appendChild(sel);
    fields.push({ id: 'map', label: 'Map', val: sel });
    container.appendChild(row);
  }

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:20px;';

  function mkBtn(label: string, bg: string, cb: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `flex:1;padding:8px 16px;background:${bg};color:#eee;border:none;cursor:pointer;font:13px monospace;`;
    b.onclick = cb;
    return b;
  }

  btnRow.appendChild(mkBtn('Back', '#555', opts.onBack));
  const saveBtn = mkBtn('Save', '#4a7a5a', () => saveConfig());
  btnRow.appendChild(saveBtn);
  container.appendChild(btnRow);

  el.appendChild(container);
  document.body.appendChild(el);

  async function fetchConfig(): Promise<void> {
    status.textContent = 'loading...';
    const token = opts.token();
    try {
      const res = await fetch(`${opts.apiBase}/api/config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        status.textContent = `Error: ${res.status} ${res.statusText}`;
        status.style.color = '#c44';
        return;
      }
      const data = (await res.json()) as AdminConfigData;
      for (const f of fields) {
        const val = (data as unknown as Record<string, unknown>)[f.id];
        if (val !== undefined) f.val.value = String(val);
      }
      status.textContent = 'Loaded';
      status.style.color = MUTED;
    } catch (err) {
      status.textContent = `Failed: ${String(err)}`;
      status.style.color = '#c44';
    }
  }

  async function saveConfig(): Promise<void> {
    status.textContent = 'saving...';
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      body[f.id] = f.val instanceof HTMLInputElement && f.val.type === 'number'
        ? Number(f.val.value)
        : f.val.value;
    }
    const token = opts.token();
    saveBtn.disabled = true;
    try {
      const res = await fetch(`${opts.apiBase}/api/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        status.textContent = `Error ${res.status}: ${text}`;
        status.style.color = '#c44';
        return;
      }
      status.textContent = 'Saved \u2014 takes effect next round';
      status.style.color = '#6a9';
    } catch (err) {
      status.textContent = `Failed: ${String(err)}`;
      status.style.color = '#c44';
    } finally {
      saveBtn.disabled = false;
    }
  }

  return {
    el,
    show: (): void => {
      el.style.display = 'flex';
      void fetchConfig();
    },
    hide: (): void => { el.style.display = 'none'; },
  };
}

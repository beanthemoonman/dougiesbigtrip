/**
 * Tab-hold scoreboard — a two-column (T | CT) table of players showing
 * kills/deaths. CS-style: appears while Tab is held, disappears on release.
 * See docs/connect-and-scoreboard.md §2.
 */

export interface PlayerScore {
  slot: number;
  team: 'T' | 'CT';
  name: string;
  kills: number;
  deaths: number;
}

/**
 * Default 3v3 roster before the server sends real names / kill events.
 * Ponytail: names come from the wire only when the protocol gains a name
 * field (docs/connect-and-scoreboard.md §4).
 */
export function defaultRoster(): PlayerScore[] {
  const out: PlayerScore[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      slot: i,
      team: i < 3 ? 'T' : 'CT',
      name: `Bot ${i + 1}`,
      kills: 0,
      deaths: 0,
    });
  }
  return out;
}

export interface Scoreboard {
  readonly el: HTMLElement;
  /** Update the roster. Call whenever kills/deaths change. */
  render(players: PlayerScore[]): void;
  visible: boolean;
}

export function createScoreboard(): Scoreboard {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);color:#ccc;font:13px monospace;z-index:900;pointer-events:none;';

  let visible = false;

  const sb: Scoreboard = {
    el,
    render(players: PlayerScore[]): void {
      const sorted = [...players];
      // Sort: CT first, then by kills DESC.
      sorted.sort((a, b) => {
        if (a.team !== b.team) return a.team === 'CT' ? -1 : 1;
        return b.kills - a.kills;
      });
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:48px;';

      for (const team of ['T', 'CT'] as const) {
        const col = document.createElement('div');
        col.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:160px;';
        const head = document.createElement('div');
        head.textContent = `=== ${team} ===`;
        head.style.cssText = 'color:#aaa;border-bottom:1px solid #555;margin-bottom:4px;';
        col.appendChild(head);

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;justify-content:space-between;color:#888;font-size:11px;';
        headerRow.innerHTML = '<span>NAME</span><span>K</span><span>D</span>';
        col.appendChild(headerRow);

        for (const p of sorted.filter((p) => p.team === team)) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;';
          row.innerHTML =
            `<span>${p.name}</span><span style="width:24px;text-align:right">${p.kills}</span>` +
            `<span style="width:24px;text-align:right">${p.deaths}</span>`;
          col.appendChild(row);
        }
        wrap.appendChild(col);
      }

      el.textContent = '';
      el.appendChild(wrap);
    },
    get visible() {
      return visible;
    },
    set visible(v: boolean) {
      visible = v;
      el.style.display = v ? 'flex' : 'none';
    },
  };

  return sb;
}

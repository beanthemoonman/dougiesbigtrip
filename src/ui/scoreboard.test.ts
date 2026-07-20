/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createScoreboard, defaultRoster, type PlayerScore } from './scoreboard';

describe('scoreboard', () => {
  it('default roster has 6 entries, 3 per team', () => {
    const r = defaultRoster();
    expect(r.length).toBe(6);
    expect(r.filter((p) => p.team === 'T').length).toBe(3);
    expect(r.filter((p) => p.team === 'CT').length).toBe(3);
  });

  it('render produces two columns (T and CT) with correct text', () => {
    const sb = createScoreboard();
    const players: PlayerScore[] = [
      { slot: 0, team: 'T', name: 'Player 1', kills: 5, deaths: 2, alive: true },
      { slot: 1, team: 'T', name: 'Player 2', kills: 3, deaths: 4, alive: true },
      { slot: 2, team: 'T', name: 'Player 3', kills: 1, deaths: 6, alive: false },
      { slot: 3, team: 'CT', name: 'Bot 1', kills: 8, deaths: 1, alive: true },
      { slot: 4, team: 'CT', name: 'Bot 2', kills: 4, deaths: 3, alive: true },
      { slot: 5, team: 'CT', name: 'Bot 3', kills: 2, deaths: 5, alive: true },
    ];
    sb.render(players);
    const html = sb.el.innerHTML;
    expect(html).toContain('=== CT ===');
    expect(html).toContain('=== T ===');
    expect(html).toContain('Bot 1');
    expect(html).toContain('Player 1');
    expect(html).toContain('(DEAD)');
  });

  it('scoreboard visibility toggle', () => {
    const sb = createScoreboard();
    expect(sb.visible).toBe(false);
    sb.visible = true;
    expect(sb.visible).toBe(true);
    expect(sb.el.style.display).toBe('flex');
    sb.visible = false;
    expect(sb.visible).toBe(false);
    expect(sb.el.style.display).toBe('none');
  });
});

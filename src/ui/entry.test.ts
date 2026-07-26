/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createEntryScreen } from './entry';

function mk(): HTMLElement {
  return createEntryScreen({
    onSettings: () => {},
    onAdmin: () => {},
    sp: { botCountMin: 2, botCountMax: 10, roundsMin: 1, roundsMax: 30, onStart: () => {} },
    mp: { defaultAddress: '127.0.0.1', defaultPort: '9876', onConnect: () => {} },
  }).el;
}

describe('entry screen source link', () => {
  it('links to the repo and opens safely in a new tab', () => {
    const a = mk().querySelector<HTMLAnchorElement>('a[href*="github.com"]');
    expect(a).not.toBeNull();
    expect(a!.href).toBe('https://github.com/beanthemoonman/dougiesbigtrip');
    // target=_blank without noopener hands the opener window to the new tab.
    expect(a!.rel).toContain('noopener');
    expect(a!.querySelector('svg')).not.toBeNull();
  });
});

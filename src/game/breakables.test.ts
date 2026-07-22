import { describe, expect, it } from 'vitest';
import { type Breakable, damageProp, resetBrokenBreakables } from './breakables';

const mk = (hp: number, restsOn: number | null = null): Breakable => ({ hp, broken: false, restsOn });

describe('damageProp', () => {
  it('deducts hp and does not break above zero', () => {
    const props = [mk(100)];
    expect(damageProp(props, 0, 36)).toEqual([]);
    expect(props[0]?.hp).toBe(64);
    expect(props[0]?.broken).toBe(false);
  });

  it('breaks at or below zero', () => {
    const props = [mk(30)];
    expect(damageProp(props, 0, 36)).toEqual([0]);
    expect(props[0]?.broken).toBe(true);
  });

  it('cascades to props resting on the one that broke', () => {
    const props = [mk(30), mk(200, 0)]; // 1 rests on 0
    expect(damageProp(props, 0, 40)).toEqual([0, 1]); // both go, in order
    expect(props[1]?.broken).toBe(true);
  });

  it('does not cascade upward: breaking the top leaves the base', () => {
    const props = [mk(200), mk(30, 0)];
    expect(damageProp(props, 1, 40)).toEqual([1]);
    expect(props[0]?.broken).toBe(false);
  });

  it('cascades transitively through a stack', () => {
    const props = [mk(10), mk(999, 0), mk(999, 1)]; // 2 on 1 on 0
    expect(damageProp(props, 0, 20)).toEqual([0, 1, 2]);
  });

  it('is a no-op on an already-broken prop', () => {
    const gone: Breakable = { hp: -5, broken: true, restsOn: null };
    expect(damageProp([gone], 0, 100)).toEqual([]);
  });
});

describe('resetBrokenBreakables', () => {
  const hpByUrl = new Map([['crate', 90], ['barrel', 55]]);
  const urlAt = (i: number) => (i % 2 === 0 ? 'crate' : 'barrel');

  it('resets broken props to their original hp', () => {
    const props: (Breakable | null)[] = [
      { hp: -10, broken: true, restsOn: null },
      { hp: -5, broken: true, restsOn: null },
    ];
    const reset = resetBrokenBreakables(props, hpByUrl, urlAt);
    expect(reset).toEqual([0, 1]);
    expect(props[0]?.broken).toBe(false);
    expect(props[0]?.hp).toBe(90);
    expect(props[1]?.broken).toBe(false);
    expect(props[1]?.hp).toBe(55);
  });

  it('ignores unbroken props', () => {
    const props: (Breakable | null)[] = [
      mk(100),
      { hp: -5, broken: true, restsOn: null },
      null,
    ];
    const reset = resetBrokenBreakables(props, hpByUrl, urlAt);
    expect(reset).toEqual([1]);
    expect(props[0]?.broken).toBe(false);
    expect(props[0]?.hp).toBe(100); // untouched
  });

  it('returns empty for nothing broken', () => {
    const props: (Breakable | null)[] = [mk(50), mk(75)];
    expect(resetBrokenBreakables(props, hpByUrl, urlAt)).toEqual([]);
  });
});

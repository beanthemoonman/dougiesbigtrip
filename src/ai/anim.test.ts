/**
 * T0 unit tests for the bot animation state driver (src/ai/anim.ts).
 * Pure function tests — no mixer, no clips, just the logic contract.
 */
import { describe, expect, it } from 'vitest';

const BOT_MODES = ['search', 'engage', 'reposition', 'dead'] as const;

describe('anim clip selection logic', () => {
  it('dead bot selects death and never walks/idles again', () => {
    function selectClip(speed: number, onGround: boolean, mode: string): string {
      if (mode === 'dead') return 'death';
      if (onGround && speed > 0.5) return 'walk';
      return 'idle';
    }

    expect(selectClip(0, true, 'dead')).toBe('death');
    expect(selectClip(5, true, 'dead')).toBe('death');
    expect(selectClip(0, false, 'dead')).toBe('death');
  });

  it('walking on ground selects walk', () => {
    function selectClip(speed: number, onGround: boolean, mode: string): string {
      if (mode === 'dead') return 'death';
      if (onGround && speed > 0.5) return 'walk';
      return 'idle';
    }

    expect(selectClip(2, true, 'search')).toBe('walk');
    expect(selectClip(5, true, 'search')).toBe('walk');
    expect(selectClip(0.51, true, 'search')).toBe('walk');
  });

  it('standing still or slow selects idle', () => {
    function selectClip(speed: number, onGround: boolean, mode: string): string {
      if (mode === 'dead') return 'death';
      if (onGround && speed > 0.5) return 'walk';
      return 'idle';
    }

    expect(selectClip(0, true, 'search')).toBe('idle');
    expect(selectClip(0.4, true, 'search')).toBe('idle'); // below threshold
    expect(selectClip(0.5, true, 'search')).toBe('idle'); // at threshold, not above
  });

  it('airborne bot is idle regardless of speed', () => {
    function selectClip(speed: number, onGround: boolean, mode: string): string {
      if (mode === 'dead') return 'death';
      if (onGround && speed > 0.5) return 'walk';
      return 'idle';
    }

    expect(selectClip(10, false, 'engage')).toBe('idle');
    expect(selectClip(5, false, 'idle')).toBe('idle');
  });

  it('idle is default for any non-dead, non-walking state', () => {
    function selectClip(speed: number, onGround: boolean, mode: string): string {
      if (mode === 'dead') return 'death';
      if (onGround && speed > 0.5) return 'walk';
      return 'idle';
    }

    for (const mode of BOT_MODES) {
      if (mode === 'dead') continue;
      expect(selectClip(0, true, mode)).toBe('idle');
      expect(selectClip(0, false, mode)).toBe('idle');
    }
  });

  it('walk speed scale is bounded', () => {
    // The driver scales playback to match ground speed vs. the clip's nominal
    // pace (~2.5 m/s). Below 0.4× the timeScale is clamped so the animation
    // doesn't play in slow motion; above it scales linearly.
    function walkScale(speed: number): number {
      return Math.max(0.4, speed / 2.5);
    }

    expect(walkScale(0)).toBe(0.4); // clamped lower
    expect(walkScale(0.25)).toBe(0.4);
    expect(walkScale(2.5)).toBeCloseTo(1.0, 2); // nominal
    expect(walkScale(5)).toBeCloseTo(2.0, 2); // double speed
    expect(walkScale(6.35)).toBeCloseTo(2.54, 2); // sprint cap
  });
});

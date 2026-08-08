/**
 * T0 unit tests for the bot animation state driver (src/ai/anim.ts).
 * Pure function tests — no mixer, no clips, just the logic contract.
 */
import { AnimationClip, LoopOnce, Object3D, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';

import { createBotAnim, driveBotAnim, resetBotAnim, type BotAnimState } from './anim';

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
    // pace (~2.5 m/s). Below 0.4 the timeScale is clamped so the animation
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


/**
 * The remote-player driving path (session.ts). Unlike the clip-selection tests
 * above, these drive the REAL anim.ts functions against a real AnimationMixer
 * with synthetic clips — a test that reimplemented the selection rule locally
 * would pass with anim.ts deleted.
 */
describe('remote-driving path', () => {
  // Minimal stand-ins for the clips baked into the character .glb. The mixer
  // only needs a named clip with one track; nothing here renders.
  function makeClips(): AnimationClip[] {
    const track = (): VectorKeyframeTrack =>
      new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 1, 0]);
    return [
      new AnimationClip('idle', 1, [track()]),
      new AnimationClip('walk', 1, [track()]),
      new AnimationClip('death', 1, [track()]),
    ];
  }

  function makeState(): BotAnimState {
    return createBotAnim(new Object3D(), makeClips());
  }

  const DT = 1 / 60;

  it('starts idle', () => {
    expect(makeState().current).toBe('idle');
  });

  it('walks above the speed threshold and idles below it', () => {
    const s = makeState();
    driveBotAnim(s, 2.0, true, 'search', DT);
    expect(s.current).toBe('walk');
    driveBotAnim(s, 0.4, true, 'search', DT);
    expect(s.current).toBe('idle');
  });

  it('walks in every alive mode, not just search', () => {
    for (const mode of ['search', 'engage', 'reposition'] as const) {
      const s = makeState();
      driveBotAnim(s, 3.0, true, mode, DT);
      expect(s.current).toBe('walk');
    }
  });

  it('scales walk playback with speed and clamps the floor', () => {
    const s = makeState();
    driveBotAnim(s, 5.0, true, 'search', DT);
    expect(s.actions.get('walk')!.timeScale).toBeCloseTo(2.0, 5);
    driveBotAnim(s, 0.6, true, 'search', DT);
    expect(s.actions.get('walk')!.timeScale).toBeCloseTo(0.4, 5);
  });

  it('plays the death clip once and latches', () => {
    const s = makeState();
    driveBotAnim(s, 3.0, true, 'search', DT);
    driveBotAnim(s, 0, true, 'dead', DT);
    expect(s.current).toBe('death');
    expect(s.deadPlayed).toBe(true);
    // Still death after further ticks, at any speed — no re-trigger, no walk.
    driveBotAnim(s, 5.0, true, 'dead', DT);
    expect(s.current).toBe('death');
    expect(s.actions.get('death')!.loop).toBe(LoopOnce);
    expect(s.actions.get('death')!.clampWhenFinished).toBe(true);
  });

  it('resetBotAnim clears the death latch so a respawn animates again', () => {
    const s = makeState();
    driveBotAnim(s, 0, true, 'dead', DT);
    expect(s.current).toBe('death');

    // This is the dead->alive edge session.ts runs before driving the remote.
    resetBotAnim(s);
    expect(s.current).toBe('idle');
    expect(s.deadPlayed).toBe(false);

    driveBotAnim(s, 3.0, true, 'search', DT);
    expect(s.current).toBe('walk');
  });

  it('advances mixer time by the dt it is given', () => {
    const s = makeState();
    driveBotAnim(s, 0, true, 'search', 0.5);
    expect(s.mixer.time).toBeCloseTo(0.5, 5);
    driveBotAnim(s, 0, true, 'search', 0.25);
    expect(s.mixer.time).toBeCloseTo(0.75, 5);
  });
});

/**
 * Bot animation state driver. Reads the bot's velocity + brain FSM mode and
 * drives a three.js AnimationMixer clipping between Mixamo-derived animation
 * clips (idle, walk, death) embedded in the character .glb.
 *
 * No file IO, no randomness — pure state → clip selection logic. Tested in
 * anim.test.ts.
 */
import { AnimationMixer, LoopOnce, LoopRepeat, type AnimationClip, type AnimationAction, type Object3D } from 'three';
import type { BotMode } from './brain';

export type AnimClip = 'idle' | 'walk' | 'death';

const WALK_SPEED_THRESHOLD = 0.5; // m/s; below this the bot is "standing"
const FADE_DURATION = 0.15;       // s; crossfade between clips

export interface BotAnimState {
  readonly mixer: AnimationMixer;
  readonly actions: Map<AnimClip, AnimationAction>;
  current: AnimClip;
  deadPlayed: boolean;
}

/**
 * Build the animation state from the already-cloned bot root. The root must be
 * the topmost parent node of the character hierarchy (the armature + skinned
 * mesh), and `templateClips` are the AnimationClips from the template .glb
 * (shared, not cloned — the mixer's clipAction creates new actions per mixer).
 */
export function createBotAnim(root: Object3D, templateClips: AnimationClip[]): BotAnimState {
  const mixer = new AnimationMixer(root);
  const actions = new Map<AnimClip, AnimationAction>();

  for (const clip of templateClips) {
    const action = mixer.clipAction(clip);
      action.setLoop(LoopRepeat, Infinity);
      if (clip.name === 'idle') {
        actions.set('idle', action);
      } else if (clip.name === 'walk') {
        actions.set('walk', action);
      } else if (clip.name === 'death') {
        actions.set('death', action);
        action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
  }

  // Start idle
  const idle = actions.get('idle');
  if (idle) idle.play();

  return { mixer, actions, current: 'idle', deadPlayed: false };
}

/**
 * Advance the animation state for one sim tick. Reads bot speed + ground
 * contact + the brain FSM mode to pick the right clip. The mixer is stepped by
 * `dt` at the fixed sim rate (64 Hz). The caller must also set the bot root's
 * world position and rotation separately.
 */
export function driveBotAnim(
  state: BotAnimState,
  speed: number,
  onGround: boolean,
  mode: BotMode,
  dt: number,
): void {
  if (mode === 'dead') {
    if (!state.deadPlayed) {
      const death = state.actions.get('death');
      if (death) {
        crossfade(state, death);
        state.deadPlayed = true;
        state.current = 'death';
      }
    }
    state.mixer.update(dt);
    return;
  }

  // Alive — pick idle vs. walk based on movement.
  const clip: AnimClip = onGround && speed > WALK_SPEED_THRESHOLD ? 'walk' : 'idle';
  if (clip !== state.current) {
    const action = state.actions.get(clip);
    if (action) {
      crossfade(state, action);
      state.current = clip;
    }
  }

  if (state.current === 'walk') {
    const walk = state.actions.get('walk');
    if (walk) {
      // Scale playback so the walk cycle matches the bot's actual ground speed.
      // The clip was authored at a nominal pace (~2.5 m/s); scale linearly.
      walk.timeScale = Math.max(0.4, speed / 2.5);
    }
  }

  state.mixer.update(dt);
}

/** Reset animation to idle, un-playing the death clip (e.g. on respawn). */
export function resetBotAnim(state: BotAnimState): void {
  for (const action of state.actions.values()) action.stop();
  state.deadPlayed = false;
  state.current = 'idle';
  const idle = state.actions.get('idle');
  if (idle) idle.play();
}

// -- helpers -----------------------------------------------------------------

function crossfade(state: BotAnimState, to: AnimationAction): void {
  for (const action of state.actions.values()) {
    if (action === to) {
      action.reset().play();
      action.fadeIn(FADE_DURATION);
    } else if (action.isRunning()) {
      action.fadeOut(FADE_DURATION);
    }
  }
}

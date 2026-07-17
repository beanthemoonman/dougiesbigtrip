/**
 * Deterministic recoil — doc/weapon-feel.md §3. Pure state machine, no world,
 * no rng (the random spread disc is a separate concern, applied at trace time).
 *
 * Per shot: advance sprayIndex, add that pattern step to the accumulated view
 * punch. On no-fire: after `resetTime` the index resets to 0; the accumulated
 * punch always decays back toward zero over ~`recoverTime`.
 *
 * The caller applies `state.punch` to the view angles and traces along the new
 * direction — recoil moves the view, the bullet follows it.
 */
import type { WeaponDef } from './defs';

export interface RecoilState {
  sprayIndex: number; // next pattern step to fire; -1 = fresh (nothing fired yet)
  timeSinceShot: number; // s
  punch: { yaw: number; pitch: number }; // rad, accumulated, decaying toward 0
}

export function createRecoilState(): RecoilState {
  return { sprayIndex: -1, timeSinceShot: 0, punch: { yaw: 0, pitch: 0 } };
}

/**
 * Register a shot. Advances the spray index (clamped to the last step for long
 * sprays) and adds its punch. Returns nothing — mutates `state`; read
 * `state.punch` for the new view offset.
 */
export function onShot(state: RecoilState, weapon: WeaponDef): void {
  const pattern = weapon.recoil.pattern;
  state.sprayIndex = Math.min(state.sprayIndex + 1, pattern.length - 1);
  const step = pattern[state.sprayIndex];
  if (step === undefined) return; // index clamped in [0, len-1]; empty pattern only
  state.punch.yaw += step.yaw;
  state.punch.pitch += step.pitch;
  state.timeSinceShot = 0;
}

/**
 * Advance recovery by one fixed step. Resets the spray index after `resetTime`
 * of no fire and exponentially decays the accumulated punch toward zero with a
 * time constant of `recoverTime`.
 */
export function tickRecoil(state: RecoilState, weapon: WeaponDef, dt: number): void {
  state.timeSinceShot += dt;
  if (state.timeSinceShot >= weapon.recoil.resetTime) state.sprayIndex = -1;

  // ponytail: exponential decay (framerate-independent at fixed dt); swap for a
  // spring if the snap-back ever needs overshoot.
  const k = Math.exp(-dt / weapon.recoil.recoverTime);
  state.punch.yaw *= k;
  state.punch.pitch *= k;
}

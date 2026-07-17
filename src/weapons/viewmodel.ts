/**
 * Procedural viewmodel animation — docs/weapon-feel.md §1 lists idle / fire /
 * reload / draw / holster. The weapon models have no armature (they're static
 * greybox meshes), so these are pose *offsets* computed here and added to the
 * gun's rest pose each frame, not skeletal clips.
 *
 * draw / reload / holster are discrete timed states. `fire` is modelled as an
 * additive decaying kick layered over whatever state is active — that's how
 * real FPS do it (you can fire mid-anything), and it keeps full-auto smooth
 * instead of restarting a discrete 'fire' state every 100 ms.
 *
 * Pure and clock-free: ticked at the fixed sim rate, no Date.now/random.
 */
import type { WeaponId } from './defs';

export type AnimState = 'draw' | 'idle' | 'reload' | 'holster';

/** Offset added to the weapon's rest pose. Metres for x/y/z, radians for angles. */
export interface AnimPose {
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
}

export interface ViewmodelAnim {
  state: AnimState;
  t: number; // s into the current timed state
  duration: number; // s of the current timed state
  fireKick: number; // 0..1, decaying firing impulse (additive)
  next: WeaponId | null; // weapon to equip when a holster completes
}

const DRAW_TIME = 0.4;
const HOLSTER_TIME = 0.22;
// The tucked pose the gun animates from on draw / to on holster.
const LOWERED_Y = -0.28;
const LOWERED_PITCH = -0.7;
const FIRE_KICK_TAU = 0.045; // s, exponential decay of the firing impulse

export function createViewmodelAnim(): ViewmodelAnim {
  return { state: 'draw', t: 0, duration: DRAW_TIME, fireKick: 0, next: null };
}

export function beginDraw(a: ViewmodelAnim): void {
  a.state = 'draw';
  a.t = 0;
  a.duration = DRAW_TIME;
  a.next = null;
}

export function beginReload(a: ViewmodelAnim, reloadTime: number): void {
  a.state = 'reload';
  a.t = 0;
  a.duration = reloadTime;
}

export function beginHolster(a: ViewmodelAnim, next: WeaponId): void {
  a.state = 'holster';
  a.t = 0;
  a.duration = HOLSTER_TIME;
  a.next = next;
}

export function onFire(a: ViewmodelAnim): void {
  a.fireKick = Math.min(1, a.fireKick + 0.85);
}

/**
 * Advance one fixed tick. Returns the weapon to equip if a holster JUST
 * completed this tick (caller swaps the model + weapon state, then calls
 * beginDraw), otherwise null.
 */
export function tickViewmodelAnim(a: ViewmodelAnim, dt: number): WeaponId | null {
  a.fireKick *= Math.exp(-dt / FIRE_KICK_TAU);
  if (a.state === 'idle') return null;

  a.t += dt;
  if (a.t < a.duration) return null;

  if (a.state === 'holster') {
    const next = a.next;
    a.next = null;
    return next; // caller performs the swap + beginDraw
  }
  a.state = 'idle';
  a.t = a.duration;
  return null;
}

const smoothstep = (p: number): number => {
  const c = Math.min(1, Math.max(0, p));
  return c * c * (3 - 2 * c);
};

/** Current pose offset for this frame. Writes into `out` (no allocation). */
export function viewmodelPose(a: ViewmodelAnim, out: AnimPose): AnimPose {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.pitch = 0;
  out.roll = 0;

  if (a.state === 'draw') {
    const k = 1 - smoothstep(a.t / a.duration); // lowered -> rest
    out.y = LOWERED_Y * k;
    out.pitch = LOWERED_PITCH * k;
  } else if (a.state === 'holster') {
    const k = smoothstep(a.t / a.duration); // rest -> lowered
    out.y = LOWERED_Y * k;
    out.pitch = LOWERED_PITCH * k;
  } else if (a.state === 'reload') {
    const bump = Math.sin(Math.min(1, a.t / a.duration) * Math.PI); // 0 -> 1 -> 0
    out.y = -0.1 * bump;
    out.pitch = -0.75 * bump;
    out.roll = 0.35 * bump;
  }

  // Additive fire kick: the gun recoils back toward the eye (+z) and muzzle-up.
  out.z += 0.05 * a.fireKick;
  out.y += 0.015 * a.fireKick;
  out.pitch += 0.22 * a.fireKick;
  return out;
}

/**
 * Bot aim: a turn-rate-capped tracker. Given where the bot currently looks and
 * where it wants to look, it rotates the view toward the target by at most
 * `turnRate * dt` per tick — it NEVER snaps. Snapping reads as an aimbot and
 * isn't fun (docs, plan Phase 4).
 *
 * Pure and rng-free: reaction delay and aim error live in the FSM, which owns
 * the seeded rng. This module is just the geometry of turning your head.
 */
import { Vector3 } from 'three';
import { PLAYER_RADIUS } from '../player/constants';

/**
 * Does a bot's shot land? A per-shot angular miss (`spread` rad, sampled from two
 * uniform [0,1) values) is projected onto the target plane; the shot connects only
 * if it falls within the target's body radius. Distance-scaled by construction:
 * lethal point-blank, increasingly sprayable with range. This is what gates bot
 * damage — without it every on-target tick was a guaranteed chest hit (an aimbot).
 */
export function botShotLands(
  distM: number,
  spread: number,
  r1: number,
  r2: number,
  bodyRadius: number = PLAYER_RADIUS,
): boolean {
  const ax = (r1 - 0.5) * 2 * spread;
  const ay = (r2 - 0.5) * 2 * spread;
  return distM * Math.hypot(ax, ay) <= bodyRadius;
}

export interface AimState {
  yaw: number;
  pitch: number;
}

/** Shortest signed angular difference from `a` to `b`, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Step `current` toward `target` by at most `maxStep` (>= 0), shortest way round. */
export function stepAngle(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

const dir = new Vector3();

/** The exact yaw/pitch to look from `fromEye` at `target` (matches aimDirection). */
export function desiredYawPitch(fromEye: Vector3, target: Vector3, out: AimState): AimState {
  dir.subVectors(target, fromEye).normalize();
  // forward = (-sinYaw·cosPitch, sinPitch, -cosYaw·cosPitch) → invert:
  out.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  out.yaw = Math.atan2(-dir.x, -dir.z);
  return out;
}

/**
 * Rotate `aim` toward (`desiredYaw`, `desiredPitch`), capped to `turnRate` rad/s.
 * Mutates and returns `aim`.
 */
export function stepAim(
  aim: AimState,
  desiredYaw: number,
  desiredPitch: number,
  turnRate: number,
  dt: number,
): AimState {
  const maxStep = turnRate * dt;
  aim.yaw = stepAngle(aim.yaw, desiredYaw, maxStep);
  aim.pitch = stepAngle(aim.pitch, desiredPitch, maxStep);
  return aim;
}

/** True once the view is within `tol` rad of the desired angles on both axes. */
export function onTarget(aim: AimState, desiredYaw: number, desiredPitch: number, tol: number): boolean {
  return Math.abs(angleDelta(aim.yaw, desiredYaw)) <= tol && Math.abs(aim.pitch - desiredPitch) <= tol;
}

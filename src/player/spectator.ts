/**
 * Dead-player free-fly spectator camera. Pure integration of a noclip position
 * from WASD + the current look angles, at the fixed sim rate. No collision — a
 * spectator flies through walls. Kept out of main.ts so the vector math has a
 * unit test.
 */
import type { Vector3 } from 'three';
import { Buttons } from '../core/input';

/** Metres per second the free-fly cam moves. */
export const SPEC_SPEED = 8;

/**
 * Advance `pos` in place by one tick of WASD free-fly. Forward follows the full
 * look direction (yaw + pitch, so W climbs when you look up); strafe is
 * horizontal. JUMP/DUCK raise/lower. Diagonals aren't normalised — matches the
 * raw feel of a noclip cam and it's a spectator, not a scored mover.
 */
export function moveSpectator(
  pos: Vector3,
  buttons: number,
  yaw: number,
  pitch: number,
  dt: number,
  speed = SPEC_SPEED,
): void {
  const step = speed * dt;
  const cosP = Math.cos(pitch);
  // forward at yaw θ is (-sinθ, -cosθ) horizontally (matches camera.ts); pitch
  // tilts it vertically. ponytail: +pitch looks up here → +y forward; flip the
  // sign of fy if the look feels inverted in-game.
  const fx = -Math.sin(yaw) * cosP;
  const fz = -Math.cos(yaw) * cosP;
  const fy = Math.sin(pitch);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  if (buttons & Buttons.FORWARD) { pos.x += fx * step; pos.y += fy * step; pos.z += fz * step; }
  if (buttons & Buttons.BACK) { pos.x -= fx * step; pos.y -= fy * step; pos.z -= fz * step; }
  if (buttons & Buttons.RIGHT) { pos.x += rx * step; pos.z += rz * step; }
  if (buttons & Buttons.LEFT) { pos.x -= rx * step; pos.z -= rz * step; }
  if (buttons & Buttons.JUMP) pos.y += step;
  if (buttons & Buttons.DUCK) pos.y -= step;
}

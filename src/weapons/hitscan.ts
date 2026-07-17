/**
 * The shot pipeline — doc/weapon-feel.md §§3–6. Ties the previously-standalone
 * pure pieces together: fire-rate + ammo gating (this file), deterministic
 * recoil (recoil.ts), the random spread disc (spread.ts + core rng), producing
 * the final world-space ray direction that a hitscan trace follows.
 *
 * Everything here is pure given an injected Rng — no world, no clock. The
 * world raycast + per-bone hitbox query is deliberately NOT here: it needs the
 * character rig (Phase 3). This file gets you from "trigger pulled" to "the
 * exact direction the bullet travels", which is the part that has to be
 * deterministic and testable.
 *
 * Aim convention: yaw +right, pitch +up, both radians. Forward at yaw=pitch=0
 * is -Z (three.js camera-forward). Y is up.
 */
import { Vector3 } from 'three';
import type { WeaponDef } from './defs';
import { computeSpread, type Stance } from './spread';
import { createRecoilState, onShot, tickRecoil, type RecoilState } from './recoil';
import type { Rng } from '../core/rng';

export interface WeaponState {
  ammo: number;
  timeSinceFire: number; // s; gates fire rate
  reloading: boolean;
  reloadRemaining: number; // s left in the current reload, 0 if not reloading
  recoil: RecoilState;
}

export function createWeaponState(weapon: WeaponDef): WeaponState {
  return {
    ammo: weapon.mag,
    timeSinceFire: weapon.fireInterval, // ready to fire immediately
    reloading: false,
    reloadRemaining: 0,
    recoil: createRecoilState(),
  };
}

/** True if a shot would come out this tick (ammo, cadence, not mid-reload). */
export function canFire(state: WeaponState, weapon: WeaponDef): boolean {
  return !state.reloading && state.ammo > 0 && state.timeSinceFire >= weapon.fireInterval;
}

export function startReload(state: WeaponState, weapon: WeaponDef): void {
  if (state.reloading || state.ammo >= weapon.mag) return;
  state.reloading = true;
  state.reloadRemaining = weapon.reloadTime;
}

/**
 * Advance one fixed tick: fire-rate timer, recoil recovery, and reload
 * progress. Call every sim tick regardless of input.
 */
export function tickWeapon(state: WeaponState, weapon: WeaponDef, dt: number): void {
  state.timeSinceFire += dt;
  tickRecoil(state.recoil, weapon, dt);
  if (state.reloading) {
    state.reloadRemaining -= dt;
    if (state.reloadRemaining <= 0) {
      state.reloading = false;
      state.reloadRemaining = 0;
      state.ammo = weapon.mag; // simple full-mag reload (no CS partial-mag carry — cut scope)
    }
  }
}

// Forward basis at zero angles is -Z; right is +X, up is +Y. Scratch reused per
// call — the hot loop fires at most once per tick, but no reason to allocate.
const scratchRight = new Vector3();
const scratchUp = new Vector3();

/** Unit aim direction for view angles (yaw +right about Y, pitch +up). */
export function aimDirection(yaw: number, pitch: number, out: Vector3): Vector3 {
  const cp = Math.cos(pitch);
  // Matches the camera's YXZ euler (camera.ts) and wishDirFromButtons (input.ts):
  // yaw=pitch=0 -> -Z; forward = (-sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)).
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();
}

/**
 * Perturb a unit direction within a cone of half-angle `spread` (rad), uniformly
 * over the disc (area-uniform, so no center bunching). Deterministic given `rng`.
 */
export function applySpread(dir: Vector3, spread: number, rng: Rng, out: Vector3): Vector3 {
  if (spread <= 0) return out.copy(dir);

  // Orthonormal basis perpendicular to dir. Pick a seed axis not parallel to dir.
  const seed = Math.abs(dir.y) < 0.99 ? scratchUp.set(0, 1, 0) : scratchUp.set(1, 0, 0);
  scratchRight.copy(seed).cross(dir).normalize(); // right ⟂ dir
  scratchUp.copy(dir).cross(scratchRight).normalize(); // up ⟂ dir, ⟂ right

  const theta = rng.next() * Math.PI * 2;
  const rho = spread * Math.sqrt(rng.next()); // sqrt → area-uniform disc
  const sinRho = Math.sin(rho);

  // dir tilted by rho toward (cosθ·right + sinθ·up).
  out.copy(dir).multiplyScalar(Math.cos(rho));
  out.addScaledVector(scratchRight, Math.cos(theta) * sinRho);
  out.addScaledVector(scratchUp, Math.sin(theta) * sinRho);
  return out.normalize();
}

export interface Shot {
  direction: Vector3; // unit world-space ray direction the bullet follows
  sprayIndex: number; // spray step this shot fired at (for crosshair/debug)
}

/**
 * Fire one shot if allowed. Advances recoil, applies the recoil punch to the
 * view, then perturbs by the stance/spray-dependent spread disc. Consumes a
 * round. Returns the shot's world ray direction, or null if it couldn't fire.
 *
 * ponytail: this shot fires along a view that already includes its own recoil
 * step (onShot before aim). Close enough to CS and keeps the state monotone;
 * split into pre/post-punch only if a golden trace ever demands it.
 */
export function fireShot(
  state: WeaponState,
  weapon: WeaponDef,
  viewYaw: number,
  viewPitch: number,
  stance: Stance,
  rng: Rng,
  out: Vector3,
): Shot | null {
  if (!canFire(state, weapon)) return null;

  onShot(state.recoil, weapon);
  state.ammo -= 1;
  state.timeSinceFire = 0;

  // Sign flip is load-bearing: defs.ts authors pattern yaw as +right, but view
  // yaw is +left (aimDirection: +yaw swings toward -X). Without this the AK's
  // 8-12 "pull left" phase pulls right and the whole pattern is mirrored.
  const yaw = viewYaw - state.recoil.punch.yaw;
  const pitch = viewPitch + state.recoil.punch.pitch;
  aimDirection(yaw, pitch, out);

  const spread = computeSpread(weapon, stance, state.recoil.sprayIndex);
  applySpread(out, spread, rng, out);

  return { direction: out, sprayIndex: state.recoil.sprayIndex };
}

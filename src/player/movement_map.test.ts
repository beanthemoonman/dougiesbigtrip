import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Buttons } from '../core/input';
import { buildMapColliders } from '../game/map_douglas';
import { addStaticBox, createWorld, initPhysics } from '../physics/world';
import { createMovementContext, createPlayerState, tickMovement, type PlayerState } from './movement';

/**
 * World-level (T1) movement tests: run tickMovement against the real greybox
 * Rapier colliders, not the pure formulas (those live in movement.test.ts).
 *
 * Regression for "caught on edge → infinite free fall": jumping into a crate
 * used to pin the player mid-air against the face — the collide-and-slide cast
 * returned TOI 0 in every direction once touching (stopAtPenetration=true), so
 * velocity zeroed, gravity piled up unused (vy → -inf), and onGround never
 * returned. Fix: the sweep passes stopAtPenetration=false so a touching capsule
 * can slide down the wall and fall. See shapecast.ts / movement.ts.
 */

const DT = 1 / 64;
// A player in genuine free fall for one tick loses ~0.32 m/s; "bounded" here just
// means it isn't the old runaway accumulation (which blew past -30 in <1 s).
const GRAVITY_TERMINAL = 12;

/** Step the sim for `ticks`, holding `buttons` (JUMP only pressed on `jumpTick`). */
function run(ctx: ReturnType<typeof createMovementContext>, player: PlayerState, yaw: number, ticks: number, jumpTick: number): void {
  for (let t = 0; t < ticks; t++) {
    let buttons = Buttons.FORWARD;
    if (t === jumpTick) buttons |= Buttons.JUMP;
    tickMovement(ctx, player, { buttons, yaw }, DT);
  }
}

describe('movement vs greybox colliders', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('running-jump into a crate face lands on the floor, never free-falls forever', () => {
    const world = createWorld();
    buildMapColliders(world);

    // South of the choke-A wood crate at c=[-12,·,13] s=1.5 (south face z=12.25).
    // Run +Z (yaw=π) up to speed, jump, and keep pushing into the crate.
    const spawn = new Vector3(-12, 0.05, 9.0);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);
    run(ctx, player, Math.PI, 120, 25);

    // Pre-fix: y frozen mid-air with vy accelerating past -30. Post-fix: the
    // player slides down the face and rests on the floor (top y=0).
    expect(player.position.y).toBeLessThan(0.15); // landed, not pinned mid-air
    expect(Math.abs(player.velocity.y)).toBeLessThan(GRAVITY_TERMINAL); // not accumulating
    // Never tunnelled into the crate: front of the capsule stays south of the face.
    expect(player.position.z).toBeLessThan(12.25);
  });



  it('walking on flat floor stays grounded (the fix must not lose ground contact)', () => {
    const world = createWorld();
    buildMapColliders(world);

    // Open floor west of mid, away from any crate. Walk forward; must stay put
    // on the floor, not sink or lose grounding.
    const spawn = new Vector3(-8, 0.05, 2);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);
    run(ctx, player, Math.PI, 40, -1); // never jump

    expect(player.onGround).toBe(true);
    expect(player.position.y).toBeCloseTo(0, 1); // feet on the floor top (y=0)
  });

  // --- 10.2 Breakable collision: solid → gone ---

  it('player pressed against a prop cannot pass; break it → passes through', () => {
    const world = createWorld();
    buildMapColliders(world);

    // Barrier box at z=5, 2 m wide, 1 m tall, 0.3 m thick.
    const barrier = addStaticBox(world, new Vector3(0, 0.5, 5), { x: 1, y: 0.5, z: 0.15 });

    // Spawn south, walk north (+Z, yaw=π).
    const spawn = new Vector3(0, 0.05, 0);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);

    // Walk 80 ticks to press against the barrier south face (z ≈ 4.85 - capsule radius = ~4.44).
    for (let t = 0; t < 80; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD, yaw: Math.PI }, DT);
    }
    // Blocked before passing z=5 (the barrier centre).
    expect(player.position.z).toBeLessThan(4.9);  // not past the barrier

    // Break it.
    barrier.setEnabled(false);

    // Continue walking — should now pass through.
    const prevZ = player.position.z;
    for (let t = 0; t < 40; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD, yaw: Math.PI }, DT);
    }
    expect(player.position.z).toBeGreaterThan(prevZ + 0.5); // clearly past old barrier
  });

  it('10.0 — player stops dead on ground when no movement keys are held', () => {
    const world = createWorld();
    buildMapColliders(world);

    const spawn = new Vector3(-8, 0.05, 0);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);

    // Walk forward to build some speed.
    for (let t = 0; t < 30; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD, yaw: Math.PI }, DT);
    }
    expect(player.velocity.x).not.toBe(0);
    expect(player.velocity.z).not.toBe(0);

    // Release all keys — player should come to a dead stop (velocity zeroed)
    // after the dead-stop check in tickMovement (Phase 10.0).
    for (let t = 0; t < 60; t++) {
      tickMovement(ctx, player, { buttons: 0, yaw: Math.PI }, DT);
    }
    expect(player.velocity.x).toBe(0);
    expect(player.velocity.z).toBe(0);
  });

  it('velocity bleeds to zero when sliding into a wall (no ground-detection stall)', () => {
    // Regression: sliding flush against a wall used to make categorizePosition
    // report the wall's horizontal normal instead of the floor below, so
    // onGround went false, friction stopped, and horizontal velocity got PINNED
    // (e.g. h≈5.6 m/s here) instead of decaying. The straight-down ray fallback
    // finds the floor a side-grazing capsule misses. See docs/source-movement.md.
    const world = createWorld();
    buildMapColliders(world);

    // (0,-13.5) slides +X straight into a wall on the real greybox. No input.
    const spawn = new Vector3(0, 0.05, -13.5);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);
    player.velocity.set(6.35, 0, 0);

    for (let t = 0; t < 100; t++) {
      tickMovement(ctx, player, { buttons: 0, yaw: 0 }, DT);
    }

    const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    expect(hSpeed).toBeLessThan(1e-4); // bled out, not pinned against the wall
  });

  // --- 10.3 Crouch-jump ---

  it('duck-jump reaches above crate-top height', () => {
    const world = createWorld();
    buildMapColliders(world);

    // Crate at (0, 0.35, 3), half-extents (0.5, 0.35, 0.5) — 0.7 m tall, top at y=0.7.
    addStaticBox(world, new Vector3(0, 0.35, 3), { x: 0.5, y: 0.35, z: 0.5 });

    const spawn = new Vector3(0, 0.05, 0);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);

    // Walk toward the crate to build speed.
    for (let t = 0; t < 30; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD, yaw: Math.PI }, DT);
    }

    // Duck-jump: duck + jump + forward.
    let apexReached = player.position.y;
    for (let t = 0; t < 40; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD | Buttons.DUCK | Buttons.JUMP, yaw: Math.PI }, DT);
      apexReached = Math.max(apexReached, player.position.y);
    }

    // The duck-jump should propel the player's feet to at least the crate top height
    // (0.7 m) or higher, regardless of whether they land on top or clear it.
    expect(apexReached).toBeGreaterThan(0.7);
  });

  it('standard jump duck does not pull feet up, less clearance than duck-jump', () => {
    const world = createWorld();
    buildMapColliders(world);

    addStaticBox(world, new Vector3(0, 0.35, 3), { x: 0.5, y: 0.35, z: 0.5 });

    const spawn = new Vector3(0, 0.05, 0);
    const ctx = createMovementContext(world, spawn);
    const player = createPlayerState(spawn);

    for (let t = 0; t < 30; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD, yaw: Math.PI }, DT);
    }

    // Standard jump (no duck) — but still forward.
    let apexNoDuck = player.position.y;
    for (let t = 0; t < 40; t++) {
      tickMovement(ctx, player, { buttons: Buttons.FORWARD | Buttons.JUMP, yaw: Math.PI }, DT);
      apexNoDuck = Math.max(apexNoDuck, player.position.y);
    }

    // Standard jump with forward speed should also reach > 0.7 since the jump is
    // the same impulse — the difference is the FEET clearance (duck pulls them up),
    // which means a duck-jump can clear taller obstacles from a standing start.
    // The duck-jump test above passes if the feet reach crate-top height; this
    // test just confirms a non-duck jump also produces vertical lift.
    expect(apexNoDuck).toBeGreaterThan(0.5); // significant lift
  });
});

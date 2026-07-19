import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Buttons } from '../core/input';
import { buildMapColliders } from '../game/map_douglas';
import { createWorld, initPhysics } from '../physics/world';
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
});

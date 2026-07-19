import { Vector3 } from 'three';
import type { InputTrace } from '../../src/core/trace_recorder';
import { createWorld, initPhysics } from '../../src/physics/world';
import { buildMapColliders } from '../../src/game/map_douglas';
import {
  createMovementContext,
  createPlayerState,
  tickMovement,
} from '../../src/player/movement';

// Re-export so tests don't need two separate imports.
export type { TraceTick } from '../../src/core/trace_recorder';

const DT = 1 / 64;

/** The flattened result of replaying a trace. All primitives so toEqual works. */
export interface SimResult {
  position: readonly [number, number, number];
  velocity: readonly [number, number, number];
  tick: number;
}

const spawn = new Vector3();
const posTuple = (v: Vector3): readonly [number, number, number] => [v.x, v.y, v.z];
const velTuple = (v: Vector3): readonly [number, number, number] => [v.x, v.y, v.z];

/**
 * Headless, deterministic replay of a movement input trace against the
 * de_douglas collision geometry at 64 Hz.
 *
 * initPhysics() is idempotent — the Rapier WASM is loaded once and reused
 * across all simulate() calls within a test run.
 */
export async function simulate(
  trace: InputTrace,
  spawnPoint?: readonly [number, number, number],
): Promise<SimResult> {
  await initPhysics();
  const world = createWorld();
  buildMapColliders(world);

  if (spawnPoint) spawn.set(spawnPoint[0], spawnPoint[1], spawnPoint[2]);
  else spawn.set(0, 0.05, 0);

  const ctx = createMovementContext(world, spawn);
  const player = createPlayerState(spawn);

  for (const t of trace.ticks) {
    tickMovement(ctx, player, { buttons: t.buttons, yaw: t.yaw }, DT);
  }

  return {
    position: posTuple(player.position),
    velocity: velTuple(player.velocity),
    tick: trace.ticks.length,
  };
}

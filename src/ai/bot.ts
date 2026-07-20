/**
 * A bot is a second player: its movement runs in the shared WASM sim (exactly
 * the same tick_movement as the human), and only differs in where its input comes
 * from — it synthesises `wishdir` (as a yaw) and buttons instead of reading a
 * keyboard. This is deliberate and load-bearing: bots inherit the Source feel,
 * accel, friction, step-offset and all, for free. Do not give bots a bespoke
 * mover.
 *
 * Phase 6.2: the bot's kinematic body in the TS Rapier world is kept only for
 * hit-detection/perception (weapon hits, canSee raycasts). Movement physics lives
 * entirely in the WASM sim crate now.
 */
import type { World } from '@dimforge/rapier3d-compat';
import type { Collider } from '@dimforge/rapier3d-compat';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Buttons } from '../core/input';
import { PLAYER_RADIUS, STANDING_HALF_HEIGHT } from '../player/constants';
import { createKinematicCapsule } from '../physics/world';
import { findPath, type Nav } from './nav';

/** Within this horizontal distance a waypoint counts as reached (m). */
const WAYPOINT_RADIUS = 0.6;

export interface Bot {
  /** Current WASM-sim position (feet). Sync'd from sim_get_state each tick. */
  position: Vector3;
  /** Current WASM-sim velocity. Sync'd each tick. */
  velocity: Vector3;
  onGround: boolean;
  eyeHeight: number;
  duckAmount: number;
  /** Kinematic body collider in the TS Rapier world — exists solely for
   *  hit-detection raycasts and perception (canSee). Position must be kept in
   *  sync with `position` after each WASM tick. */
  collider: Collider;
  /** Kinematic rigid body the collider is attached to — must be synced
   *  alongside the collider so updateSceneQueries() sees the correct position
   *  (BVH reads from body transforms, not collider transforms). */
  body: RigidBody;
  /** Index into the WASM SIM's player vector (0 = human, 1+ = bots). */
  wasmIndex: number;
  /** Smoothed nav corridor being followed; empty = no goal, stand still. */
  path: Vector3[];
  /** Index of the waypoint currently being walked toward. */
  waypoint: number;
  /** Facing, radians. Steers toward the current waypoint; also the aim yaw. */
  yaw: number;
}

export function createBot(world: World, spawn: Vector3, wasmIndex: number): Bot {
  const centerY = spawn.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS;
  const center = new Vector3(spawn.x, centerY, spawn.z);
  const { body, collider } = createKinematicCapsule(world, center, STANDING_HALF_HEIGHT, PLAYER_RADIUS);
  return {
    position: spawn.clone(),
    velocity: new Vector3(),
    onGround: false,
    eyeHeight: 1.64, // EYE_HEIGHT_STANDING
    duckAmount: 0,
    collider,
    body,
    wasmIndex,
    path: [],
    waypoint: 0,
    yaw: 0,
  };
}

/** Point the bot at `target`: compute + follow a fresh nav corridor to it. */
export function setGoal(bot: Bot, nav: Nav, target: Vector3): void {
  bot.path = findPath(nav, bot.position, target);
  bot.waypoint = 0;
}

/** True once the bot has consumed every waypoint (reached its goal). */
export function atGoal(bot: Bot): boolean {
  return bot.waypoint >= bot.path.length;
}

const toWaypoint = new Vector3();

/**
 * Synthesise input for one fixed-sim tick: steer toward the current waypoint
 * and return the buttons + yaw tuple that would be fed to tick_movement.
 * Movement is NOT applied here — the caller owns sim_tick(simIndex, buttons, yaw)
 * and then syncs the result back into `bot`.
 */
export function botInput(bot: Bot): { buttons: number; yaw: number } {
  let buttons = 0;

  while (bot.waypoint < bot.path.length) {
    const wp = bot.path[bot.waypoint];
    if (!wp) break;
    toWaypoint.set(wp.x - bot.position.x, 0, wp.z - bot.position.z);
    if (toWaypoint.lengthSq() > WAYPOINT_RADIUS * WAYPOINT_RADIUS) break;
    bot.waypoint++;
  }

  if (bot.waypoint < bot.path.length) {
    bot.yaw = Math.atan2(-toWaypoint.x, -toWaypoint.z);
    buttons |= Buttons.FORWARD;
  }

  return { buttons, yaw: bot.yaw };
}

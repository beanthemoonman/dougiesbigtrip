/**
 * A bot is a second player: it runs the EXACT same movement code
 * (tickMovement) as the human, and only differs in where its input comes from —
 * it synthesises `wishdir` (as a yaw) and buttons instead of reading a keyboard.
 * This is deliberate and load-bearing: bots inherit the Source feel, accel,
 * friction, step-offset and all, for free. Do not give bots a bespoke mover.
 */
import type { World } from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Buttons } from '../core/input';
import {
  createMovementContext,
  createPlayerState,
  tickMovement,
  type MovementContext,
  type PlayerState,
} from '../player/movement';
import { findPath, type Nav } from './nav';

/** Within this horizontal distance a waypoint counts as reached (m). */
const WAYPOINT_RADIUS = 0.6;

export interface Bot {
  readonly ctx: MovementContext;
  readonly state: PlayerState;
  /** Smoothed nav corridor being followed; empty = no goal, stand still. */
  path: Vector3[];
  /** Index of the waypoint currently being walked toward. */
  waypoint: number;
  /** Facing, radians. Steers toward the current waypoint; also the aim yaw. */
  yaw: number;
}

export function createBot(world: World, spawn: Vector3): Bot {
  return {
    ctx: createMovementContext(world, spawn),
    state: createPlayerState(spawn),
    path: [],
    waypoint: 0,
    yaw: 0,
  };
}

/** Point the bot at `target`: compute + follow a fresh nav corridor to it. */
export function setGoal(bot: Bot, nav: Nav, target: Vector3): void {
  bot.path = findPath(nav, bot.state.position, target);
  bot.waypoint = 0;
}

/** True once the bot has consumed every waypoint (reached its goal). */
export function atGoal(bot: Bot): boolean {
  return bot.waypoint >= bot.path.length;
}

const toWaypoint = new Vector3();

/**
 * Advance one fixed sim tick: steer toward the current waypoint and run the
 * shared movement. Bots walk (no jump/bhop) — they synthesise only yaw + a
 * FORWARD press, exactly what the movement code expects from a keyboard.
 */
export function tickBot(bot: Bot, dt: number): void {
  let buttons = 0;

  // Skip any waypoints already reached (start point, or if we overshot).
  while (bot.waypoint < bot.path.length) {
    const wp = bot.path[bot.waypoint];
    if (!wp) break;
    toWaypoint.set(wp.x - bot.state.position.x, 0, wp.z - bot.state.position.z);
    if (toWaypoint.lengthSq() > WAYPOINT_RADIUS * WAYPOINT_RADIUS) break;
    bot.waypoint++;
  }

  if (bot.waypoint < bot.path.length) {
    // Forward at yaw θ is (-sinθ, -cosθ) (core/input wishDirFromButtons), so to
    // walk toward (dx, dz) set yaw = atan2(-dx, -dz) and press FORWARD.
    bot.yaw = Math.atan2(-toWaypoint.x, -toWaypoint.z);
    buttons |= Buttons.FORWARD;
  }

  tickMovement(bot.ctx, bot.state, { buttons, yaw: bot.yaw }, dt);
}

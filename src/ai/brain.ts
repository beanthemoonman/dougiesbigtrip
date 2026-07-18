/**
 * Bot brain — the FSM that turns senses (perception.ts) + a path (nav.ts) + a
 * non-snapping aim (aim.ts) into behaviour, all driving the shared player
 * movement (bot.ts). States:
 *
 *   Patrol/Idle → Investigate → Engage → Reposition → (back) ; Dead is terminal.
 *
 * Engage stands and aims (Reposition does the moving), so bots don't run at you
 * spraying. Sight/LOS gates (perception) mean they lose you behind cover — that
 * plus a reaction delay + aim error + turn-rate cap is what makes them beatable
 * and not-free, never an aimbot. All randomness comes from the injected seeded
 * rng (determinism rule).
 */
import type { World } from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Rng } from '../core/rng';
import { EYE_HEIGHT_STANDING } from '../player/constants';
import { desiredYawPitch, onTarget, stepAim, type AimState } from './aim';
import { tickBot, type Bot } from './bot';
import { findPath, type Nav } from './nav';
import { canSee } from './perception';

export type BotMode = 'idle' | 'investigate' | 'engage' | 'reposition' | 'dead';

/** Per-difficulty aim/behaviour knobs. Lower = easier to beat. */
export interface Difficulty {
  /** Seconds after acquiring a target before the bot starts tracking/firing. */
  readonly reactionTime: number;
  /** Aim turn-rate cap, rad/s. */
  readonly turnRate: number;
  /** Aim scatter at the target, metres — bots miss by up to this. */
  readonly errorRadius: number;
  /** Give up chasing a lost target after this long in Reposition (s). */
  readonly loseMemory: number;
}

export const DIFFICULTIES: Record<'easy' | 'normal' | 'hard', Difficulty> = {
  easy: { reactionTime: 0.6, turnRate: 3.0, errorRadius: 0.6, loseMemory: 2 },
  normal: { reactionTime: 0.35, turnRate: 6.0, errorRadius: 0.3, loseMemory: 4 },
  hard: { reactionTime: 0.18, turnRate: 10.0, errorRadius: 0.12, loseMemory: 6 },
};

const FIRE_TOL = 0.05; // rad — aim must be within this cone of the target to fire

export interface BotBrain {
  readonly bot: Bot;
  readonly cfg: Difficulty;
  mode: BotMode;
  aim: AimState;
  /** Counts down after acquiring; while > 0 the bot reacts but doesn't fire. */
  reactionTimer: number;
  /** Time since LOS was last lost while repositioning (s). */
  lostTimer: number;
  /** Last place the target was seen/heard; the goal when chasing. */
  lastKnown: Vector3 | null;
  /** Aim-error offset, resampled each time a target is acquired. */
  errorOffset: Vector3;
  /** Waypoints to wander when idle; cycled. Empty = stand still. */
  patrol: Vector3[];
  patrolIndex: number;
}

export function createBrain(bot: Bot, cfg: Difficulty, patrol: Vector3[] = []): BotBrain {
  return {
    bot,
    cfg,
    mode: 'idle',
    aim: { yaw: bot.yaw, pitch: 0 },
    reactionTimer: 0,
    lostTimer: 0,
    lastKnown: null,
    errorOffset: new Vector3(),
    patrol,
    patrolIndex: 0,
  };
}

/** Kill the bot: freeze it in the terminal Dead state. */
export function killBot(brain: BotBrain): void {
  brain.mode = 'dead';
}

/** A nearby sound (gunfire/footstep) the bot noticed — go look, unless engaged. */
export function hearSound(brain: BotBrain, at: Vector3): void {
  if (brain.mode === 'dead' || brain.mode === 'engage') return;
  brain.lastKnown = at.clone();
  brain.mode = 'investigate';
}

const eye = new Vector3();
const aimPoint = new Vector3();
const desired: AimState = { yaw: 0, pitch: 0 };

function acquire(brain: BotBrain, rng: Rng, targetFeet: Vector3): void {
  brain.mode = 'engage';
  brain.reactionTimer = brain.cfg.reactionTime;
  brain.lastKnown = targetFeet.clone();
  // Resample aim error once per acquisition so it's steady during the burst,
  // not jittering every tick.
  const r = brain.cfg.errorRadius;
  brain.errorOffset.set((rng.next() - 0.5) * 2 * r, (rng.next() - 0.5) * 2 * r, (rng.next() - 0.5) * 2 * r);
}

/**
 * One AI tick. Perceives `targetFeet` (the player), updates the FSM, aims, and
 * drives movement. Returns whether the bot wants to fire this tick — the caller
 * owns the actual shot (hitscan/damage), so the FSM stays decoupled from combat.
 */
export function tickBrain(
  brain: BotBrain,
  world: World,
  nav: Nav,
  rng: Rng,
  targetFeet: Vector3,
  targetAlive: boolean,
  dt: number,
): { fire: boolean } {
  const { bot, cfg } = brain;
  if (brain.mode === 'dead') return { fire: false };

  const sees =
    targetAlive && canSee(world, bot.state.position, brain.aim.yaw, targetFeet, bot.ctx.collider);

  let fire = false;

  switch (brain.mode) {
    case 'idle':
    case 'investigate':
    case 'reposition': {
      if (sees) {
        acquire(brain, rng, targetFeet);
      } else if (brain.mode === 'reposition') {
        brain.lostTimer += dt;
        if (brain.lostTimer >= cfg.loseMemory) brain.mode = 'idle';
      }
      break;
    }
    case 'engage': {
      if (sees) {
        brain.lastKnown = targetFeet.clone();
      } else {
        // Lost LOS — go to where they were last seen.
        brain.mode = 'reposition';
        brain.lostTimer = 0;
      }
      break;
    }
    default:
      break;
  }

  // --- Act on the (possibly new) mode ---
  if (brain.mode === 'engage') {
    // Stand and aim: clear any movement goal so tickBot presses nothing.
    bot.path = [];
    bot.waypoint = 0;
    eye.set(bot.state.position.x, bot.state.position.y + EYE_HEIGHT_STANDING, bot.state.position.z);
    aimPoint.copy(targetFeet).add(brain.errorOffset);
    aimPoint.y += EYE_HEIGHT_STANDING;
    desiredYawPitch(eye, aimPoint, desired);
    if (brain.reactionTimer > 0) {
      brain.reactionTimer -= dt;
    } else {
      stepAim(brain.aim, desired.yaw, desired.pitch, cfg.turnRate, dt);
      fire = onTarget(brain.aim, desired.yaw, desired.pitch, FIRE_TOL);
    }
    bot.yaw = brain.aim.yaw;
    tickBot(bot, dt);
    return { fire };
  }

  // Moving states: pick/refresh a goal, walk it, keep aim looking where we go.
  const goal = pickGoal(brain, nav);
  if (goal) {
    bot.path = goal;
    bot.waypoint = 0;
  }
  tickBot(bot, dt);
  brain.aim.yaw = bot.yaw; // aim follows movement facing while roaming
  return { fire: false };
}

/**
 * Choose where a non-engaged bot walks. Investigate/Reposition head to
 * lastKnown; idle cycles the patrol route (or stands if there is none). Returns
 * a fresh path only when one is needed, else null (keep walking the current one).
 */
function pickGoal(brain: BotBrain, nav: Nav): Vector3[] | null {
  const { bot } = brain;

  if ((brain.mode === 'investigate' || brain.mode === 'reposition') && brain.lastKnown) {
    if (bot.path.length === 0) {
      // No corridor yet — try to path to the last-known spot.
      const p = findPath(nav, bot.state.position, brain.lastKnown);
      if (p.length > 1) return p;
      // Can't reach it. Reposition holds its ground and lets lostTimer give up
      // (so it doesn't teleport back to idle the instant pathing fails);
      // Investigate has no such timer, so it shrugs and resumes idle.
      if (brain.mode === 'investigate') {
        brain.mode = 'idle';
        brain.lastKnown = null;
      }
      return null;
    }
    if (bot.waypoint >= bot.path.length) {
      // Arrived and still nothing → give up, resume idle.
      brain.mode = 'idle';
      brain.lastKnown = null;
    }
    return null;
  }

  // Idle: cycle patrol points, or stand.
  if (brain.patrol.length === 0) return null;
  if (bot.waypoint >= bot.path.length) {
    const next = brain.patrol[brain.patrolIndex % brain.patrol.length];
    brain.patrolIndex++;
    return next ? findPath(nav, bot.state.position, next) : null;
  }
  return null;
}

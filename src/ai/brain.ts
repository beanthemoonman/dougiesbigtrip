/**
 * Bot brain — the FSM that turns senses (perception.ts) + a path (nav.ts) + a
 * non-snapping aim (aim.ts) into behaviour, all driving the shared player
 * movement (bot.ts). States:
 *
 *   Search → Engage → Reposition → (back) ; Dead is terminal.
 *
 * Search replaces the old fixed patrol: bots pick nav-graph nodes that spread
 * the squad across the map (shared spec with the Rust server). Engage stands
 * and aims; Reposition paths to lastKnown via the nav graph.
 *
 * Phase 11: the shared goal-selection formula lives in navnodes.ts. Bots pick
 * the same node across ports; TS routes to it via recast findPath (smooth),
 * while the server routes via graph hops (exact).
 */
import type { World } from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import type { Rng } from '../core/rng';
import { EYE_HEIGHT_STANDING } from '../player/constants';
import { desiredYawPitch, onTarget, stepAim, type AimState } from './aim';
import { botInput, type Bot } from './bot';
import { Buttons } from '../core/input';
import { findPath, type Nav } from './nav';
import { canSee } from './perception';
import { NAVNODES, nearestNode, atNode, SearchScore } from './navnodes';

export type BotMode = 'search' | 'engage' | 'reposition' | 'dead';

export interface Difficulty {
  readonly reactionTime: number;
  readonly turnRate: number;
  readonly errorRadius: number;
  readonly loseMemory: number;
}

export const DIFFICULTIES: Record<'easy' | 'normal' | 'hard', Difficulty> = {
  easy: { reactionTime: 0.8, turnRate: 3.0, errorRadius: 0.6, loseMemory: 2 },
  normal: { reactionTime: 0.5, turnRate: 6.0, errorRadius: 0.3, loseMemory: 4 },
  hard: { reactionTime: 0.18, turnRate: 10.0, errorRadius: 0.12, loseMemory: 6 },
};

type CautionPhase = 'moving' | 'pausing';

const FIRE_TOL = 0.05;
const CAUTION_MOVE_TICKS = 64 * 5 / 2;
const CAUTION_PAUSE_TICKS = 64 * 3 / 2;
const CAUTION_JITTER = 64;
const SCAN_RATE = 1.0;
// In search mode, press FORWARD only 3 of every 4 ticks so bots roam at ~50-60%
// of ground speed — matches the server's SEARCH_DUTY (ai.rs).
const SEARCH_DUTY_ON = 3;
const SEARCH_DUTY_PERIOD = 4;

export interface BotBrain {
  readonly bot: Bot;
  readonly cfg: Difficulty;
  mode: BotMode;
  aim: AimState;
  reactionTimer: number;
  lostTimer: number;
  lastKnown: Vector3 | null;
  errorOffset: Vector3;
  pathGoalNode: number;
  currentNode: number;
  cautionTimer: number;
  cautionPhase: CautionPhase;
  /** Deterministic per-bot tick offset for de-synchronising caution timers. */
  readonly tickOffset: number;
}

export function createBrain(bot: Bot, cfg: Difficulty): BotBrain {
  const tickOffset = bot.wasmIndex * 17;
  const baseMove = CAUTION_MOVE_TICKS + (tickOffset % CAUTION_JITTER);
  // Start the goal at the bot's own node so pathGoalNode === currentNode on
  // tick 1 forces an immediate search re-pick (matches server Bot::new).
  const startNode = nearestNode(bot.position.x, bot.position.y, bot.position.z);
  return {
    bot,
    cfg,
    mode: 'search',
    aim: { yaw: bot.yaw, pitch: 0 },
    reactionTimer: 0,
    lostTimer: 0,
    lastKnown: null,
    errorOffset: new Vector3(),
    pathGoalNode: startNode,
    currentNode: startNode,
    cautionTimer: baseMove,
    cautionPhase: 'moving',
    tickOffset,
  };
}

export function killBot(brain: BotBrain): void {
  brain.mode = 'dead';
}

export function hearSound(brain: BotBrain, at: Vector3): void {
  if (brain.mode === 'dead' || brain.mode === 'engage') return;
  brain.lastKnown = at.clone();
  brain.mode = 'reposition';
  brain.lostTimer = 0;
}

const eye = new Vector3();
const aimPoint = new Vector3();
const desired: AimState = { yaw: 0, pitch: 0 };

export interface TickResult {
  fire: boolean;
  buttons: number;
  yaw: number;
}

function acquire(brain: BotBrain, rng: Rng, targetFeet: Vector3): void {
  brain.mode = 'engage';
  brain.reactionTimer = brain.cfg.reactionTime;
  brain.lastKnown = targetFeet.clone();
  const r = brain.cfg.errorRadius;
  brain.errorOffset.set(
    (rng.next() - 0.5) * 2 * r,
    (rng.next() - 0.5) * 2 * r,
    (rng.next() - 0.5) * 2 * r,
  );
}

export function tickBrain(
  brain: BotBrain,
  world: World,
  nav: Nav,
  rng: Rng,
  targetFeet: Vector3,
  targetAlive: boolean,
  dt: number,
  search?: SearchScore,
  teammateFeet?: readonly Vector3[],
  serverTick?: number,
  teammateGoals?: readonly number[],
): TickResult {
  const { bot, cfg } = brain;
  if (brain.mode === 'dead') return { fire: false, buttons: 0, yaw: bot.yaw };

  const sees =
    targetAlive && canSee(world, bot.position, brain.aim.yaw, targetFeet, bot.collider);

  let fire = false;

  // Update current node from position.
  brain.currentNode = nearestNode(bot.position.x, bot.position.y, bot.position.z);
  const reachedGoal = atNode(brain.pathGoalNode, bot.position.x, bot.position.y, bot.position.z);
  if (reachedGoal && brain.mode === 'search' && search) {
    // Arrival — lastVisited was already claimed on goal pick below.
  }

  switch (brain.mode) {
    case 'search':
    case 'reposition': {
      if (sees) {
        acquire(brain, rng, targetFeet);
      } else if (brain.mode === 'reposition') {
        brain.lostTimer += dt;
        const gaveUp = brain.lostTimer >= cfg.loseMemory;
        const arrived = brain.lastKnown
          ? (() => {
              const ln = nearestNode(brain.lastKnown.x, brain.lastKnown.y, brain.lastKnown.z);
              return brain.currentNode === ln ||
                atNode(ln, bot.position.x, bot.position.y, bot.position.z);
            })()
          : false;
        if (gaveUp || arrived) {
          brain.mode = 'search';
          brain.lastKnown = null;
        }
      }
      break;
    }
    case 'engage': {
      if (sees) {
        brain.lastKnown = targetFeet.clone();
      } else {
        brain.mode = 'reposition';
        brain.lostTimer = 0;
      }
      break;
    }
    default:
      break;
  }

  if (brain.mode === 'engage') {
    bot.path = [];
    bot.waypoint = 0;
    eye.set(bot.position.x, bot.position.y + EYE_HEIGHT_STANDING, bot.position.z);
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
    return { fire, buttons: 0, yaw: bot.yaw };
  }

  // Moving states: pick/refresh a goal, walk it.
  if (brain.mode === 'search') {
    // --- Caution: stop-and-scan rhythm ---
    brain.cautionTimer--;
    if (brain.cautionTimer <= 0) {
      if (brain.cautionPhase === 'moving') {
        brain.cautionPhase = 'pausing';
        brain.cautionTimer = CAUTION_PAUSE_TICKS + ((brain.tickOffset * 13) % CAUTION_JITTER);
      } else {
        brain.cautionPhase = 'moving';
        brain.cautionTimer = CAUTION_MOVE_TICKS + ((brain.tickOffset * 7) % CAUTION_JITTER);
      }
    }

    if (brain.cautionPhase === 'pausing') {
      const scanDir = ((Math.floor((serverTick ?? 0) + brain.tickOffset) / 128) % 2 === 0) ? 1 : -1;
      bot.yaw += scanDir * SCAN_RATE * dt;
      brain.aim.yaw = bot.yaw;
      return { fire: false, buttons: 0, yaw: bot.yaw };
    }
  }

  const goal = pickGoal(brain, nav, search, teammateFeet ?? [], serverTick ?? 0, teammateGoals);
  if (goal) {
    bot.path = goal;
    bot.waypoint = 0;
  }
  const input = botInput(bot);
  let buttons = input.buttons;
  if (brain.mode === 'search') {
    const allowMove =
      ((serverTick ?? 0) + brain.tickOffset) % SEARCH_DUTY_PERIOD < SEARCH_DUTY_ON;
    if (!allowMove) buttons &= ~Buttons.FORWARD;
  }
  brain.aim.yaw = bot.yaw;
  return { fire: false, buttons, yaw: input.yaw };
}

function pickGoal(
  brain: BotBrain,
  nav: Nav,
  search?: SearchScore,
  teammateFeet?: readonly Vector3[],
  serverTick?: number,
  teammateGoals?: readonly number[],
): Vector3[] | null {
  const { bot } = brain;

  if (brain.mode === 'reposition' && brain.lastKnown) {
    if (bot.path.length === 0) {
      const p = findPath(nav, bot.position, brain.lastKnown);
      if (p.length > 1) return p;
      brain.mode = 'search';
      brain.lastKnown = null;
      return null;
    }
    if (bot.waypoint >= bot.path.length) {
      brain.mode = 'search';
      brain.lastKnown = null;
    }
    return null;
  }

  if (brain.mode === 'search') {
    const reached = atNode(brain.pathGoalNode, bot.position.x, bot.position.y, bot.position.z)
      || brain.currentNode === brain.pathGoalNode;
    if (reached) {
      const teammateCoords: [number, number, number][] = (teammateFeet ?? []).map(
        (v) => [v.x, v.y, v.z] as [number, number, number],
      );
      const newGoal = (search ?? new SearchScore()).pickSearchNode(
        brain.currentNode,
        bot.position,
        serverTick ?? 0,
        teammateCoords,
        teammateGoals,
      );
      // Claim the node so the next bot picks a different one.
      if (search) search.lastVisited[newGoal] = serverTick ?? 0;
      brain.pathGoalNode = newGoal;
    }
    const node = NAVNODES.nodes[brain.pathGoalNode];
    if (node && bot.waypoint >= bot.path.length) {
      return findPath(nav, bot.position, new Vector3(node[0], node[1], node[2]));
    }
    return null;
  }

  return null;
}

/**
 * Navnodes: a hand-authored waypoint graph for the de_douglas map (Phase 11.0).
 * Single source of truth: assets/maps/de_douglas.navnodes.json, loaded by both
 * the Rust server (serde) and the TS client (import). The TS brain uses the
 * SAME goal-selection formula and weights as the server; pathing to the chosen
 * node is done via the existing recast findPath (better quality). Note the two
 * ports run independent sims (separate tick counters, separate physics), so the
 * selected goal matches by algorithm, not lockstep tick-for-tick.
 *
 * See docs/plan-phase11-bot-ai.md.
 */
import data from '../../assets/maps/de_douglas.navnodes.json';

export interface NavGraph {
  readonly nodes: readonly (readonly [number, number, number])[];
  readonly adj: readonly number[][];
  readonly nodeCount: number;
  readonly weights: readonly number[];
}

interface RawGraph {
  nodes: (readonly number[])[];
  edges: [number, number][];
}

function buildAdj(n: number, edges: [number, number][]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges!) {
    if (u! < n && v! < n) {
      adj[u!]!.push(v!);
      adj[v!]!.push(u!);
    }
  }
  return adj;
}

const raw = data as unknown as RawGraph;
const ADJ = buildAdj(raw.nodes.length, raw.edges);
const NODES: readonly (readonly [number, number, number])[] = raw.nodes.map(
  (v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] as const,
);
const WEIGHTS: readonly number[] = raw.nodes.map((v) => (v.length >= 4 ? (v[3] ?? 1.0) : 1.0));

export const NAVNODES: NavGraph = {
  nodes: NODES,
  adj: ADJ,
  get nodeCount() { return raw.nodes.length; },
  weights: WEIGHTS,
};

export function nearestNode(x: number, _y: number, z: number): number {
  let best = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < NAVNODES.nodes.length; i++) {
    const n = NAVNODES.nodes[i]!;
    const dx = n[0] - x;
    const dz = n[2] - z;
    const dsq = dx * dx + dz * dz;
    if (dsq < bestDistSq) {
      bestDistSq = dsq;
      best = i;
    }
  }
  return best;
}

export function atNode(nodeIdx: number, x: number, _y: number, z: number): boolean {
  const node = NAVNODES.nodes[nodeIdx];
  if (!node) return true;
  const dx = node[0] - x;
  const dz = node[2] - z;
  return dx * dx + dz * dz <= 0.6 * 0.6;
}

/**
 * Deterministic [0,1) hash of two u32s. Must produce bit-identical results in
 * `server/src/ai.rs::hash01` — it is what keeps the two ports picking the same
 * goal node while still looking random. Not an RNG: no stream, no state, so T1
 * replays stay exact.
 */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a >>> 0, 0x9e3779b1) ^ Math.imul(b >>> 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/** Per-node last-visited ticks for the search-spread formula. */
export class SearchScore {
  lastVisited: number[];
  visitRecencyTicks = 64 * 8;
  /** Same-pole repulsion: each teammate pushes on nearby nodes as 1/(1+d). */
  wRepel = 60.0;
  wRecency = 2.0;
  wTactical = 10.0;
  /** Jitter weight — ~3x the tactical spread (10x0.3..3): tactical nodes stay favoured, but low-weight ones still come up. */
  wRandom = 80.0;

  constructor() {
    this.lastVisited = new Array(NAVNODES.nodeCount).fill(0);
  }

  /** Tactical weight for a node (curve=high, spine=low), defaults to 1.0. */
  nodeWeight(idx: number): number {
    return (NAVNODES.weights as number[])[idx] ?? 1.0;
  }

  pickSearchNode(
    botNode: number,
    _botFeet: { x: number; y: number; z: number },
    serverTick: number,
    teammatePositions: readonly (readonly [number, number, number])[],
    teammateGoals?: readonly number[],
    seed = 0,
  ): number {
    const wGoalConflict = 20.0;
    let bestNode = botNode;
    let bestScore = -Infinity;

    for (let i = 0; i < NAVNODES.nodeCount; i++) {
      const n = NAVNODES.nodes[i];
      if (!n) continue;

      // Repulsion field rather than "distance to the nearest teammate": the old
      // min-distance term always crowned the single globally-farthest node, so
      // every bot ran the same route to the same corner.
      let repel = 0;
      for (const tp of teammatePositions) {
        const dx = n[0] - tp[0];
        const dz = n[2] - tp[2];
        repel += 1 / (1 + Math.sqrt(dx * dx + dz * dz));
      }

      const ticksSince = serverTick - (this.lastVisited[i] ?? 0);
      const recencyBonus = Math.min(ticksSince, this.visitRecencyTicks);

      const tactical = this.nodeWeight(i);

      let conflicts = 0;
      if (teammateGoals) {
        for (const g of teammateGoals) {
          if (g === i) conflicts++;
        }
      }

      const score = -this.wRepel * repel + this.wRecency * recencyBonus
        + this.wTactical * tactical - wGoalConflict * conflicts
        + this.wRandom * hash01(seed + serverTick, i);

      if (score > bestScore) {
        bestScore = score;
        bestNode = i;
      }
    }
    return bestNode;
  }
}

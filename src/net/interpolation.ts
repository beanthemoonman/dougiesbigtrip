/**
 * Client-side entity interpolation (docs/netcode.md §5.3).
 *
 * Buffers incoming Snapshots in a ring buffer. Each render frame we compute
 * renderTime = serverTime − interpDelay, find the two snapshots bracketing
 * that tick, and lerp pos/yaw/pitch for every remote entity.
 *
 * Our own slot is never interpolated — the local player drives from prediction.
 */

import { F_ALIVE, type EntityState, type Snapshot } from './protocol';

const INTERP_DELAY_TICKS = 6; // ~94 ms
const MAX_SNAPSHOTS = 128; // ~2 s of history

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPos(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export interface RemoteEntity {
  slot: number;
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  /** True if the entity is alive and should be rendered. */
  alive: boolean;
  /** True if this entity is on team CT (for tinting/identification). */
  teamCt: boolean;
}

interface Buffered {
  snap: Snapshot;
  tick: number;
}

/**
 * Call `push(snapshot)` each time a Snapshot arrives from the server. Call
 * `interpolate(yourSlot)` each render frame to get lerped remote entities.
 */
export function createInterpolationBuffer() {
  const buf: Buffered[] = [];

  function push(snap: Snapshot): void {
    buf.push({ snap, tick: snap.serverTick });
    while (buf.length > MAX_SNAPSHOTS) buf.shift();
  }

  function interpolate(yourSlot: number): RemoteEntity[] {
    if (buf.length < 2) return [];

    const newestTick = buf[buf.length - 1]!.tick;
    const renderTick = newestTick - INTERP_DELAY_TICKS;

    let lo = 0;
    let hi = buf.length - 1;
    // Find the rightmost snapshot whose tick <= renderTick.
    for (let i = 0; i < buf.length; i++) {
      if (buf[i]!.tick <= renderTick) lo = i;
      if (buf[i]!.tick >= renderTick) {
        hi = i;
        break;
      }
    }

    // Render tick is before any known snapshot — use the oldest.
    if (lo === hi || lo >= buf.length - 1) {
      // Extrapolate forward from the newest snapshot using velocity.
      return entitiesFromSnap(buf[buf.length - 1]!.snap, yourSlot);
    }

    const sLo = buf[lo]!;
    const sHi = buf[hi]!;
    const span = sHi.tick - sLo.tick;
    const t = span > 0 ? (renderTick - sLo.tick) / span : 0;

    // Merge: position from sHi for slots present in both, else sLo.
    const result: RemoteEntity[] = [];
    const hiBySlot = new Map<number, EntityState>();
    for (const e of sHi.snap.entities) hiBySlot.set(e.slot, e);
    for (const e of sLo.snap.entities) {
      if (e.slot === yourSlot) continue;
      const hiEnt = hiBySlot.get(e.slot);
      const pos = hiEnt
        ? lerpPos(e.pos, hiEnt.pos, t)
        : e.pos;
      const yaw = hiEnt ? lerp(e.yaw, hiEnt.yaw, t) : e.yaw;
      result.push({
        slot: e.slot,
        pos,
        yaw,
        pitch: hiEnt ? hiEnt.pitch : e.pitch,
        alive: (e.flags & F_ALIVE) !== 0,
        teamCt: hiEnt
          ? (hiEnt.flags & (1 << 2)) !== 0
          : (e.flags & (1 << 2)) !== 0,
      });
    }
    return result;
  }

  function entitiesFromSnap(snap: Snapshot, yourSlot: number): RemoteEntity[] {
    const out: RemoteEntity[] = [];
    for (const e of snap.entities) {
      if (e.slot === yourSlot) continue;
      out.push({
        slot: e.slot,
        pos: e.pos,
        yaw: e.yaw,
        pitch: e.pitch,
        alive: (e.flags & F_ALIVE) !== 0,
        teamCt: (e.flags & (1 << 2)) !== 0,
      });
    }
    return out;
  }

  return { push, interpolate };
}

/**
 * Client-side entity interpolation (docs/netcode.md §5.3).
 *
 * Buffers incoming Snapshots in a ring buffer. Each render frame we advance
 * a fractional render clock toward newestTick − interpDelay, find the two
 * snapshots bracketing that tick, and lerp pos/yaw/pitch for every remote
 * entity.
 *
 * Our own slot is never interpolated — the local player drives from prediction.
 */

import { F_ALIVE, F_DUCKED, F_ONGROUND, F_TEAM_CT, type EntityState, type Snapshot } from './protocol';
import { TICK_RATE } from '../core/loop';

const INTERP_DELAY_TICKS = 6; // ~94 ms at 64 Hz
const MAX_SNAPSHOTS = 128; // ~2 s of history
const SNAP_THRESHOLD_SQ = 4; // 2 m² — teleports/respawns snap rather than lerp
const MAX_DRIFT_TICKS = 32; // 0.5 s — beyond this the clock is resynced, not trimmed
/** Max proportional trim on the render clock's rate (±10%). */
const MAX_RATE_TRIM = 0.1;
/** Trim per tick of error. 0.2 ticks out ⇒ full 10% correction. */
const CATCHUP_GAIN = 0.5;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Yaw wraps at ±π. A plain lerp from +3.0 to -3.0 sweeps the long way through
// 0 (a full ~360° whip); take the shortest arc instead. Server bot yaw jumps
// discontinuously at corners/target switches, so this is not optional.
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
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
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  /** True if the entity is alive and should be rendered. */
  alive: boolean;
  /** True if this entity is on team CT (for tinting/identification). */
  teamCt: boolean;
  /** True while crouched — the model squashes to the ducked profile.
   *  ponytail: binary, not the smooth duckAmount; the wire only carries a flag. */
  ducked: boolean;
  /** True while the player's feet are on the ground. */
  onGround: boolean;
}

interface Buffered {
  snap: Snapshot;
  tick: number;
}

/**
 * Call `push(snapshot)` each time a Snapshot arrives from the server. Call
 * `interpolate(yourSlot, dt)` each render frame to get lerped remote entities
 * (dt is the wall-clock frame delta in seconds, e.g. 1/120 at 120 fps).
 */
export function createInterpolationBuffer() {
  const buf: Buffered[] = [];
  let newestTick = 0;
  let renderTime = 0; // fractional tick counter
  let clockStarted = false;

  function push(snap: Snapshot): void {
    // Reject duplicates and out-of-order snapshots.
    // newestTick is the maximum tick seen, not last-pushed — so one late
    // frame doesn't drag every entity backwards.
    if (snap.serverTick <= newestTick) return;
    buf.push({ snap, tick: snap.serverTick });
    newestTick = snap.serverTick;
    while (buf.length > MAX_SNAPSHOTS) buf.shift();
  }

  function reset(): void {
    buf.length = 0;
    newestTick = 0;
    renderTime = 0;
    clockStarted = false;
  }

  function interpolate(yourSlot: number, dt: number): RemoteEntity[] {
    if (buf.length < 2) return [];

    const targetTick = newestTick - INTERP_DELAY_TICKS;

    if (!clockStarted) {
      renderTime = targetTick;
      clockStarted = true;
    }

    // Advance by real time, but steer toward the target rather than free-running.
    // The render clock (rAF) and the server's tick clock are independent and WILL
    // drift; left uncorrected the render time walks past the newest snapshot,
    // every frame falls through to "hold the newest", and remotes go back to
    // stepping — the exact defect this module exists to fix. The correction is a
    // rate trim, capped at ±10%, so catching up is invisible rather than a warp.
    const err = targetTick - renderTime; // > 0 means we are behind the server
    const trim = Math.max(-MAX_RATE_TRIM, Math.min(MAX_RATE_TRIM, err * CATCHUP_GAIN));
    renderTime += dt * TICK_RATE * (1 + trim);

    // Never render past the newest thing we have been told. If the stream
    // stalls, hold at the last known state instead of walking into the future
    // and then snapping back when the drift cap trips — that produced a
    // sawtooth of rewinds for as long as the stall lasted.
    if (renderTime > newestTick) renderTime = newestTick;

    // Hard-snap only when the trim cannot plausibly recover: a long stall, a tab
    // restore, or a server restart. Both directions — running far ahead is just
    // as broken as falling far behind.
    if (Math.abs(targetTick - renderTime) > MAX_DRIFT_TICKS) {
      renderTime = targetTick;
    }

    // renderTick is the integer tick of the left bracket; the fractional part
    // of renderTime is what produces a non-zero lerp t (see `t` below).
    const renderTick = Math.floor(renderTime);

    // Find the rightmost snapshot whose tick <= renderTick (lo), and the
    // first whose tick >= renderTick (hi).
    let lo = 0;
    let hi = buf.length - 1;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i]!.tick <= renderTick) lo = i;
      if (buf[i]!.tick >= renderTick) {
        hi = i;
        break;
      }
    }

    // When renderTick lands exactly on a known snapshot (lo === hi),
    // use the next snapshot as hi so the lerp still runs.
    if (lo === hi) {
      if (lo < buf.length - 1) {
        hi = lo + 1;
      } else {
        // Fell off the end — hold the newest snapshot.
        return entitiesFromSnap(buf[buf.length - 1]!.snap, yourSlot);
      }
    }

    // Render tick is before the oldest known snapshot.
    if (lo >= buf.length - 1) {
      return entitiesFromSnap(buf[buf.length - 1]!.snap, yourSlot);
    }

    const sLo = buf[lo]!;
    const sHi = buf[hi]!;
    const span = sHi.tick - sLo.tick;
    // Fraction of the way from sLo to sHi. This has to be measured in the same
    // units as the span: adding renderFrac (a fraction of ONE tick) to a
    // span-normalised offset only happens to be right when span === 1, and
    // overshoots past sHi for every larger gap — a dropped snapshot sent
    // remotes sailing ~50% beyond their true position.
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - sLo.tick) / span)) : 0;

    // Build slot maps for both snapshots so we can iterate the union.
    const loBySlot = new Map<number, EntityState>();
    for (const e of sLo.snap.entities) loBySlot.set(e.slot, e);
    const hiBySlot = new Map<number, EntityState>();
    for (const e of sHi.snap.entities) hiBySlot.set(e.slot, e);

    // Iterate the union — an entity present only in sHi (new spawner) is
    // returned rather than dropped.
    const allSlots = new Set([...loBySlot.keys(), ...hiBySlot.keys()]);
    const result: RemoteEntity[] = [];
    for (const slot of allSlots) {
      if (slot === yourSlot) continue;
      const loEnt = loBySlot.get(slot);
      const hiEnt = hiBySlot.get(slot);
      if (!loEnt && !hiEnt) continue;

      // Read every field from the same side: hi, falling back to lo.
      const src = hiEnt ?? loEnt!;

      let pos: [number, number, number];
      let yaw: number;
      let pitch: number;
      if (loEnt && hiEnt) {
        const dx = hiEnt.pos[0] - loEnt.pos[0];
        const dy = hiEnt.pos[1] - loEnt.pos[1];
        const dz = hiEnt.pos[2] - loEnt.pos[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > SNAP_THRESHOLD_SQ) {
          // Teleport / respawn: take hi directly rather than lerping through
          // world geometry.
          pos = hiEnt.pos;
          yaw = hiEnt.yaw;
          pitch = hiEnt.pitch;
        } else {
          pos = lerpPos(loEnt.pos, hiEnt.pos, t);
          yaw = lerpAngle(loEnt.yaw, hiEnt.yaw, t);
          pitch = hiEnt.pitch;
        }
      } else {
        pos = src.pos;
        yaw = src.yaw;
        pitch = src.pitch;
      }

      result.push({
        slot,
        pos,
        vel: src.vel,
        yaw,
        pitch,
        alive: (src.flags & F_ALIVE) !== 0,
        teamCt: (src.flags & F_TEAM_CT) !== 0,
        ducked: (src.flags & F_DUCKED) !== 0,
        onGround: (src.flags & F_ONGROUND) !== 0,
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
        vel: e.vel,
        yaw: e.yaw,
        pitch: e.pitch,
        alive: (e.flags & F_ALIVE) !== 0,
        teamCt: (e.flags & F_TEAM_CT) !== 0,
        ducked: (e.flags & F_DUCKED) !== 0,
        onGround: (e.flags & F_ONGROUND) !== 0,
      });
    }
    return out;
  }

  return { push, reset, interpolate, get renderTick() { return Math.floor(renderTime); } };
}

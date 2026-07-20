/**
 * Shared wire-format definitions for Phase 6 netcode. This module mirrors
 * sim/src/protocol.rs exactly — tag bytes, version, and Welcome encoding.
 * Both ends must agree on these, or the connection drops.
 *
 * See docs/netcode.md §3 for the full format.
 */

export const PROTOCOL_VERSION = 1;

export const TAG_WELCOME = 0;
export const TAG_BYE = 1;
export const TAG_CMD = 2;
export const TAG_SNAP = 3;

export const SPECTATOR = 255;

export interface Welcome {
  yourSlot: number;
  map: string;
  seed: number;
  serverTick: number;
}

export function encodeWelcome(w: Welcome): Uint8Array {
  const mapBytes = new TextEncoder().encode(w.map);
  const buf = new ArrayBuffer(1 + 1 + 1 + 1 + mapBytes.length + 4 + 4);
  const v = new DataView(buf);
  let off = 0;
  v.setUint8(off, TAG_WELCOME);
  off += 1;
  v.setUint8(off, PROTOCOL_VERSION);
  off += 1;
  v.setUint8(off, w.yourSlot);
  off += 1;
  v.setUint8(off, mapBytes.length);
  off += 1;
  new Uint8Array(buf).set(mapBytes, off);
  off += mapBytes.length;
  v.setUint32(off, w.seed, true);
  off += 4;
  v.setUint32(off, w.serverTick, true);
  return new Uint8Array(buf);
}

export function decodeWelcome(data: Uint8Array): Welcome | null {
  if (data.length < 12) return null;
  const tag = data[0];
  const ver = data[1];
  if (tag === undefined || tag !== TAG_WELCOME) return null;
  if (ver === undefined || ver !== PROTOCOL_VERSION) return null;
  const yourSlot = data[2];
  const mapLen = data[3];
  if (yourSlot === undefined || mapLen === undefined) return null;
  if (data.length < 4 + mapLen + 8) return null;
  const map = new TextDecoder().decode(data.slice(4, 4 + mapLen));
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seed = v.getUint32(4 + mapLen, true);
  const serverTick = v.getUint32(8 + mapLen, true);
  return { yourSlot, map, seed, serverTick };
}

// ---------------------------------------------------------------
// CommandFrame — client → server, every client tick. docs/netcode.md §3.1
// Mirrors sim/src/protocol.rs CommandFrame.
// ---------------------------------------------------------------

export interface Shot {
  eyePos: readonly [number, number, number];
  dir: readonly [number, number, number];
}

export interface CommandFrame {
  seq: number;
  lastAckSnapshot: number;
  buttons: number;
  yaw: number;
  pitch: number;
  weapon: number;
  shot: Shot | null;
}

export function encodeCommand(c: CommandFrame): Uint8Array {
  const buf = new ArrayBuffer(22 + (c.shot ? 24 : 0));
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, TAG_CMD); o += 1;
  v.setUint8(o, PROTOCOL_VERSION); o += 1;
  v.setUint32(o, c.seq, true); o += 4;
  v.setUint32(o, c.lastAckSnapshot, true); o += 4;
  v.setUint16(o, c.buttons, true); o += 2;
  v.setFloat32(o, c.yaw, true); o += 4;
  v.setFloat32(o, c.pitch, true); o += 4;
  v.setUint8(o, c.weapon); o += 1;
  if (c.shot) {
    v.setUint8(o, 1); o += 1;
    for (const n of [...c.shot.eyePos, ...c.shot.dir]) { v.setFloat32(o, n, true); o += 4; }
  } else {
    v.setUint8(o, 0); o += 1;
  }
  return new Uint8Array(buf);
}

export function decodeCommand(data: Uint8Array): CommandFrame | null {
  if (data.length < 22 || data[0] !== TAG_CMD || data[1] !== PROTOCOL_VERSION) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 2;
  const seq = v.getUint32(o, true); o += 4;
  const lastAckSnapshot = v.getUint32(o, true); o += 4;
  const buttons = v.getUint16(o, true); o += 2;
  const yaw = v.getFloat32(o, true); o += 4;
  const pitch = v.getFloat32(o, true); o += 4;
  const weapon = v.getUint8(o); o += 1;
  const hasShot = v.getUint8(o); o += 1;
  let shot: Shot | null = null;
  if (hasShot === 1) {
    if (data.length < o + 24) return null;
    const f = (): number => { const n = v.getFloat32(o, true); o += 4; return n; };
    shot = { eyePos: [f(), f(), f()], dir: [f(), f(), f()] };
  }
  return { seq, lastAckSnapshot, buttons, yaw, pitch, weapon, shot };
}

// ---------------------------------------------------------------
// Snapshot — server → client. docs/netcode.md §3.2
// Mirrors sim/src/protocol.rs Snapshot. 6.3 = full (non-delta) snapshots.
// ---------------------------------------------------------------

export const F_ALIVE = 1 << 0;
export const F_DUCKED = 1 << 1;
export const F_TEAM_CT = 1 << 2;

export interface EntityState {
  slot: number;
  flags: number;
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  armor: number;
  weapon: number;
  ammo: number;
}

export interface RoundState {
  phase: number;
  timeLeftMs: number;
  scoreT: number;
  scoreCt: number;
}

export interface GameEvent {
  tag: number;
  slot: number;
  by: number;
}

export const EV_KILL = 1;

export interface Snapshot {
  serverTick: number;
  ackSeq: number;
  entities: EntityState[];
  events: GameEvent[];
  round: RoundState;
}

export function decodeSnapshot(data: Uint8Array): Snapshot | null {
  if (data.length < 11 || data[0] !== TAG_SNAP || data[1] !== PROTOCOL_VERSION) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 2;
  const serverTick = v.getUint32(o, true); o += 4;
  const ackSeq = v.getUint32(o, true); o += 4;
  const count = v.getUint8(o); o += 1;
  const entities: EntityState[] = [];
  for (let i = 0; i < count; i++) {
    if (data.length < o + 38) return null;
    const slot = v.getUint8(o); o += 1;
    const flags = v.getUint8(o); o += 1;
    const f = (): number => { const n = v.getFloat32(o, true); o += 4; return n; };
    const pos: [number, number, number] = [f(), f(), f()];
    const vel: [number, number, number] = [f(), f(), f()];
    const yaw = f();
    const pitch = f();
    const health = v.getUint8(o); o += 1;
    const armor = v.getUint8(o); o += 1;
    const weapon = v.getUint8(o); o += 1;
    const ammo = v.getUint8(o); o += 1;
    entities.push({ slot, flags, pos, vel, yaw, pitch, health, armor, weapon, ammo });
  }
  const evCount = v.getUint8(o); o += 1;
  const events: GameEvent[] = [];
  for (let i = 0; i < evCount; i++) {
    if (data.length < o + 3) return null;
    events.push({ tag: v.getUint8(o), slot: v.getUint8(o + 1), by: v.getUint8(o + 2) });
    o += 3;
  }
  if (data.length < o + 7) return null;
  const round: RoundState = {
    phase: v.getUint8(o),
    timeLeftMs: v.getUint16(o + 1, true),
    scoreT: v.getUint16(o + 3, true),
    scoreCt: v.getUint16(o + 5, true),
  };
  return { serverTick, ackSeq, entities, events, round };
}

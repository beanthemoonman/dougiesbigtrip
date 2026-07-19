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

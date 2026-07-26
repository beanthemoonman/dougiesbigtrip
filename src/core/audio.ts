/**
 * Weapon audio, synthesised with the Web Audio API — a gunshot is a filtered
 * noise burst plus a low thump; a reload is a couple of short clicks. No sound
 * *files*, so no asset to licence and no CREDITS row.
 *
 * ponytail: deliberately not Howler.js (the CLAUDE.md stack pick). Howler plays
 * *sources* — files, data URIs — and every voice in here is a synthesised
 * oscillator/noise graph with no file behind it, so there is nothing for Howler
 * to load. Its spatial support is a thin wrapper over the Web Audio PannerNode,
 * which we can point our own graph at directly (see `out(at)` below). Zero
 * dependency, same HRTF panning and distance model.
 *
 * This is a render-side effect sink: the deterministic sim decides *when* to
 * fire (in the fixed tick), and calls in here; nothing here is ever read back
 * into sim state, and `ctx.currentTime` is used only to schedule envelopes.
 */
import type { WeaponId } from '../weapons/defs';
import { makeRng } from './rng';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
// Master gain every voice routes through, so the Settings volume slider is one
// knob instead of a scale factor threaded through every envelope. Set lazily
// with the context; `pendingVolume` remembers a setMasterVolume() called before
// the first sound created it.
let master: GainNode | null = null;
let pendingVolume = 1;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = pendingVolume;
    master.connect(ctx.destination);
    // 0.5 s of white noise, generated once from the seeded rng so Math.random
    // stays out of src/ (determinism rule). The buffer is reused for every shot.
    const rng = makeRng(0x5eed);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
  }
  return ctx;
}

/** A world position for a positional voice. Any three-component vector will do. */
export interface AudioPos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where a voice connects. With no position it goes straight to master — that's
 * the right answer for anything at the ear (your own gun, your own hurt grunt),
 * which would otherwise be panned by the listener's own rounding error.
 *
 * With a position it gets a PannerNode: HRTF panning plus a *linear* distance
 * model, so a source is silent at exactly `range` metres and there is no
 * infinite quiet tail. `range` is per-sound — gunfire carries across the map,
 * footsteps do not.
 */
function out(at?: AudioPos, range = 40): AudioNode {
  const c = audio();
  if (!at) return master as GainNode;
  const p = c.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'linear';
  p.refDistance = 1;
  p.maxDistance = range;
  p.rolloffFactor = 1;
  p.positionX.value = at.x;
  p.positionY.value = at.y;
  p.positionZ.value = at.z;
  p.connect(master as GainNode);
  return p;
}

/**
 * Point the listener at the camera. Call once per rendered frame with the eye
 * position and the forward direction; `up` is assumed +Y (this game has no roll
 * beyond view punch, which is too small to hear).
 *
 * Render-side only — like every other call in this module, nothing here feeds
 * back into sim state.
 */
export function setListener(pos: AudioPos, forward: AudioPos): void {
  const l = audio().listener;
  l.positionX.value = pos.x;
  l.positionY.value = pos.y;
  l.positionZ.value = pos.z;
  l.forwardX.value = forward.x;
  l.forwardY.value = forward.y;
  l.forwardZ.value = forward.z;
  l.upX.value = 0;
  l.upY.value = 1;
  l.upZ.value = 0;
}

/** Master volume, 0..1 (the Settings slider). Applies before the context exists. */
export function setMasterVolume(v: number): void {
  pendingVolume = v;
  if (master) master.gain.value = v;
}

/** Must be called from a user gesture (the pointer-lock click) or the context
 * stays suspended and nothing plays. Safe to call repeatedly. */
export function resumeAudio(): void {
  void audio().resume();
}

function burst(dur: number, cutoff: number, gain: number, when: number, dst: AudioNode): void {
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = noise;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(lp).connect(g).connect(dst);
  src.start(when, 0, dur);
}

/** How far gunfire carries, in metres. Matches SIGHT_RANGE. */
export const GUNSHOT_RANGE = 40;
/** How far a footstep carries. Short on purpose — a tactical cue, not ambience. */
export const FOOTSTEP_RANGE = 14;

/** `at` omitted = your own gun, at the ear, unpanned. */
export function playGunshot(weapon: WeaponId, at?: AudioPos): void {
  const c = audio();
  const t = c.currentTime;
  const dst = out(at, GUNSHOT_RANGE);
  // Rifle: louder, a touch longer and brighter. Pistol: shorter, drier.
  const rifle = weapon === 'rifle';
  burst(rifle ? 0.18 : 0.12, rifle ? 3200 : 2600, rifle ? 0.9 : 0.7, t, dst);
  // Low body thump so it has weight, not just a hiss.
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(rifle ? 150 : 190, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  g.gain.setValueAtTime(rifle ? 0.6 : 0.45, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(g).connect(dst);
  osc.start(t);
  osc.stop(t + 0.14);
}

/**
 * Impact tick when a bullet lands — surface-typed. Hard surfaces (concrete/
 * metal) ring bright and short; wood is duller; flesh is a low wet thud with no
 * ricochet snap. Quiet relative to the gun; it's a confirmation, not an event.
 */
export function playImpact(surface: 'concrete' | 'wood' | 'metal' | 'flesh', at?: AudioPos): void {
  const t = audio().currentTime;
  const dst = out(at, GUNSHOT_RANGE);
  switch (surface) {
    case 'metal':
      burst(0.05, 6000, 0.28, t, dst);
      break;
    case 'concrete':
      burst(0.04, 4200, 0.22, t, dst);
      break;
    case 'wood':
      burst(0.05, 2200, 0.24, t, dst);
      break;
    case 'flesh': {
      // No high snap — a short low thump, the "you hit someone" cue.
      const c = audio();
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.06);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(g).connect(dst);
      osc.start(t);
      osc.stop(t + 0.09);
      break;
    }
  }
}

/**
 * A soft footstep thump. Surface tweaks the cutoff so gravel≠wood≠metal grate.
 * `at` omitted = your own boots; anyone else's get panned and range-limited.
 * Louder at source than the old unpanned value — the linear distance model eats
 * most of it before it reaches the ear at any real separation.
 */
export function playFootstep(surface: 'concrete' | 'wood' | 'metal' | 'flesh', at?: AudioPos): void {
  const t = audio().currentTime;
  const cutoff = surface === 'metal' ? 1400 : surface === 'wood' ? 900 : 700;
  burst(0.05, cutoff, at ? 0.3 : 0.12, t, out(at, FOOTSTEP_RANGE));
}

/** `at` omitted = your own reload. Other players' reloads are a real tell. */
export function playReload(at?: AudioPos): void {
  const t = audio().currentTime;
  const dst = out(at, FOOTSTEP_RANGE);
  // Two clicks: mag out, mag in. Rough but reads as "reload".
  burst(0.04, 1800, 0.4, t, dst);
  burst(0.05, 1500, 0.5, t + 0.18, dst);
}

/**
 * Short, low, wet thud + filtered noise hiss — the "you got hit" cue.
 * Louder than an impact tick so it cuts through gunfire. The low sine
 * starts at 180 Hz and drops quickly, paired with a dark noise burst
 * that adds body without reading as a ricochet.
 */
export function playHurt(): void {
  const c = audio();
  const t = c.currentTime;
  // Always unpanned: this is *your* pain, it has no position in the world.
  burst(0.08, 900, 0.22, t, out());
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + 0.13);
}

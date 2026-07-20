/**
 * Weapon audio, synthesised with the Web Audio API — a gunshot is a filtered
 * noise burst plus a low thump; a reload is a couple of short clicks. No sound
 * *files*, so no asset to licence and no CREDITS row.
 *
 * ponytail: deliberately not Howler.js (the CLAUDE.md stack pick). Howler earns
 * its keep for positional/spatial audio, which only matters once there are other
 * sources in the world (bots, Phase 4). The player's own gun is at the ear —
 * mono, no distance model — so a few lines of Web Audio cover it. Bring in
 * Howler with the bots, for the third-person/distance-tail variants the doc wants.
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

/** Where every voice connects instead of ctx.destination — the master volume node. */
function out(): AudioNode {
  audio();
  return master as GainNode;
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

function burst(dur: number, cutoff: number, gain: number, when: number): void {
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = noise;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(lp).connect(g).connect(out());
  src.start(when, 0, dur);
}

export function playGunshot(weapon: WeaponId, gain = 1): void {
  const c = audio();
  const t = c.currentTime;
  // Rifle: louder, a touch longer and brighter. Pistol: shorter, drier.
  const rifle = weapon === 'rifle';
  burst(rifle ? 0.18 : 0.12, rifle ? 3200 : 2600, (rifle ? 0.9 : 0.7) * gain, t);
  // Low body thump so it has weight, not just a hiss.
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(rifle ? 150 : 190, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
  g.gain.setValueAtTime((rifle ? 0.6 : 0.45) * gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + 0.14);
}

/**
 * Impact tick when a bullet lands — surface-typed. Hard surfaces (concrete/
 * metal) ring bright and short; wood is duller; flesh is a low wet thud with no
 * ricochet snap. Quiet relative to the gun; it's a confirmation, not an event.
 */
export function playImpact(surface: 'concrete' | 'wood' | 'metal' | 'flesh'): void {
  const t = audio().currentTime;
  switch (surface) {
    case 'metal':
      burst(0.05, 6000, 0.28, t);
      break;
    case 'concrete':
      burst(0.04, 4200, 0.22, t);
      break;
    case 'wood':
      burst(0.05, 2200, 0.24, t);
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
      osc.connect(g).connect(out());
      osc.start(t);
      osc.stop(t + 0.09);
      break;
    }
  }
}

/** A soft footstep thump. Surface tweaks the cutoff so gravel≠wood≠metal grate. */
export function playFootstep(surface: 'concrete' | 'wood' | 'metal' | 'flesh'): void {
  const t = audio().currentTime;
  const cutoff = surface === 'metal' ? 1400 : surface === 'wood' ? 900 : 700;
  burst(0.05, cutoff, 0.12, t);
}

export function playReload(): void {
  const t = audio().currentTime;
  // Two clicks: mag out, mag in. Rough but reads as "reload".
  burst(0.04, 1800, 0.4, t);
  burst(0.05, 1500, 0.5, t + 0.18);
}

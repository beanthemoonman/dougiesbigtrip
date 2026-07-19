/**
 * Fixed 64 Hz simulation timestep with an accumulator, decoupled from an
 * uncapped render rate. Render is called every rAF with an interpolation
 * alpha in [0, 1) so visuals don't step at the sim rate.
 *
 * Retrofitting this later is miserable — see CLAUDE.md Phase 0. Every
 * system that reads "current" transforms for rendering must interpolate
 * between the previous and current sim state using `alpha`, not just read
 * the latest sim state directly.
 */

export const TICK_RATE = 64;
export const FIXED_DT = 1 / TICK_RATE;

const MAX_FRAME_DT = 0.25; // clamp huge gaps (tab backgrounded) to avoid a spiral of death
const MAX_STEPS_PER_FRAME = 8; // hard cap even if the clamp above is bypassed

export interface LoopCallbacks {
  /** Advance simulation by exactly FIXED_DT seconds. May be called 0+ times per frame. */
  tick: (fixedDt: number) => void;
  /** Draw a frame. `alpha` is how far between the previous and current tick we are.
   * `frameDt` is real seconds since the last frame (clamped), for render-only
   * cosmetics (VFX fades) — never feed it into the sim. */
  render: (alpha: number, frameDt: number) => void;
}

export interface LoopHandle {
  stop: () => void;
}

export function startLoop(callbacks: LoopCallbacks): LoopHandle {
  let accumulator = 0;
  let lastTime = performance.now();
  let running = true;
  let rafId = 0;

  function frame(now: number): void {
    if (!running) return;

    let frameDt = (now - lastTime) / 1000;
    lastTime = now;
    if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;

    accumulator += frameDt;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      callbacks.tick(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }

    const alpha = accumulator / FIXED_DT;
    callbacks.render(alpha, frameDt);

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return {
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}

/**
 * Footstep pacing, shared by the local player, bots, and networked remotes.
 *
 * Distance-paced, not time-paced: a step every STEP_STRIDE metres of ground
 * travel, so running is audibly faster than walking without a second timer.
 * Pure — the caller owns the accumulator and does the actual sound.
 */

/** Metres of ground travel between footsteps at a walk/run. */
export const STEP_STRIDE = 1.9;

/** Below this ground speed (m/s) nobody is walking; creep-adjust doesn't count. */
export const STEP_MIN_SPEED = 0.5;

export interface StrideResult {
  /** Distance carried into the next tick. */
  readonly dist: number;
  /** True if a footstep should be played this tick. */
  readonly stepped: boolean;
}

/**
 * @param dist        accumulated metres since the last step
 * @param groundSpeed horizontal speed in m/s; pass 0 when airborne
 * @param dt          tick duration in seconds
 *
 * Below STEP_MIN_SPEED the accumulator resets to zero rather than holding, so
 * the first step after a stop is a full stride away instead of instant.
 * ponytail: a step consumes the whole accumulator instead of subtracting one
 * stride — no burst of queued steps after a lag spike, at the cost of dropping
 * sub-stride remainder. Inaudible at 64 Hz.
 */
export function advanceStride(dist: number, groundSpeed: number, dt: number): StrideResult {
  if (groundSpeed <= STEP_MIN_SPEED) return { dist: 0, stepped: false };
  const next = dist + groundSpeed * dt;
  return next >= STEP_STRIDE ? { dist: 0, stepped: true } : { dist: next, stepped: false };
}

import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Render-side snapshot of the bits of PlayerState the camera needs. Kept
 * separate from PlayerState itself (which is mutated in place every sim
 * tick) so main.ts can hold a previous/current pair and interpolate — see
 * core/loop.ts.
 */
export interface ViewState {
  position: Vector3; // feet
  eyeHeight: number;
  viewPunch: number;
  /**
   * Accumulated weapon recoil punch, radians (weapons/recoil.ts). Authored
   * +right / +up, same as the spray pattern in weapons/defs.ts — the sign
   * conversion to view angles happens below, and must stay identical to
   * `fireShot`'s or the bullet stops following the view.
   */
  punchYaw: number;
  punchPitch: number;
}

/** Poses `camera` at the interpolated eye position/orientation for this render frame. */
export function updateViewCamera(
  camera: PerspectiveCamera,
  prev: ViewState,
  curr: ViewState,
  alpha: number,
  yaw: number,
  pitch: number,
): void {
  const lerp = (a: number, b: number): number => a + (b - a) * alpha;
  const eyeHeight = lerp(prev.eyeHeight, curr.eyeHeight);
  const viewPunch = lerp(prev.viewPunch, curr.viewPunch);
  const punchYaw = lerp(prev.punchYaw, curr.punchYaw);
  const punchPitch = lerp(prev.punchPitch, curr.punchPitch);

  camera.position.lerpVectors(prev.position, curr.position, alpha);
  camera.position.y += eyeHeight;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw - punchYaw;
  camera.rotation.x = pitch + punchPitch + viewPunch;
  camera.rotation.z = 0;
}

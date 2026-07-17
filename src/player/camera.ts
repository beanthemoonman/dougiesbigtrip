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
}

export function createViewState(feet: Vector3, eyeHeight: number): ViewState {
  return { position: feet.clone(), eyeHeight, viewPunch: 0 };
}

export function copyViewState(out: ViewState, from: ViewState): void {
  out.position.copy(from.position);
  out.eyeHeight = from.eyeHeight;
  out.viewPunch = from.viewPunch;
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
  const eyeHeight = prev.eyeHeight + (curr.eyeHeight - prev.eyeHeight) * alpha;
  const viewPunch = prev.viewPunch + (curr.viewPunch - prev.viewPunch) * alpha;

  camera.position.lerpVectors(prev.position, curr.position, alpha);
  camera.position.y += eyeHeight;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch + viewPunch;
  camera.rotation.z = 0;
}

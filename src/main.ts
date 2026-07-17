import type { World } from '@dimforge/rapier3d-compat';
import { BoxGeometry, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3 } from 'three';
import { createInputManager } from './core/input';
import { startLoop, TICK_RATE } from './core/loop';
import { updateViewCamera, type ViewState } from './player/camera';
import { createMovementContext, createPlayerState, tickMovement } from './player/movement';
import { addStaticBox, createWorld, initPhysics } from './physics/world';
import { createRenderContext } from './render/renderer';

// docs/art-direction.md palette. Flat-shaded, unlit greybox — no lightmap
// exists yet (that's Phase 3), so MeshBasicMaterial rather than a lit
// material avoids any temptation to reach for a realtime light to "fix" it.
const PALETTE = {
  concrete: 0xa5a29b,
  concreteDark: 0x5e5c58,
  sandstoneLight: 0xc9ae7c,
  wood: 0x7a5b3c,
} as const;

function addBox(
  world: World,
  scene: Scene,
  center: Vector3,
  halfExtents: Vector3,
  color: number,
  rotation?: Quaternion,
): void {
  addStaticBox(world, center, halfExtents, rotation);
  const mesh = new Mesh(
    new BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2),
    new MeshBasicMaterial({ color }),
  );
  mesh.position.copy(center);
  if (rotation) mesh.quaternion.copy(rotation);
  scene.add(mesh);
}

/** A straight ramp collider+mesh from `start` to `end` (both on the walkable surface). */
function addRamp(
  world: World,
  scene: Scene,
  start: Vector3,
  end: Vector3,
  width: number,
  thickness: number,
  color: number,
): void {
  const dir = end.clone().sub(start);
  const length = dir.length();
  const angle = Math.atan2(dir.y, dir.x);
  const normal = new Vector3(-Math.sin(angle), Math.cos(angle), 0);
  const center = start.clone().add(end).multiplyScalar(0.5).addScaledVector(normal, -thickness / 2);
  const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
  addBox(world, scene, center, new Vector3(length / 2, thickness / 2, width / 2), color, quat);
}

/**
 * Phase 1 exit-test room (docs/source-movement.md): an open bhop corridor, a
 * staircase (each step under STEP_HEIGHT, to prove walk-up-not-hop), and a
 * shallow ramp well under the walkable normal threshold (to prove no slope
 * sliding). Cuboid colliders, not a trimesh — this is greybox test geometry,
 * not an authored map (that pipeline is Phase 3).
 */
function buildGreyboxRoom(world: World, scene: Scene): void {
  addBox(world, scene, new Vector3(0, -0.1, 0), new Vector3(10, 0.1, 10), PALETTE.concrete);

  const wallHalfHeight = 2;
  const wallY = wallHalfHeight; // floor top at y=0
  addBox(world, scene, new Vector3(0, wallY, -10), new Vector3(10, wallHalfHeight, 0.1), PALETTE.sandstoneLight);
  addBox(world, scene, new Vector3(0, wallY, 10), new Vector3(10, wallHalfHeight, 0.1), PALETTE.sandstoneLight);
  addBox(world, scene, new Vector3(10, wallY, 0), new Vector3(0.1, wallHalfHeight, 10), PALETTE.sandstoneLight);
  addBox(world, scene, new Vector3(-10, wallY, 0), new Vector3(0.1, wallHalfHeight, 10), PALETTE.sandstoneLight);

  // Staircase: 6 steps, 0.3 m rise each (< 0.4572 m step height), 0.6 m tread.
  const STEP_RISE = 0.3;
  const STEP_DEPTH = 0.6;
  const STEP_COUNT = 6;
  for (let i = 0; i < STEP_COUNT; i++) {
    const height = (i + 1) * STEP_RISE;
    const x = 2.3 + i * STEP_DEPTH;
    addBox(world, scene, new Vector3(x, height / 2, -6), new Vector3(STEP_DEPTH / 2, height / 2, 1.25), PALETTE.concreteDark);
  }

  // Ramp: rises 1.4 m over a 5 m run (~15.6 deg, well under the 45.573 deg
  // walkable threshold) — standing on it should not slide.
  addRamp(world, scene, new Vector3(-8, 0, 6), new Vector3(-3, 1.4, 6), 2.5, 0.3, PALETTE.wood);
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (!canvas) throw new Error('missing #viewport canvas');

  const renderCtx = createRenderContext(canvas);
  const input = createInputManager(canvas);

  await initPhysics();
  const world = createWorld();
  buildGreyboxRoom(world, renderCtx.scene);

  const spawn = new Vector3(0, 0.05, 0);
  const movementCtx = createMovementContext(world, spawn);
  const player = createPlayerState(spawn);

  const prevView: ViewState = { position: player.position.clone(), eyeHeight: player.eyeHeight, viewPunch: 0 };
  const currView: ViewState = { position: player.position.clone(), eyeHeight: player.eyeHeight, viewPunch: 0 };

  startLoop({
    tick(fixedDt): void {
      prevView.position.copy(currView.position);
      prevView.eyeHeight = currView.eyeHeight;
      prevView.viewPunch = currView.viewPunch;

      tickMovement(movementCtx, player, { buttons: input.state.buttons, yaw: input.state.yaw }, fixedDt);

      currView.position.copy(player.position);
      currView.eyeHeight = player.eyeHeight;
      currView.viewPunch = player.viewPunch;
    },
    render(alpha): void {
      renderCtx.stats.begin();
      updateViewCamera(renderCtx.camera, prevView, currView, alpha, input.state.yaw, input.state.pitch);
      renderCtx.render();
      renderCtx.stats.end();
    },
  });

  console.log(`hl-demo: sim locked at ${TICK_RATE} Hz — click to lock the mouse.`);
}

void main();

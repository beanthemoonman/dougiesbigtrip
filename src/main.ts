import type { World } from '@dimforge/rapier3d-compat';
import { Color, FogExp2, Group, MathUtils, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import mapGlbUrl from '../assets/maps/de_greybox.glb?url';
import mapExrUrl from '../assets/maps/de_greybox/lightmap.exr?url';
import rifleUrl from '../assets/weapons/ak_viewmodel.glb?url';
import pistolUrl from '../assets/weapons/pistol_viewmodel.glb?url';
import { playGunshot, playReload, resumeAudio } from './core/audio';
import { Buttons, createInputManager } from './core/input';
import { startLoop, TICK_RATE } from './core/loop';
import { makeRng } from './core/rng';
import { MAP_BOXES, MAP_RAMPS, T_SPAWN } from './game/map_greybox';
import { updateViewCamera, type ViewState } from './player/camera';
import { createMovementContext, createPlayerState, tickMovement, type PlayerState } from './player/movement';
import { rayCast } from './physics/shapecast';
import { addStaticBox, createWorld, initPhysics } from './physics/world';
import { createDecals } from './render/decals';
import { loadLightmappedMap } from './render/lightmap';
import { createRenderContext } from './render/renderer';
import { createHud } from './ui/hud';
import { WEAPONS, type WeaponId } from './weapons/defs';
import { createWeaponState, fireShot, startReload, tickWeapon, type WeaponState } from './weapons/hitscan';
import { computeSpread, type Stance } from './weapons/spread';
import {
  beginDraw,
  beginHolster,
  beginReload,
  createViewmodelAnim,
  onFire,
  tickViewmodelAnim,
  viewmodelPose,
  type AnimPose,
} from './weapons/viewmodel';

// The map's VISUALS come from the baked-lightmap glb (loadLightmappedMap); its
// COLLISION stays the proven Rapier cuboids built here from the same layout
// data, so the two align without shipping a collision mesh in the glb. Baked
// lighting only — no realtime lights in the world scene (art-direction.md).

/** Build the greybox map colliders (game/map_greybox.ts) into the physics world. */
function buildMapColliders(world: World): void {
  for (const b of MAP_BOXES) {
    addStaticBox(
      world,
      new Vector3(b.c[0], b.c[1], b.c[2]),
      new Vector3(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2),
    );
  }
  for (const r of MAP_RAMPS) {
    const dir = new Vector3(r.end[0] - r.start[0], r.end[1] - r.start[1], r.end[2] - r.start[2]);
    const length = dir.length();
    const angle = Math.atan2(dir.y, dir.x);
    const normal = new Vector3(-Math.sin(angle), Math.cos(angle), 0);
    const center = new Vector3(r.start[0], r.start[1], r.start[2])
      .add(new Vector3(r.end[0], r.end[1], r.end[2]))
      .multiplyScalar(0.5)
      .addScaledVector(normal, -r.thickness / 2);
    const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
    addStaticBox(world, center, new Vector3(length / 2, r.thickness / 2, r.width / 2), quat);
  }
}

/**
 * Map the player's motion onto the accuracy model's stance buckets
 * (weapons/spread.ts).
 *
 * ponytail: thresholds picked to read right against the 6.35 m/s ground cap —
 * the doc names the buckets but no speeds. A ducked-and-moving player is just
 * 'walking'; CS gives crouch-walking its own (better) bucket. Fold that in when
 * there's a real number to port rather than one invented here.
 */
function stanceOf(player: PlayerState): Stance {
  if (!player.onGround) return 'air';
  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  if (speed < 0.1) return player.ducked ? 'crouchStill' : 'still';
  return speed < 3.5 ? 'walking' : 'running';
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (!canvas) throw new Error('missing #viewport canvas');

  const renderCtx = createRenderContext(canvas);
  const input = createInputManager(canvas);
  // AudioContext starts suspended until a user gesture — the same click that
  // engages pointer lock unlocks audio (core/audio.ts).
  canvas.addEventListener('click', resumeAudio);

  await initPhysics();
  const world = createWorld();
  buildMapColliders(world);

  // Map visuals: baked-lightmap glb (built by tools/blender/build_map.py). Sky
  // colour + matching exponential fog stand in for a skybox at greybox stage.
  const SKY = new Color(0x9fb8d6);
  renderCtx.scene.background = SKY;
  renderCtx.scene.fog = new FogExp2(SKY.getHex(), 0.012);
  renderCtx.scene.add(await loadLightmappedMap(mapGlbUrl, mapExrUrl));

  const spawn = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);
  const movementCtx = createMovementContext(world, spawn);
  const player = createPlayerState(spawn);

  // Fixed seed: the sim stays reproducible for a recorded trace. core/rng.ts is
  // the only randomness allowed under src/.
  const rng = makeRng(1);
  const shotDir = new Vector3();
  const shotOrigin = new Vector3();
  const hitNormal = new Vector3();
  const hitPoint = new Vector3();
  const decals = createDecals(renderCtx.scene);
  // ponytail: bullets stop at the first thing they touch. Wallbang/penetration is
  // in docs/weapon-feel.md §6 as explicitly optional for the demo — add it when
  // there are walls thin enough for it to matter (Phase 3).
  const MAX_SHOT_DISTANCE = 100; // m; the greybox is 20 m across

  // Both weapons, welded to the eye on layer 1 (viewmodel pass, renderer.ts).
  // Each keeps its own rest pose (hand-tuned lower-right hold) and its own
  // ammo/recoil state that persists across switches, like CS. The inactive
  // model is just hidden. `slots` maps the 1/2 keys to weapon ids.
  interface Held {
    id: WeaponId;
    root: Object3D;
    rest: { pos: Vector3; yaw: number };
    state: WeaponState;
  }
  const loader = new GLTFLoader();
  const [rifleScene, pistolScene] = await Promise.all([
    loader.loadAsync(rifleUrl).then((g) => g.scene),
    loader.loadAsync(pistolUrl).then((g) => g.scene),
  ]);
  const weapons: Record<WeaponId, Held> = {
    rifle: {
      id: 'rifle',
      root: rifleScene,
      rest: { pos: new Vector3(0.13, -0.14, -0.36), yaw: MathUtils.degToRad(3) },
      state: createWeaponState(WEAPONS.rifle),
    },
    pistol: {
      id: 'pistol',
      root: pistolScene,
      rest: { pos: new Vector3(0.085, -0.085, -0.17), yaw: MathUtils.degToRad(6) },
      state: createWeaponState(WEAPONS.pistol),
    },
  };
  const slots: Record<number, WeaponId> = { 1: 'rifle', 2: 'pistol' };
  for (const held of Object.values(weapons)) {
    // Nest under a Group so the anim can offset the Group while each mesh keeps
    // its own internal node transforms from the glb.
    const wrap = new Group();
    wrap.add(held.root);
    wrap.traverse((o) => o.layers.set(1));
    renderCtx.viewmodelScene.add(wrap);
    held.root = wrap;
    wrap.visible = false;
  }
  let active: Held = weapons.rifle;
  active.root.visible = true;
  const anim = createViewmodelAnim();
  const animPose: AnimPose = { x: 0, y: 0, z: 0, pitch: 0, roll: 0 };

  const hud = createHud(document.body);
  // ponytail: health/armour are constants until the damage/round loop lands in
  // Phase 4. game/damage.ts already has the math; nothing shoots back yet.
  const HEALTH = 100;
  const ARMOR = 100;

  const view = (): ViewState => ({
    position: player.position.clone(),
    eyeHeight: player.eyeHeight,
    viewPunch: 0,
    punchYaw: 0,
    punchPitch: 0,
  });
  const prevView = view();
  const currView = view();

  startLoop({
    tick(fixedDt): void {
      prevView.position.copy(currView.position);
      prevView.eyeHeight = currView.eyeHeight;
      prevView.viewPunch = currView.viewPunch;
      prevView.punchYaw = currView.punchYaw;
      prevView.punchPitch = currView.punchPitch;

      tickMovement(movementCtx, player, { buttons: input.state.buttons, yaw: input.state.yaw }, fixedDt);

      const weapon = WEAPONS[active.id];
      tickWeapon(active.state, weapon, fixedDt);

      // Weapon switch (1/2). Only from idle — holster the current gun; the swap
      // itself happens when the holster completes (below).
      const slot = input.state.weaponSlot;
      input.state.weaponSlot = 0;
      if (slot && slots[slot] && slots[slot] !== active.id && anim.state === 'idle') {
        beginHolster(anim, slots[slot]);
      }

      // Advance the viewmodel anim; a non-null return means a holster just
      // finished — perform the actual weapon swap and draw the new one.
      const swapTo = tickViewmodelAnim(anim, fixedDt);
      if (swapTo) {
        active.root.visible = false;
        active = weapons[swapTo];
        active.root.visible = true;
        beginDraw(anim);
      }

      // Reload / fire only while idle (not mid-draw/holster/reload).
      if (anim.state === 'idle') {
        if (input.state.buttons & Buttons.RELOAD && !active.state.reloading) {
          startReload(active.state, weapon);
          if (active.state.reloading) {
            beginReload(anim, weapon.reloadTime);
            playReload();
          }
        }
        if (input.state.buttons & Buttons.ATTACK) {
          const shot = fireShot(active.state, weapon, input.state.yaw, input.state.pitch, stanceOf(player), rng, shotDir);
          if (shot) {
            onFire(anim);
            playGunshot(active.id);
            // From the eye, not the muzzle (docs/weapon-feel.md §2) — the bullet
            // goes where the crosshair is, which is the point of the whole model.
            shotOrigin.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
            const distance = rayCast(
              world,
              shotOrigin,
              shot.direction,
              MAX_SHOT_DISTANCE,
              hitNormal,
              movementCtx.collider, // the eye sits inside the player's own hull
            );
            if (distance !== null) {
              decals.add(hitPoint.copy(shotOrigin).addScaledVector(shot.direction, distance), hitNormal);
            }
            // Damage is not applied here: nothing shoots or gets shot until the
            // character rig gives game/damage.ts hitboxes to query (Phase 3/4).
          }
        }
      }

      currView.position.copy(player.position);
      currView.eyeHeight = player.eyeHeight;
      currView.viewPunch = player.viewPunch;
      currView.punchYaw = active.state.recoil.punch.yaw;
      currView.punchPitch = active.state.recoil.punch.pitch;
    },
    render(alpha): void {
      renderCtx.stats.begin();
      updateViewCamera(renderCtx.camera, prevView, currView, alpha, input.state.yaw, input.state.pitch);

      // Apply the viewmodel anim pose on top of the active weapon's rest pose.
      // ponytail: read straight off the last sim tick, no render interpolation —
      // the kick/reload move fast and 64 Hz stepping is imperceptible on the gun.
      const weapon = WEAPONS[active.id];
      viewmodelPose(anim, animPose);
      active.root.position.set(
        active.rest.pos.x + animPose.x,
        active.rest.pos.y + animPose.y,
        active.rest.pos.z + animPose.z,
      );
      active.root.rotation.set(animPose.pitch, active.rest.yaw, animPose.roll, 'YXZ');

      renderCtx.render();
      hud.update(
        {
          health: HEALTH,
          armor: ARMOR,
          weapon,
          ammo: active.state.ammo,
          reloading: active.state.reloading,
          spreadRad: computeSpread(weapon, stanceOf(player), active.state.recoil.sprayIndex),
        },
        MathUtils.degToRad(renderCtx.camera.fov),
        renderCtx.renderer.domElement.clientHeight,
      );
      renderCtx.stats.end();
    },
  });

  console.log(`hl-demo: sim locked at ${TICK_RATE} Hz — click to lock the mouse.`);
}

void main();

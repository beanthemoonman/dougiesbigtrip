import { Box3, Color, FogExp2, Group, MathUtils, Mesh, MeshBasicMaterial, SkinnedMesh, type MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import mapGlbUrl from '../assets/maps/de_greybox.glb?url';
import navUrl from '../assets/maps/de_greybox.navmesh.bin?url';
import mapKtx2Url from '../assets/maps/de_greybox/lightmap.ktx2?url';
import ctPlayerUrl from '../assets/characters/ct_player.glb?url';
import barrelUrl from '../assets/props/barrel_explosive.glb?url';
import crateUrl from '../assets/props/crate_wood.glb?url';
import jerryUrl from '../assets/props/jerry_can.glb?url';
import palletUrl from '../assets/props/pallet_wood.glb?url';
import coneUrl from '../assets/props/traffic_cone.glb?url';
import rifleUrl from '../assets/weapons/ak_viewmodel.glb?url';
import pistolUrl from '../assets/weapons/pistol_viewmodel.glb?url';
import { createBot } from './ai/bot';
import { createBrain, DIFFICULTIES, hearSound, killBot, tickBrain, type BotBrain } from './ai/brain';
import { loadNav } from './ai/nav';
import { createBotAnim, driveBotAnim, resetBotAnim, type BotAnimState } from './ai/anim';
import { playFootstep, playGunshot, playImpact, playReload, resumeAudio, setMasterVolume } from './core/audio';
import { Buttons, createInputManager } from './core/input';
import { createSettingsPanel, DEFAULT_SETTINGS } from './core/settings';
import { startLoop, TICK_RATE } from './core/loop';
import { makeRng } from './core/rng';
import { type Breakable, damageProp } from './game/breakables';
import { computeDamage } from './game/damage';
import { hitboxAt, hitboxRay } from './game/hitbox';
import { buildMapColliders, CT_SPAWN, T_SPAWN } from './game/map_greybox';
import { createRoundState, DEFAULT_ROUND, tickRound } from './game/round';
import { EYE_HEIGHT_STANDING } from './player/constants';
import { updateViewCamera, type ViewState } from './player/camera';
import { createMovementContext, createPlayerState, tickMovement, type PlayerState } from './player/movement';
import { rayCast } from './physics/shapecast';
import { addStaticBox, createWorld, initPhysics } from './physics/world';
import { createDecals } from './render/decals';
import { createVfx, SURFACE_FX, type Surface } from './render/vfx';
import { loadLightmappedMap } from './render/lightmap';
import { createRenderContext } from './render/renderer';
import { makeSky } from './render/sky';
import { applySurfaceTextures } from './render/surfacetex';
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
// COLLISION stays the proven Rapier cuboids built by buildMapColliders (from the
// same layout data), so the two align without shipping a collision mesh in the
// glb. Baked lighting only — no realtime lights in the world scene (art-direction.md).

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

// Props that break when shot (crates + the explosive barrel). Wood pallets,
// cones and jerry-cans stay solid scenery. HP is tuned so a crate takes ~3 rifle
// hits and the fragile barrel ~2.
// ponytail: the barrel is "explosive" in name only — it just breaks. Radius
// damage to nearby bots/props is Phase 5 juice; add it when there's blast VFX to
// go with it, not a silent AoE.
const BREAKABLE_HP = new Map<string, number>([
  [crateUrl, 90],
  [barrelUrl, 55],
]);

// [url, x, z, yawDeg, stack] per prop. Each prop is dropped so its base rests on
// the floor (y=0) from its measured bounding box, so mesh origins don't matter.
// `stack` (metres, default 0) lifts a prop to sit on top of another (crate stack).
const PROP_PLACEMENTS: readonly [string, number, number, number, number?][] = [
  // Barrel + jerry-can clutter tucked against the flank cover crates.
  [barrelUrl, -5.3, 15.8, 0],
  [barrelUrl, -4.7, 16.9, 0],
  [barrelUrl, -5.9, 16.6, 0],
  [jerryUrl, -6.3, 16.3, 25],
  [barrelUrl, 5.3, -15.8, 0],
  [barrelUrl, 4.7, -16.9, 0],
  [jerryUrl, 5.9, -16.2, -30],
  // Crate stack by the mid pillars + loose crates in the centre lane.
  [crateUrl, 5.0, 4.2, 12],
  [crateUrl, 5.0, 4.2, -8, 0.7],
  [crateUrl, -5.0, -4.2, 12],
  [crateUrl, -1.9, 2.4, 20],
  [crateUrl, 1.9, -2.4, 20],
  // Pallets flat along the long west/east walls.
  [palletUrl, 10.9, 6.0, 90],
  [palletUrl, 10.9, -5.5, 90],
  [palletUrl, -10.9, 5.5, 90],
  // Traffic cones marking the mid choke.
  [coneUrl, 0.9, 9.0, 0],
  [coneUrl, -1.0, 5.5, 0],
  [coneUrl, 1.3, -6.0, 0],
  [coneUrl, -0.7, -9.0, 0],
];

// One placed prop: its scene mesh and static collider, so a shot that breaks it
// can pull both. Index-aligned with PROP_PLACEMENTS.
interface PlacedProp {
  mesh: Object3D;
  collider: import('@dimforge/rapier3d-compat').Collider;
}

/**
 * Breakable metadata index-aligned with PROP_PLACEMENTS: null for solid scenery,
 * else a { hp, broken, restsOn } record. `restsOn` is the placement index this
 * prop is stacked on (a preceding placement at the same x,z with stack 0), so
 * breaking the base cascades to the crate on top of it (breakables.ts).
 */
function buildBreakables(): (Breakable | null)[] {
  return PROP_PLACEMENTS.map(([url, x, z, , stack = 0], i) => {
    const hp = BREAKABLE_HP.get(url);
    if (hp === undefined) return null;
    let restsOn: number | null = null;
    if (stack > 0) {
      for (let j = i - 1; j >= 0; j--) {
        const pj = PROP_PLACEMENTS[j];
        if (pj && pj[1] === x && pj[2] === z) {
          restsOn = j;
          break;
        }
      }
    }
    return { hp, broken: false, restsOn };
  });
}

/**
 * Load each distinct prop glb once, clone it to every placement, flatten to unlit,
 * drop it onto the floor, and give it a static box collider matching its footprint.
 * Returns the placed props (mesh + collider) index-aligned with PROP_PLACEMENTS.
 */
async function placeProps(scene: Object3D, world: import('@dimforge/rapier3d-compat').World): Promise<PlacedProp[]> {
  const loader = new GLTFLoader();
  const urls = [...new Set(PROP_PLACEMENTS.map((p) => p[0]))];
  // Per model: the flattened root plus its local bounding box (measured once,
  // unrotated, at the origin — includes any node transforms baked into the glb).
  const models = new Map(
    await Promise.all(
      urls.map(async (url): Promise<[string, { root: Object3D; box: Box3 }]> => {
        const root = (await loader.loadAsync(url)).scene;
        root.traverse((o) => {
          if (o instanceof Mesh) {
            const src = o.material as MeshStandardMaterial;
            o.material = new MeshBasicMaterial({ map: src.map, color: src.color });
          }
        });
        return [url, { root, box: new Box3().setFromObject(root) }];
      }),
    ),
  );
  const size = new Vector3();
  const localCenter = new Vector3();
  const placed: PlacedProp[] = [];
  for (const [url, x, z, yaw, stack = 0] of PROP_PLACEMENTS) {
    const model = models.get(url);
    if (!model) continue;
    const { root, box } = model;
    box.getSize(size);
    box.getCenter(localCenter);
    // Drop the base to the floor: shift so box.min.y + posY = stack.
    const posY = stack - box.min.y;
    const prop = root.clone();
    prop.position.set(x, posY, z);
    prop.rotation.y = MathUtils.degToRad(yaw);
    scene.add(prop);
    // Collider: the model's local box, rotated by yaw about the Y axis and placed
    // at the prop's world position. Its horizontal centre offset rotates too.
    const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(yaw));
    const worldCenter = new Vector3(localCenter.x, 0, localCenter.z)
      .applyQuaternion(quat)
      .add(new Vector3(x, posY + localCenter.y, z));
    const collider = addStaticBox(world, worldCenter, { x: size.x / 2, y: size.y / 2, z: size.z / 2 }, quat);
    placed.push({ mesh: prop, collider });
  }
  return placed;
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (!canvas) throw new Error('missing #viewport canvas');

  const renderCtx = createRenderContext(canvas);
  const input = createInputManager(canvas);
  // AudioContext starts suspended until a user gesture — the same click that
  // engages pointer lock unlocks audio (core/audio.ts).
  canvas.addEventListener('click', resumeAudio);

  // Settings (sensitivity / world FOV / volume). The config object is the source
  // of truth; the panel mutates it and pushes each value live. Shown while out of
  // pointer lock (the menu state), hidden during play.
  const settings = { ...DEFAULT_SETTINGS };
  function applySettings(): void {
    input.state.sensitivity = settings.sensitivity;
    renderCtx.setWorldFov(settings.worldFovDeg);
    setMasterVolume(settings.volume);
  }
  const settingsPanel = createSettingsPanel(settings, applySettings);
  applySettings();
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) settingsPanel.hide();
    else settingsPanel.show();
  });
  settingsPanel.show();

  await initPhysics();
  const world = createWorld();
  buildMapColliders(world);

  // Map visuals: baked-lightmap glb (built by tools/blender/build_map.py) plus
  // procedural tiling surface detail (surfacetex.ts) and a gradient skybox
  // (sky.ts) whose sun matches the bake. Fog colour stays the horizon haze.
  const SKY = new Color(0x9fb8d6);
  renderCtx.scene.background = makeSky();
  renderCtx.scene.fog = new FogExp2(SKY.getHex(), 0.012);
  const mapRoot = await loadLightmappedMap(mapGlbUrl, mapKtx2Url, renderCtx.renderer);
  applySurfaceTextures(mapRoot);
  renderCtx.scene.add(mapRoot);

  // Decorative props scattered near the existing cover. Each gets a static box
  // collider from its measured footprint (see placeProps); dynamic prop bodies
  // are a later phase (physics/world.ts). World has no realtime lights, so each
  // glb's MeshStandardMaterial is flattened to unlit MeshBasic (keeping its baked
  // texture), same as the bot model above.
  const placedProps = await placeProps(renderCtx.scene, world);
  const breakables = buildBreakables();
  // Collider handle -> placement index, breakable props only, so a stray shot
  // finds the crate/barrel it hit and applies damage (breakables.ts cascade).
  const propByCollider = new Map<number, number>();
  placedProps.forEach((p, i) => {
    if (breakables[i]) propByCollider.set(p.collider.handle, i);
  });

  const nav = await loadNav(navUrl);

  const spawn = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);
  // Face the player from their spawn toward the enemy spawn (the map), not the
  // wall 3 m behind them. forward at yaw θ is (-sinθ, -cosθ), so θ = atan2(-dx, -dz)
  // of the spawn→CT vector points the camera down that line.
  input.state.yaw = Math.atan2(T_SPAWN[0] - CT_SPAWN[0], T_SPAWN[2] - CT_SPAWN[2]);
  const movementCtx = createMovementContext(world, spawn);
  const player = createPlayerState(spawn);

  // Fixed seed: the sim stays reproducible for a recorded trace. core/rng.ts is
  // the only randomness allowed under src/.
  const rng = makeRng(1);
  const shotDir = new Vector3();
  const shotOrigin = new Vector3();
  const hitNormal = new Vector3();
  const hitPoint = new Vector3();
  const muzzle = new Vector3(); // tracer/flash origin, ~a barrel-length ahead of the eye
  const tracerEnd = new Vector3();
  const decals = createDecals(renderCtx.scene);
  const vfx = createVfx(renderCtx.scene);

  // Impact surface per placed prop (wood crates/pallets, metal barrels/cans,
  // else the concrete default the map falls back to). Keyed by collider handle.
  const surfaceByCollider = new Map<number, Surface>();
  placedProps.forEach((p, i) => {
    const url = PROP_PLACEMENTS[i]?.[0];
    const surface: Surface =
      url === crateUrl || url === palletUrl ? 'wood' : url === barrelUrl || url === jerryUrl ? 'metal' : 'concrete';
    surfaceByCollider.set(p.collider.handle, surface);
  });
  // ponytail: bullets stop at the first thing they touch. Wallbang/penetration is
  // in docs/weapon-feel.md §6 as explicitly optional for the demo — add it when
  // there are walls thin enough for it to matter (Phase 3).
  const MAX_SHOT_DISTANCE = 100; // m; the greybox is 20 m across
  const STEP_STRIDE = 1.9; // m between footstep sounds at a walk/run

  // --- Enemy bots (CT). The human is the lone T; bots defend from CT spawn. ---
  // Placeholder capsule bodies until the character rig lands (Phase 5); each bot
  // is a full second player driving the shared movement (ai/bot.ts) + brain FSM.
  const BOT_WEAPON = WEAPONS.rifle;
  const BOT_MAX_HP = 100;
  interface Enemy {
    readonly brain: BotBrain;
    readonly root: Group; // wraps the cloned armature+skinned-mesh so we can position/yaw
    readonly anim: BotAnimState;
    readonly spawn: Vector3;
    alive: boolean;
    hp: number;
    fireCooldown: number;
  }
  // CT world-model (bots are CT). Baked-lighting world has no realtime lights,
  // so flatten the glb's MeshStandardMaterials to unlit MeshBasicMaterial.
  // The .glb now carries a skinned armature + three animation clips (idle/walk/
  // death). Loaded once; each bot clones the full skeleton+mesh hierarchy and
  // gets its own AnimationMixer. Template clips are shared across all mixers.
  // MeshBasicMaterial skins automatically for a SkinnedMesh in three r170 (no
  // `skinning` flag). Keep single materials single: each bot submesh is one
  // primitive with zero geometry groups, so a 1-element material *array* would
  // draw nothing (the renderer iterates groups) — the model goes invisible.
  const toBasic = (m: MeshStandardMaterial): MeshBasicMaterial => new MeshBasicMaterial({ color: m.color });
  function flattenMaterials(root: Object3D): void {
    root.traverse((o) => {
      if (o instanceof SkinnedMesh) {
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => toBasic(m as MeshStandardMaterial))
          : toBasic(o.material as MeshStandardMaterial);
      }
    });
  }
  const ctGltf = await new GLTFLoader().loadAsync(ctPlayerUrl);
  const ctTemplateScene = ctGltf.scene;
  const ctTemplateClips = ctGltf.animations;
  // We need the skinned mesh's skeleton alive on the loaded template so cloning
  // can bind the clone's SkinnedMesh to the clone's own Bone tree. The template
  // itself is never rendered; only its clones are.
  ctTemplateScene.traverse((o) => {
    if (o instanceof SkinnedMesh) o.frustumCulled = false;
  });
  flattenMaterials(ctTemplateScene);
  // Hide the template — it only exists so three.js can resolve the skeleton
  // reference during clone.
  ctTemplateScene.visible = false;
  renderCtx.scene.add(ctTemplateScene);

  // Three CT spawns fanned across their end cover, each patrolling the open
  // centre corridor (x in [-3, 3]) down toward T and back. The flanks hold cover
  // (west crate cluster, east platform); the middle is the killing lane, so the
  // bots contest it. findPath snaps each waypoint to the navmesh and routes
  // around cover, so bots roam instead of standing at spawn. y is the
  // walkable-surface height the nav query snaps to.
  const F = CT_SPAWN[1];
  const botSpawns: { s: Vector3; patrol: Vector3[] }[] = [
    { s: new Vector3(-2, F, 16), patrol: [new Vector3(-1, F, 8), new Vector3(-1, F, -8), new Vector3(-2, F, 16)] },
    { s: new Vector3(0, F, CT_SPAWN[2]), patrol: [new Vector3(0, F, 10), new Vector3(0, F, -10), new Vector3(0, F, 17)] },
    { s: new Vector3(4, F, 16), patrol: [new Vector3(2, F, 8), new Vector3(2, F, -8), new Vector3(4, F, 16)] },
  ];
  const enemies: Enemy[] = botSpawns.map(({ s, patrol }) => {
    const bot = createBot(world, s);
    const clone = cloneSkeleton(ctTemplateScene);
    clone.visible = true; // template is hidden; clones must be visible
    flattenMaterials(clone);
    const root = new Group();
    root.add(clone);
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = bot.yaw;
    renderCtx.scene.add(root);
    return {
      brain: createBrain(bot, DIFFICULTIES.normal, patrol),
      root,
      anim: createBotAnim(clone, ctTemplateClips),
      spawn: s,
      alive: true,
      hp: BOT_MAX_HP,
      fireCooldown: 0,
    };
  });
  // Map each bot's collider back to its Enemy so a player hitscan can find it.
  const byCollider = new Map<number, Enemy>(enemies.map((e) => [e.brain.bot.ctx.collider.handle, e]));
  const rayHit: { collider: import('@dimforge/rapier3d-compat').Collider | null } = { collider: null };
  const botEye = new Vector3();
  const botToPlayer = new Vector3();

  const round = createRoundState();
  let playerAlive = true;
  let health = 100;
  let armor = 100;
  let stepDist = 0; // metres walked since the last footstep (see STEP_STRIDE)

  const playerFeet = new Vector3(); // scratch: player feet, the bots' target
  const impact = new Vector3();

  function respawn(): void {
    playerAlive = true;
    health = 100;
    armor = 100;
    player.position.copy(spawn);
    player.velocity.set(0, 0, 0);
    player.onGround = false;
    for (const e of enemies) {
      e.alive = true;
      e.hp = BOT_MAX_HP;
      e.fireCooldown = 0;
      e.root.visible = true;
      e.brain.bot.ctx.collider.setEnabled(true);
      const b = e.brain.bot;
      b.state.position.copy(e.spawn);
      b.state.velocity.set(0, 0, 0);
      b.path = [];
      b.waypoint = 0;
      e.brain.mode = 'idle';
      e.brain.lastKnown = null;
      e.brain.reactionTimer = 0;
      e.root.position.set(e.spawn.x, e.spawn.y, e.spawn.z);
      resetBotAnim(e.anim);
    }
  }

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

  const view = (): ViewState => ({
    position: player.position.clone(),
    eyeHeight: player.eyeHeight,
    viewPunch: 0,
    punchYaw: 0,
    punchPitch: 0,
  });
  const prevView = view();
  const currView = view();

  // Centre-banner text for the current phase (empty during normal play).
  function bannerText(): string {
    if (round.phase === 'freezetime') return `FREEZE  ${Math.ceil(round.timer)}`;
    if (round.phase === 'over') return round.winner === 'T' ? 'YOU WIN' : 'YOU LOSE';
    if (!playerAlive) return 'DEAD';
    return '';
  }

  startLoop({
    tick(fixedDt): void {
      prevView.position.copy(currView.position);
      prevView.eyeHeight = currView.eyeHeight;
      prevView.viewPunch = currView.viewPunch;
      prevView.punchYaw = currView.punchYaw;
      prevView.punchPitch = currView.punchPitch;

      // Round loop drives freeze/live/reset. The human is T (1 alive when alive);
      // the bots are CT. Freezetime holds everyone still; reset respawns.
      const ctAlive = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
      const event = tickRound(round, DEFAULT_ROUND, playerAlive ? 1 : 0, ctAlive, fixedDt);
      if (event === 'reset') respawn();
      const live = round.phase === 'live';

      playerFeet.copy(player.position);

      if (live && playerAlive) {
        tickMovement(movementCtx, player, { buttons: input.state.buttons, yaw: input.state.yaw }, fixedDt);
        // Footsteps: a step every STEP_STRIDE metres of ground travel. Distance-
        // paced (not time-paced) so it speeds up when you run. The greybox floor
        // is concrete throughout — sample a real surface here if the map varies.
        const groundSpeed = player.onGround ? Math.hypot(player.velocity.x, player.velocity.z) : 0;
        stepDist += groundSpeed * fixedDt;
        if (groundSpeed > 0.5 && stepDist >= STEP_STRIDE) {
          stepDist = 0;
          playFootstep('concrete');
        } else if (groundSpeed <= 0.5) {
          stepDist = 0; // reset so the first step after stopping isn't instant
        }
      }

      // Bots: perceive the player, run the FSM, and shoot back.
      if (live) {
        for (const e of enemies) {
          if (!e.alive) continue;
          e.fireCooldown = Math.max(0, e.fireCooldown - fixedDt);
          const { fire } = tickBrain(e.brain, world, nav, rng, playerFeet, playerAlive, fixedDt);
          const botVel = e.brain.bot.state.velocity;
          const botSpeed = Math.hypot(botVel.x, botVel.z);
          driveBotAnim(e.anim, botSpeed, e.brain.bot.state.onGround, e.brain.mode, fixedDt);
          if (fire && e.fireCooldown === 0 && playerAlive) {
            e.fireCooldown = BOT_WEAPON.fireInterval;
            const b = e.brain.bot;
            botEye.set(b.state.position.x, b.state.position.y + EYE_HEIGHT_STANDING, b.state.position.z);
            botToPlayer.set(playerFeet.x, playerFeet.y + player.eyeHeight, playerFeet.z).sub(botEye);
            const dist = botToPlayer.length();
            // The brain only fires with LOS + on-target, so land the hit on the
            // torso (no player hitboxes yet — placeholder like the bot bodies).
            const dmg = computeDamage(BOT_WEAPON, dist, 'chest', armor);
            health -= dmg.health;
            armor -= dmg.armor;
            if (health <= 0) {
              health = 0;
              playerAlive = false;
            }
          }
        }
      }

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

      // Reload / fire only while idle (not mid-draw/holster/reload), alive, live.
      if (anim.state === 'idle' && live && playerAlive) {
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
            // The shot is a sound bots can hear → they investigate from idle.
            for (const e of enemies) if (e.alive) hearSound(e.brain, playerFeet);
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
              rayHit,
            );
            // Muzzle flash + tracer, whether or not the shot connects. Muzzle is
            // a barrel-length ahead of the eye; the tracer runs to the impact
            // (or to max range on a miss) so a whiff still reads as a shot fired.
            muzzle.copy(shotOrigin).addScaledVector(shot.direction, 0.35);
            tracerEnd.copy(shotOrigin).addScaledVector(shot.direction, distance ?? MAX_SHOT_DISTANCE);
            // The pistol is a suppressed USP-S — a much smaller, dimmer flash.
            vfx.muzzleFlash(muzzle, shot.direction, active.id === 'pistol' ? 0.3 : 1);
            vfx.tracer(muzzle, tracerEnd);
            if (distance !== null) {
              impact.copy(shotOrigin).addScaledVector(shot.direction, distance);
              const enemy = rayHit.collider ? byCollider.get(rayHit.collider.handle) : undefined;
              if (enemy && enemy.alive) {
                // Precise per-bone zone from the shot ray in the bot's frame;
                // fall back to the height band if it grazed the collider but
                // missed every bone box (an edge clip that still counts).
                const bp = enemy.brain.bot.state.position;
                const hitbox = hitboxRay(
                  shotOrigin.x, shotOrigin.y, shotOrigin.z,
                  shot.direction.x, shot.direction.y, shot.direction.z,
                  bp.x, bp.y, bp.z, enemy.brain.aim.yaw,
                ) ?? hitboxAt(bp.y, impact.y);
                enemy.hp -= computeDamage(weapon, distance, hitbox, 0).health;
                vfx.impact(impact, hitNormal, 'flesh'); // blood puff, no bullet hole
                playImpact('flesh');
                if (enemy.hp <= 0) {
                  enemy.alive = false;
                  enemy.root.visible = false;
                  enemy.brain.bot.ctx.collider.setEnabled(false); // corpse is a ghost
                  killBot(enemy.brain);
                }
              } else {
                // Not a bot: maybe a breakable prop. Damage it; break cascades to
                // anything stacked on top so nothing is left standing mid-air.
                const pi = rayHit.collider ? propByCollider.get(rayHit.collider.handle) : undefined;
                const dmg = pi === undefined ? 0 : computeDamage(weapon, distance, 'chest', 0).health;
                const broke = pi === undefined ? [] : damageProp(breakables, pi, dmg);
                for (const bi of broke) {
                  const pp = placedProps[bi];
                  if (!pp) continue;
                  renderCtx.scene.remove(pp.mesh);
                  pp.collider.setEnabled(false); // gone: no invisible box to bump/stand on
                }
                // Surface drives the puff colour + impact tick; the map has no
                // collider→surface entry, so it falls back to concrete.
                const surface = (rayHit.collider ? surfaceByCollider.get(rayHit.collider.handle) : undefined) ?? 'concrete';
                vfx.impact(impact, hitNormal, surface);
                playImpact(surface);
                if (broke.length === 0 && SURFACE_FX[surface].decal) {
                  decals.add(hitPoint.copy(impact), hitNormal); // bullet mark
                }
              }
            }
          }
        }
      }

      currView.position.copy(player.position);
      currView.eyeHeight = player.eyeHeight;
      currView.viewPunch = player.viewPunch;
      currView.punchYaw = active.state.recoil.punch.yaw;
      currView.punchPitch = active.state.recoil.punch.pitch;
    },
    render(alpha, frameDt): void {
      renderCtx.stats.begin();
      updateViewCamera(renderCtx.camera, prevView, currView, alpha, input.state.yaw, input.state.pitch);
      vfx.update(frameDt); // age muzzle flash / tracers / impact puffs off real time

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

      // Bot world-models: position + yaw the wrapper group; the Bone
      // hierarchy sits inside it and AnimationMixer drives the poses.
      for (const e of enemies) {
        if (!e.alive) continue;
        const p = e.brain.bot.state.position;
        e.root.position.set(p.x, p.y, p.z);
        e.root.rotation.y = e.brain.aim.yaw;
      }

      renderCtx.render();
      hud.update(
        {
          health,
          armor,
          weapon,
          ammo: active.state.ammo,
          reloading: active.state.reloading,
          spreadRad: computeSpread(weapon, stanceOf(player), active.state.recoil.sprayIndex),
          round: round.round,
          score: round.score,
          banner: bannerText(),
        },
        MathUtils.degToRad(renderCtx.camera.fov),
        renderCtx.renderer.domElement.clientHeight,
      );
      renderCtx.stats.end();
    },
  });

  console.log(`Counter Douglas Global Offensive: sim locked at ${TICK_RATE} Hz — click to lock the mouse.`);
}

void main();

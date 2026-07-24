/**
 * The game session: world init (physics, WASM sim, map, props, nav, bots,
 * weapons) and the fixed-timestep loop. One session per page load — SP starts
 * via ?bots=&rounds=, MP via ?connect=; "Exit to Menu" reloads to a clean URL,
 * which is the whole teardown story.
 *
 * main.ts is the menu shell; it dynamic-imports this module only on a game
 * boot, so the menu path never loads the sim/rapier/three-scene machinery.
 *
 * The map's VISUALS come from the baked-lightmap glb (loadLightmappedMap); its
 * COLLISION stays the proven Rapier cuboids built by buildMapColliders (from the
 * same layout data), so the two align without shipping a collision mesh in the
 * glb. Baked lighting only — no realtime lights in the world scene (art-direction.md).
 */

import { Color, FogExp2, Group, MathUtils, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import mapGlbUrl from '../../assets/maps/de_douglas.glb?url';
import navUrl from '../../assets/maps/de_douglas.navmesh.bin?url';
import mapKtx2Url from '../../assets/maps/de_douglas/lightmap.ktx2?url';
import rifleUrl from '../../assets/weapons/ak_viewmodel.glb?url';
import pistolUrl from '../../assets/weapons/pistol_viewmodel.glb?url';
import { createBot } from '../ai/bot';
import { createBrain, DIFFICULTIES, hearSound, killBot, tickBrain, type BotBrain } from '../ai/brain';
import { SearchScore, nearestNode } from '../ai/navnodes';
import { canSee } from '../ai/perception';
import { botShotLands } from '../ai/aim';
import { loadNav } from '../ai/nav';
import { createBotAnim, driveBotAnim, resetBotAnim, type BotAnimState } from '../ai/anim';
import { applyWeaponPose, getWeaponMuzzle } from '../ai/thirdperson';
import { createRagdollWorld, despawnRagdollBody, ragdollExpired, spawnRagdollBody, type RagdollBody } from '../ai/ragdoll';
import { playFootstep, playGunshot, playHurt, playImpact, playReload } from '../core/audio';
import { type AuthState } from '../core/auth';
import { Buttons, type InputManager } from '../core/input';
import { createTeamMenu, type TeamChoice } from '../ui/teammenu';
import { createTraceRecorder } from '../core/trace_recorder';
import { startLoop, TICK_RATE } from '../core/loop';
import { makeRng } from '../core/rng';
import { damageProp, resetBrokenBreakables } from './breakables';
import { computeDamage } from './damage';
import { hitboxAt, hitboxRay } from './hitbox';
import { buildMapColliders, CT_SPAWN, MAP_BOXES, MAP_RAMPS, T_SPAWN, mapCuboids } from './map_douglas';
import { createRoundState, DEFAULT_MATCH, isMatchOver, tickRound, validateMatchConfig, type MatchConfig } from './round';
import { spawnRing } from './spawning';
import { baseCharacterColor, loadCharacterAssets, flattenMaterials, T_TINT, tintCharacter } from './characters';
import { BREAKABLE_HP, PROP_PLACEMENTS, buildBreakables, buildPropMesh, makeSign, placeProps, propBoxAt, propSurface } from './props';
import { EYE_HEIGHT_STANDING, PLAYER_RADIUS, STANDING_HALF_HEIGHT } from '../player/constants';
import { updateViewCamera, type ViewState } from '../player/camera';
import { createMovementContext, createPlayerState, type PlayerState } from '../player/movement';
import { moveSpectator } from '../player/spectator';
import { rayCast } from '../physics/shapecast';
import { addStaticBox, createWorld, initPhysics } from '../physics/world';
import { sim_add_box, sim_add_player, sim_add_prop_box, sim_add_ramp, sim_disable_prop_box, sim_get_state, sim_init, sim_reset_player, sim_set_player, sim_tick } from 'sim-wasm';
import { createConnection } from '../net/connection';
import { createPredictor, type Predictor } from '../net/prediction';
import { createInterpolationBuffer } from '../net/interpolation';
import { encodeCommand, encodeJoin } from '../net/protocol';
import { SPECTATOR, EV_FIRE, EV_KILL, F_ALIVE, F_TEAM_CT, type Snapshot } from '../net/protocol';
import { createDecals } from '../render/decals';
import { createVfx, SURFACE_FX, type Surface } from '../render/vfx';
import { loadLightmappedMap } from '../render/lightmap';
import { type RenderContext } from '../render/renderer';
import { makeSky } from '../render/sky';
import { applySurfaceTextures } from '../render/surfacetex';
import { createHud } from '../ui/hud';
import { createLoadingScreen } from '../ui/loading';
import { createScoreboard, type PlayerScore } from '../ui/scoreboard';
import { type ScreenManager } from '../ui/screens';
import { createPauseScreen, type PauseScreen } from '../ui/pause';
import { WEAPONS, type WeaponId } from '../weapons/defs';
import { createWeaponState, fireShot, startReload, tickWeapon, type WeaponState } from '../weapons/hitscan';
import { computeSpread, type Stance } from '../weapons/spread';
import {
  beginDraw,
  beginHolster,
  beginReload,
  createViewmodelAnim,
  onFire,
  tickViewmodelAnim,
  viewmodelPose,
  type AnimPose,
} from '../weapons/viewmodel';

/** Everything the session borrows from the menu shell (main.ts). */
export interface SessionContext {
  canvas: HTMLCanvasElement;
  renderCtx: RenderContext;
  input: InputManager;
  screens: ScreenManager;
  /** Live getter — auth resolves asynchronously in the shell. */
  auth(): AuthState | null;
  /** Validated ?connect= target, or null for a single-player boot. */
  validatedBootUrl: string | null;
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

// Bot gunshot audibility: linear falloff from full volume at 0 m to silence at
// this range. Mono Web Audio, no spatial panning — distance tail only.
const AUDIBLE_RANGE = 40; // m, matches SIGHT_RANGE
function falloff(dist: number): number {
  return MathUtils.clamp(1 - dist / AUDIBLE_RANGE, 0, 1);
}

export async function startGameSession(ctx: SessionContext): Promise<void> {
  const { canvas, renderCtx, input, screens, auth, validatedBootUrl } = ctx;

  // Loading screen. Six real boot stages, one step() as each finishes; done()
  // right before the loop starts, so the bar hits 100% only when we can spawn.
  const loading = createLoadingScreen(document.body, 6);

  // Pause menu (P/Esc during a game). Exit reloads to a clean URL → entry screen.
  const pauseScreen: PauseScreen = createPauseScreen({
    onResume: () => screens.enterGame(canvas),
    onSettings: () => screens.show('settings'),
    onExit: () => { location.href = location.origin + location.pathname; },
  });
  // The shell's onBeforeShow governs entry/settings/admin; the pause overlay is
  // session-owned, so it registers its own visibility hook.
  screens.onBeforeShow((id) => {
    if (id === 'pause') pauseScreen.show();
    else pauseScreen.hide();
  });

  const sendJoinRef: { fn: ((team: number) => void) | null } = { fn: null };

  // Match config — from the ?bots=&rounds= URL params the entry screen sets.
  let currentMatchConfig: MatchConfig = { ...DEFAULT_MATCH };
  {
    // `params.get` returns null for a missing key and Number(null) is 0, not NaN —
    // so presence must be tested with `has`, or ?bots=4 would also send roundsToWin: 0.
    const params = new URLSearchParams(location.search);
    const partial: { -readonly [K in keyof MatchConfig]?: MatchConfig[K] } = {};
    if (params.has('bots')) partial.botCount = Number(params.get('bots'));
    if (params.has('rounds')) partial.roundsToWin = Number(params.get('rounds'));
    const validated = validateMatchConfig(partial);
    if (validated.ok) currentMatchConfig = validated.value;
    else console.warn('ignoring match config in URL:', validated.errors.join('; '));
  }

  // Netcode: declared early so the connect/disconnect callbacks can capture
  // them. Assigned on connect; cleared on disconnect.
  let predictor: Predictor | null = null;
  let netConn: ReturnType<typeof createConnection> | null = null;
  let serverRoundTimeSec = -1;
  let serverScore: { t: number; ct: number } | null = null;
  let serverPhase = -1; // 0=freezetime, 1=live, 2=over; -1 = not synced yet
  let serverRoundsToWin = 0; // from Welcome; 0 = pre-Phase-16 server, no match end
  let lastSnapshot: Snapshot | null = null; // latest snapshot; drives the MP scoreboard
  // Single-player K/D tally for the local human (bots carry their own on the Enemy).
  let humanKills = 0;
  let humanDeaths = 0;
  const interpBuf = createInterpolationBuffer();

  // --- Game mode: menu | playing | spectating ---
  // Phase 9: on boot nobody is spawned. The team menu gates entry.
  type GameMode = 'menu' | 'playing' | 'spectating';
  let gameMode: GameMode = 'menu';
  let preMenuGameMode: GameMode = 'menu'; // saved before M-key opens the team menu
  let playerTeam: Team = 'T'; // overwritten on team choice

  // Overview position for the menu / spectator free-fly cam.
  const OVERVIEW_POS = new Vector3(0, 25, -30);
  const OVERVIEW_LOOK = new Vector3(0, 0, 0); // look at map center

  // Phase 9 SP roster: there is exactly one human, so at most one bot is benched at a
  // time. `benchedBot` is the bot the human currently displaces; `rebotPending` is a bot
  // owed to a team the human just left, reactivated at the next round reset (a bot never
  // replaces a player mid-round). Both reference `enemies`, defined below — only touched
  // from callbacks that fire after init.
  let benchedBot: Enemy | null = null;
  let rebotPending: Enemy | null = null;
  function benchBot(e: Enemy): void {
    e.active = false;
    e.alive = false;
    e.root.visible = false;
    e.brain.bot.collider.setEnabled(false);
  }
  // Free a seat on `team` for the human, benching a bot. Reclaims the seat if the human
  // is rejoining a team they left this round (no double-drop).
  function displaceBotFor(team: Team): Enemy | null {
    if (rebotPending && rebotPending.team === team) {
      const e = rebotPending; // already benched; stays the human's seat
      rebotPending = null;
      return e;
    }
    const e = enemies.find((b) => b.active && b.team === team) ?? null;
    if (e) benchBot(e);
    return e;
  }

  function enterGame(team: Team): void {
    // Human replaces a bot on `team` instantly. If they were on another team, that seat
    // gets its bot back next round.
    if (benchedBot && benchedBot.team !== team) {
      rebotPending = benchedBot;
      benchedBot = null;
    }
    if (!benchedBot || benchedBot.team !== team) benchedBot = displaceBotFor(team);
    playerTeam = team;
    const spawnPt = team === 'T' ? T_SPAWN : CT_SPAWN;
    spawn.set(spawnPt[0], spawnPt[1], spawnPt[2]);
    player.position.copy(spawn);
    player.velocity.set(0, 0, 0);
    playerAlive = true;
    health = 100;
    armor = 100;
    damageFlash = 0;
    shakeTime = 0;
    shakeIntensity = 0;
    sim_reset_player(0, spawn.x, spawn.y, spawn.z);
    bodyCenterScratch.set(spawn.x, spawn.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS, spawn.z);
    movementCtx.body.setTranslation(bodyCenterScratch, true);
    movementCtx.body.setEnabled(true);
    world.updateSceneQueries();
    const enemySpawnPt = team === 'T' ? CT_SPAWN : T_SPAWN;
    input.state.yaw = Math.atan2(spawnPt[0] - enemySpawnPt[0], spawnPt[2] - enemySpawnPt[2]);
    gameMode = 'playing';
    teamMenu.el.style.display = 'none';
    screens.enterGame(canvas);
  }

  function enterSpectator(): void {
    // The team the human vacated gets its bot back next round.
    if (benchedBot) { rebotPending = benchedBot; benchedBot = null; }
    gameMode = 'spectating';
    playerAlive = false;
    movementCtx.body.setEnabled(false);
    if (player.position.lengthSq() < 0.01) specPos.copy(OVERVIEW_POS);
    else {
      specPos.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
    }
  }

  // Team menu: shown on boot and any time the player picks a new team / spectate.
  const teamMenu = createTeamMenu((choice: TeamChoice) => {
    if (netConn && sendJoinRef.fn) {
      const teamByte = choice === 'T' ? 0 : choice === 'CT' ? 1 : 2;
      sendJoinRef.fn(teamByte);
      if (choice === 'spec') {
        enterSpectator();
        teamMenu.el.style.display = 'none';
        screens.enterGame(canvas);
      } else {
        playerTeam = choice;
        const spawnPt = choice === 'T' ? T_SPAWN : CT_SPAWN;
        spawn.set(spawnPt[0], spawnPt[1], spawnPt[2]);
        teamMenu.el.style.display = 'none';
        gameMode = 'playing';
        screens.enterGame(canvas);
      }
    } else {
      if (choice === 'spec') {
        enterSpectator();
        teamMenu.el.style.display = 'none';
        screens.enterGame(canvas);
      } else {
        enterGame(choice);
      }
    }
  });
  document.body.appendChild(teamMenu.el);
  teamMenu.onEsc = (): void => {
    teamMenu.el.style.display = 'none';
    gameMode = preMenuGameMode;
    if (gameMode !== 'menu') screens.enterGame(canvas);
    else screens.show('entry');
  };

  function handleConnect(url: string): void {
    if (netConn) {
      netConn.close();
      predictor = null;
    }
    const conn = createConnection();
    conn.onWelcome = (w): void => {
      serverRoundsToWin = w.roundsToWin;
      if (w.yourSlot === SPECTATOR) {
        teamMenu.setCounts(w.players, w.maxPlayers, w.spectators, w.specCap);
        teamMenu.el.style.display = 'flex';
        // The picked handle rides the ?name= param across the connect reload.
        const pickedName = new URLSearchParams(location.search).get('name') ?? undefined;
        sendJoinRef.fn = (team: number) => {
          conn.send(encodeJoin({ team, token: auth()?.token(), name: pickedName }));
          teamMenu.el.style.display = 'none';
        };
        return;
      }
      predictor = createPredictor(
        {
          tick: (b, y) => { sim_tick(0, b, y); },
          setPlayer: (px, py, pz, vx, vy, vz, ducked) =>
            sim_set_player(0, px, py, pz, vx, vy, vz, ducked),
        },
        w.yourSlot,
      );
      sendJoinRef.fn = null;
      console.log(`[net] connected as slot ${w.yourSlot}`);
    };
    conn.onBye = (reason): void => {
      console.warn(`[net] server said bye: ${reason}`);
      conn.close();
    };
    conn.onSnapshot = (s): void => {
      predictor?.reconcile(s);
      interpBuf.push(s);
      lastSnapshot = s;
      serverRoundTimeSec = s.round.timeLeftMs / 1000;
      serverScore = { t: s.round.scoreT, ct: s.round.scoreCt };
      serverPhase = s.round.phase;
      if (predictor) {
        const slot = predictor.ownSlot;
        const myEntity = s.entities.find(e => e.slot === slot);
        playerAlive = myEntity ? (myEntity.flags & F_ALIVE) !== 0 : false;
      }
      for (const ev of s.events) {
        if (ev.tag === EV_KILL && predictor && ev.slot === predictor.ownSlot) {
          playerAlive = false;
          specPos.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
          tintPlayerBody(playerTeam === 'CT');
          playerRagdoll = spawnRagdollBody(ragdollWorld, player.position, player.velocity, simTime);
        }
        if (ev.tag === EV_FIRE) pendingFireSlots.add(ev.slot);
      }
    };
    conn.onClose = (): void => {
      if (netConn !== conn) return;
      predictor = null;
      netConn = null;
      serverRoundTimeSec = -1;
      serverScore = null;
      serverPhase = -1;
      serverRoundsToWin = 0;
      lastSnapshot = null;
      sendJoinRef.fn = null;
    };
    conn.connect(url);
    netConn = conn;
    sendJoinRef.fn = null;
  }

  // P is the pause key. Escape is unreliable — the browser eats the keydown that
  // releases pointer lock, so it never reaches us. P toggles the pause menu.
  // (The settings-screen back-out branch lives in the shell, main.ts.)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyP' && e.code !== 'Escape') return;
    if (screens.isActive('in-game') && gameMode !== 'menu') {
      e.preventDefault();
      screens.show('pause');
    } else if (screens.isActive('pause')) {
      e.preventDefault();
      screens.enterGame(canvas);
    }
  });

  // Losing pointer lock some other way (Esc, alt-tab) while in a live game also
  // opens the pause menu, so the player is never stuck with a locked-but-frozen view.
  document.addEventListener('pointerlockchange', () => {
    if (screens.isActive('in-game') && gameMode !== 'menu' && document.pointerLockElement !== canvas) {
      screens.show('pause');
    }
  });

  await initPhysics();
  const world = createWorld();
  buildMapColliders(world);

  // WASM sim must be initialised before we add map colliders — sim_init creates
  // the inner PhysicsWorld that sim_add_box/sim_add_ramp will populate.
  const spawn = new Vector3(T_SPAWN[0], T_SPAWN[1], T_SPAWN[2]);
  sim_init(spawn.x, spawn.y, spawn.z);

  // Load the same map colliders into the WASM sim world (Phase 6.2). These are
  // independent of the TS Rapier world — the sim crate has its own PhysicsWorld.
  for (const b of MAP_BOXES) {
    sim_add_box(b.c[0], b.c[1], b.c[2], b.s[0] / 2, b.s[1] / 2, b.s[2] / 2, b.ry ?? 0);
  }
  for (const r of MAP_RAMPS) {
    sim_add_ramp(r.start[0], r.start[1], r.start[2], r.end[0], r.end[1], r.end[2], r.width, r.thickness);
  }
  loading.step('Loading map…');

  // Phase 12.3: separate Rapier world for cosmetic ragdoll bodies. Same static
  // map colliders so corpses tumble against walls/ramps; no kinematic bodies so
  // dead bots can never clip or shove the living (the walk-through guarantee).
  const ragdollWorld = createRagdollWorld(mapCuboids());

  // Map visuals: baked-lightmap glb (built by tools/blender/build_map.py) plus
  // procedural tiling surface detail (surfacetex.ts) and a gradient skybox
  // (sky.ts) whose sun matches the bake. Fog colour stays the horizon haze.
  const SKY = new Color(0x9fb8d6);
  renderCtx.scene.background = makeSky();
  renderCtx.scene.fog = new FogExp2(SKY.getHex(), 0.012);
  const mapRoot = await loadLightmappedMap(mapGlbUrl, mapKtx2Url, renderCtx.renderer);
  await applySurfaceTextures(mapRoot);
  renderCtx.scene.add(mapRoot);
  loading.step('Placing props…');

  // Decorative props scattered near the existing cover. Each gets a static box
  // collider from its measured footprint (see placeProps); dynamic prop bodies
  // are a later phase (physics/world.ts). World has no realtime lights, so each
  // glb's MeshStandardMaterial is flattened to unlit MeshBasic (keeping its baked
  // texture), same as the bot model above.
  const { placed: placedProps, templates: propTemplates } = await placeProps(renderCtx.scene, world);
  const breakables = buildBreakables();

  // Phase 13.4: spawn-area direction signs — simple canvas-textured quads that
  // read as set-dressing without adding new glb files to load.
  {
    const tSign = makeSign('spawn', 'right');
    tSign.position.set(-17, 2.2, -26);
    tSign.rotation.y = MathUtils.degToRad(90);
    renderCtx.scene.add(tSign);
    const ctSign = makeSign('spawn', 'left');
    ctSign.position.set(-17, 2.2, 26);
    ctSign.rotation.y = MathUtils.degToRad(-90);
    renderCtx.scene.add(ctSign);
  }
  // Collider handle -> placement index, breakable props only, so a stray shot
  // finds the crate/barrel it hit and applies damage (breakables.ts cascade).
  const propByCollider = new Map<number, number>();
  placedProps.forEach((p, i) => {
    if (breakables[i]) propByCollider.set(p.collider.handle, i);
  });

  // Add every prop (breakable or scenery) to the WASM sim world so player/bot
  // movement shapecasts collide against them.  Without this the sim world only
  // has the map structure and props are ghost objects you walk through.
  placedProps.forEach((_, i) => {
    const box = propBoxAt(i, propTemplates);
    if (!box) return;
    sim_add_prop_box(
      i,
      box.center.x, box.center.y, box.center.z,
      box.half.x, box.half.y, box.half.z,
      box.yawRad,
    );
  });

  loading.step('Loading navmesh…');
  const nav = await loadNav(navUrl);
  loading.step('Loading characters…');

  // Phase 9: player spawns at the origin initially (body disabled); enterGame()
  // or enterSpectator() positions the body when a team is chosen. The movement
  // context and kinematic body are still created now so everything that captures
  // them can do so, but the body is disabled until the player actually spawns.
  const movementCtx = createMovementContext(world, new Vector3(0, 0, 0));
  const player = createPlayerState(new Vector3(0, 0, 0));
  movementCtx.body.setEnabled(false); // disabled until a team is chosen
  // WASM sim owns the local player's movement (Phase 6.2). The TS player state
  // and kinematic body are still maintained for bot hit-detection and HUD reads,
  // but they are synced from sim_get_state() each tick rather than tickMovement().
  // sim_init() is already called above (before map collider loading).

  // Fixed seed: the sim stays reproducible for a recorded trace. core/rng.ts is
  // the only randomness allowed under src/.
  const rng = makeRng(1);
  const searchState = new SearchScore();
  let localTick = 0; // monotonic counter for the search-spread recency formula
  let simTime = 0; // accumulated sim time (s), used for ragdoll despawn timers
  // Phase 12.3: per-bot ragdoll bodies, spawned on death and despawned after a timer.
  const ragdolls = new Map<Enemy, RagdollBody>();
  const pendingFireSlots = new Set<number>(); // EV_FIRE slots for muzzle FX this frame
  const shotDir = new Vector3();
  const shotOrigin = new Vector3();
  const hitNormal = new Vector3();
  const hitPoint = new Vector3();
  const muzzle = new Vector3(); // tracer/flash origin, ~a barrel-length ahead of the eye
  const tracerEnd = new Vector3();
  const bodyCenterScratch = new Vector3(); // feet→capsule-center for body sync
  const decals = createDecals(renderCtx.scene);
  const vfx = createVfx(renderCtx.scene);

  // Impact surface per placed prop (wood crates/pallets, metal barrels/cans,
  // else the concrete default the map falls back to). Keyed by collider handle.
  const surfaceByCollider = new Map<number, Surface>();
  placedProps.forEach((p, i) => {
    surfaceByCollider.set(p.collider.handle, propSurface(PROP_PLACEMENTS[i]?.[0]));
  });
  // ponytail: bullets stop at the first thing they touch. Wallbang/penetration is
  // in docs/weapon-feel.md §6 as explicitly optional for the demo — add it when
  // there are walls thin enough for it to matter (Phase 3).
  const MAX_SHOT_DISTANCE = 100; // m; the greybox is 20 m across
  const STEP_STRIDE = 1.9; // m between footstep sounds at a walk/run

  // --- Bots. 3 per team by default; one is benched when the human picks that side. ---
  // Placeholder capsule bodies until the character rig lands (Phase 5); each bot
  // is a full second player driving the shared movement (ai/bot.ts) + brain FSM.
  const BOT_WEAPON = WEAPONS.rifle;
  const BOT_MAX_HP = 100;
  // Per-shot angular miss cone (rad, ~3.4°), resampled each shot. Projected to
  // the target plane, a shot lands only if it falls within the body radius — so
  // bots are lethal point-blank and increasingly sprayable with distance. This
  // is what replaced the old guaranteed-chest-hit (an aimbot). See ai/aim.ts.
  // ponytail: one spread for all bots (all 'normal'); make it per-Difficulty if
  // easy/hard bots ever ship.
  const BOT_AIM_SPREAD = 0.06;
  type Team = 'T' | 'CT';
  interface Enemy {
    readonly team: Team;
    readonly brain: BotBrain;
    readonly root: Group; // wraps the cloned armature+skinned-mesh so we can position/yaw
    readonly anim: BotAnimState;
    readonly spawn: Vector3;
    // Phase 9 roster: a bot is benched (active=false) when a human takes its slot —
    // hidden, no collider, never revived — until the human leaves and it backfills.
    active: boolean;
    alive: boolean;
    hp: number;
    fireCooldown: number;
    // Single-player scoreboard tally (multiplayer K/D is server-authoritative).
    kills: number;
    deaths: number;
  }

  // CT rig template + world-model weapons (game/characters.ts). The template is
  // added (hidden) to the scene so cloning can resolve the skeleton.
  const { ctTemplateScene, ctTemplateClips, attachBotWeapon } = await loadCharacterAssets(renderCtx.scene);
  loading.step('Loading weapons…');

  // Three CT bots spawn behind the CT spawn wall (west spine, +z end) and patrol
  // out: one holds the dense spine chokepoints down toward T, one contests mid,
  // one swings the sparse east curve flank. findPath snaps each waypoint to the
  // navmesh and routes around cover, so bots roam instead of standing at spawn.

  // Generate bot spawns from config. Splits count: half CT, rest T.
  const ctCount = Math.floor(currentMatchConfig.botCount / 2);
  const tCount = currentMatchConfig.botCount - ctCount;
  const botDefs: { team: Team; s: Vector3 }[] = [
    ...spawnRing('CT', ctCount).map((s) => ({ team: 'CT' as Team, s })),
    ...spawnRing('T', tCount).map((s) => ({ team: 'T' as Team, s })),
  ];
  const enemies: Enemy[] = botDefs.map(({ team, s }) => {
    const wasmIndex = sim_add_player(s.x, s.y, s.z);
    const bot = createBot(world, s, wasmIndex);
    const clone = cloneSkeleton(ctTemplateScene);
    clone.visible = true; // template is hidden; clones must be visible
    flattenMaterials(clone);
    if (team === 'T') tintCharacter(clone, T_TINT);
    attachBotWeapon(clone); // Bug 2: rifle in the bot's right hand
    const root = new Group();
    root.add(clone);
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = bot.yaw;
    renderCtx.scene.add(root);
    return {
      team,
      brain: createBrain(bot, DIFFICULTIES.normal),
      root,
      anim: createBotAnim(clone, ctTemplateClips),
      spawn: s,
      active: true,
      alive: true,
      hp: BOT_MAX_HP,
      fireCooldown: 0,
      kills: 0,
      deaths: 0,
    };
  });
  // Map each bot's collider back to its Enemy so a player hitscan can find it.
  const byCollider = new Map<number, Enemy>(enemies.map((e) => [e.brain.bot.collider.handle, e]));

  // --- Local player third-person body (Phase 12). Single-player is first-person,
  // so the only time you see your own avatar is the death cam: on death this CT
  // clone gets a ragdoll (same path as the bots) and the free-fly spectator watches
  // the corpse tumble. While alive it stays hidden — the FP camera sits inside it.
  const playerBodyClone = cloneSkeleton(ctTemplateScene);
  playerBodyClone.visible = true; // template is hidden; the clone must be visible
  flattenMaterials(playerBodyClone);
  attachBotWeapon(playerBodyClone, 'rifle');
  applyWeaponPose(playerBodyClone, 'rifle'); // static hold; no mixer drives this body
  const playerBody = new Group();
  playerBody.add(playerBodyClone);
  playerBody.visible = false;
  renderCtx.scene.add(playerBody);
  let playerRagdoll: RagdollBody | null = null;
  // CT keeps the baked colour; T gets the same tan tint as the bots. Applied at
  // death from the live playerTeam (you can switch sides between lives).
  const CT_BASE = baseCharacterColor(playerBodyClone);
  function tintPlayerBody(ct: boolean): void {
    tintCharacter(playerBodyClone, ct ? CT_BASE : T_TINT);
  }

  // --- Remote entities (Phase 6.4): networked players rendered from snapshot
  // interpolation. Each remote gets its own character mesh clone, created lazily
  // when a new slot appears and hidden when gone.
  const remoteRoots = new Map<number, Group>(); // slot → Group
  function remoteRootFor(slot: number, teamCt: boolean): Group {
    let root = remoteRoots.get(slot);
    if (!root) {
      const clone = cloneSkeleton(ctTemplateScene);
      clone.visible = true;
      flattenMaterials(clone);
      if (!teamCt) tintCharacter(clone, T_TINT);
      attachBotWeapon(clone, 'rifle');
      root = new Group();
      root.add(clone);
      root.visible = true;
      renderCtx.scene.add(root);
      remoteRoots.set(slot, root);
    }
    return root;
  }

  // The human plays the chosen team (set in enterGame / enterSpectator).
  // Nearest ALIVE, VISIBLE enemy for a given bot. Returns the human sentinel,
  // an Enemy, or null (nobody in sight → the brain patrols/repositions).
  type Target = Enemy | 'human' | null;
  function pickTarget(me: Enemy): Target {
    const from = me.brain.bot.position;
    const yaw = me.brain.aim.yaw;
    const coll = me.brain.bot.collider;
    let best: Target = null;
    let bestD = Infinity;
    if (me.team !== playerTeam && playerAlive) {
      const d = from.distanceToSquared(playerFeet);
      if (d < bestD && canSee(world, from, yaw, playerFeet, coll)) {
        bestD = d;
        best = 'human';
      }
    }
    for (const other of enemies) {
      if (other === me || !other.alive || other.team === me.team) continue;
      const d = from.distanceToSquared(other.brain.bot.position);
      if (d < bestD && canSee(world, from, yaw, other.brain.bot.position, coll)) {
        bestD = d;
        best = other;
      }
    }
    return best;
  }
  const rayHit: { collider: import('@dimforge/rapier3d-compat').Collider | null } = { collider: null };
  const botEye = new Vector3();
  const botToPlayer = new Vector3();

  const round = createRoundState();
  let playerAlive = false; // Phase 9: not alive until a team is chosen
  let health = 100;
  let armor = 100;
  let stepDist = 0; // metres walked since the last footstep (see STEP_STRIDE)
  // Bug 3: free-fly spectator position while dead. Seeded from the death eye.
  const specPos = new Vector3().copy(OVERVIEW_POS); // start at overview; moves during spectating

  // Damage feedback: red flash, screen shake, hurt sound.
  let damageFlash = 0;
  let shakeTime = 0;      // remaining shake duration (s)
  let shakeIntensity = 0; // base amplitude (m), proportional to last hit
  let shakeX = 0;         // current tick's random offset X
  let shakeY = 0;         // current tick's random offset Y
  let prevShakeX = 0;     // previous tick's offset, for render interpolation
  let prevShakeY = 0;

  const playerFeet = new Vector3(); // scratch: player feet, the bots' target
  const impact = new Vector3();

  /** Round-reset: re-create broken props from their cached templates so the
   *  map resets clean. Restores bottom-up (bases before stacked items) so
   *  `restsOn` cascade links stay valid. Mutates placedProps, breakables,
   *  propByCollider, and the world collider set. */
  function restoreBreakables(): void {
    // Pure part (broken detection + hp/broken reset) is the tested helper.
    const reset = resetBrokenBreakables(breakables, BREAKABLE_HP, (i) => PROP_PLACEMENTS[i]![0]);
    // Rebuild meshes/colliders bases-first (restsOn===null) so stacked items
    // sit on a restored base, matching how placeProps built them.
    reset.sort((a, b) => (breakables[a]?.restsOn ?? -1) - (breakables[b]?.restsOn ?? -1));
    for (const i of reset) {
      const prop = buildPropMesh(i, propTemplates);
      const box = propBoxAt(i, propTemplates);
      if (!prop || !box) continue;
      renderCtx.scene.add(prop);
      const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), box.yawRad);
      const collider = addStaticBox(world, box.center, box.half, quat);
      placedProps[i] = { mesh: prop, collider };
      propByCollider.set(collider.handle, i);
      // Re-enable the matching sim-world collider so players/bots collide
      // against the restored prop again.
      sim_add_prop_box(
        i,
        box.center.x, box.center.y, box.center.z,
        box.half.x, box.half.y, box.half.z,
        box.yawRad,
      );
    }
  }

  function respawn(): void {
    // A bot owed to a team the human left backfills now, at the round boundary.
    if (rebotPending) { rebotPending.active = true; rebotPending = null; }
    // Only the human revives — spectators stay out.
    if (gameMode === 'playing') {
      playerAlive = true;
      // Phase 12: discard any lingering player corpse from the previous life.
      if (playerRagdoll) { despawnRagdollBody(playerRagdoll); playerRagdoll = null; }
      playerBody.visible = false;
      health = 100;
      armor = 100;
      damageFlash = 0;
      shakeTime = 0;
      shakeIntensity = 0;
      // Fresh magazines for the new round — no ammo carry-over.
      for (const held of Object.values(weapons)) {
        held.state = createWeaponState(WEAPONS[held.id]);
      }
      if (!predictor || !netConn) {
        player.position.copy(spawn);
        player.velocity.set(0, 0, 0);
        player.onGround = false;
        sim_reset_player(0, spawn.x, spawn.y, spawn.z);
        bodyCenterScratch.set(
          spawn.x, spawn.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS, spawn.z,
        );
        movementCtx.body.setTranslation(bodyCenterScratch, true);
      }
    }
    for (const e of enemies) {
      if (!e.active) continue; // benched: stays hidden/dead while the human holds its seat
      e.alive = true;
      e.hp = BOT_MAX_HP;
      e.fireCooldown = 0;
      e.root.visible = true;
      // Phase 12.3: discard any lingering ragdoll body from the previous death.
      const oldRagdoll = ragdolls.get(e);
      if (oldRagdoll) {
        despawnRagdollBody(oldRagdoll);
        ragdolls.delete(e);
      }
      const b = e.brain.bot;
      b.collider.setEnabled(true);
      b.position.copy(e.spawn);
      b.velocity.set(0, 0, 0);
      b.path = [];
      b.waypoint = 0;
      sim_reset_player(b.wasmIndex, e.spawn.x, e.spawn.y, e.spawn.z);
      e.brain.mode = 'search';
      e.brain.lastKnown = null;
      e.brain.reactionTimer = 0;
      // Reseed the search goal to the spawn node so tick 1 re-picks immediately
      // (else the bot walks to a stale cross-map goal from the previous round).
      e.brain.currentNode = nearestNode(e.spawn.x, e.spawn.y, e.spawn.z);
      e.brain.pathGoalNode = e.brain.currentNode;
      e.root.position.set(e.spawn.x, e.spawn.y, e.spawn.z);
      resetBotAnim(e.anim);
      // Sync the collider to the spawn position now. Without this
      // setTranslation the re-enabled collider sits at its last-known
      // (death-site) position for a full tick, where it blocks nothing.
      bodyCenterScratch.set(
        e.spawn.x, e.spawn.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS, e.spawn.z,
      );
      b.collider.setTranslation(bodyCenterScratch);
      b.body.setTranslation(bodyCenterScratch, true);
    }
    // Flush the query BVH so the very next raycast (human fire or bot
    // perception) sees every capsule at its fresh spawn position.
    world.updateSceneQueries();
    // Phase 12.3: clear pending fire events on round reset so stale EV_FIRE
    // from the previous round don't linger.
    pendingFireSlots.clear();
    // Phase 13.3: restore any breakable props destroyed in the previous round.
    restoreBreakables();
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
  loading.step('Ready');
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
  const scoreboard = createScoreboard();
  document.body.appendChild(scoreboard.el);

  // Input trace recorder — press F2 to dump the last ~30 s of input to console.
  // Active only when ?record in the URL; otherwise a no-op on the hot path.
  const traceRecorder = createTraceRecorder();

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
    if (predictor) {
      if (serverPhase === 0) return `FREEZE  ${Math.ceil(serverRoundTimeSec)}`;
      if (serverPhase === 2) {
        const sc = serverScore;
        if (sc && isMatchOver(sc.t, sc.ct, serverRoundsToWin)) {
          return `MATCH OVER   T ${sc.t} : ${sc.ct} CT   —   new game in ${Math.ceil(serverRoundTimeSec)}`;
        }
        if (gameMode !== 'playing') return `ROUND OVER   ...`;
        return 'ROUND OVER';
      }
      if (!playerAlive) return 'SPECTATING';
      return '';
    }
    if (round.matchOver) return `MATCH OVER   T ${round.score.t} : ${round.score.ct} CT   —   new game in ${Math.ceil(round.timer)}`;
    if (round.phase === 'freezetime') return `FREEZE  ${Math.ceil(round.timer)}`;
    if (round.phase === 'over') {
      if (gameMode !== 'playing') return `ROUND OVER   ${round.winner} WINS`;
      return round.winner === playerTeam ? 'YOU WIN' : 'YOU LOSE';
    }
    if (!playerAlive) return 'SPECTATING';
    return '';
  }

  // --- Auto-connect from ?connect=ws://host:port URL parameter.
  if (validatedBootUrl) {
    handleConnect(validatedBootUrl);
  }

  loading.done();
  startLoop({
    tick(fixedDt): void {
      // M key: open the team menu mid-game to switch teams / spectate.
      if (input.state.teamMenuToggle) {
        preMenuGameMode = gameMode;
        gameMode = 'menu';
        document.exitPointerLock();
        teamMenu.el.style.display = 'flex';
        input.state.teamMenuToggle = 0;
      }
      // Phase 9: while the team menu is visible, nothing is simulated.
      // The overview camera is driven by the render function below.
      if (gameMode === 'menu') return;

      localTick++;
      simTime += fixedDt;

      // updateSceneQueries is called AFTER the human sync (so bots can see
      // the player at the current position) and AGAIN after the bot sync (so
      // the player's raycast sees bots at the current position). The BVH
      // must be rebuilt after colliders move — building it first means
      // every query works on stale (previous-tick) positions.

      prevView.position.copy(currView.position);
      prevView.eyeHeight = currView.eyeHeight;
      prevView.viewPunch = currView.viewPunch;
      prevView.punchYaw = currView.punchYaw;
      prevView.punchPitch = currView.punchPitch;

      // Round loop drives freeze/live/reset. Count the human on their chosen team (only
      // when actually playing — a spectator counts for neither side). Reset respawns.
      const humanPlaying = gameMode === 'playing' && playerAlive;
      let tAlive = humanPlaying && playerTeam === 'T' ? 1 : 0;
      let ctAlive = humanPlaying && playerTeam === 'CT' ? 1 : 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (e.team === 'CT') ctAlive++;
        else tAlive++;
      }
      const event = predictor ? 'none' : tickRound(round, currentMatchConfig, tAlive, ctAlive, fixedDt);
      if (!predictor && event === 'reset') respawn();
      const live = predictor
        ? (serverPhase === 1 && playerAlive)
        : (!round.matchOver && round.phase === 'live');

      playerFeet.copy(player.position);

      if (live && playerAlive) {
        if (predictor && netConn) {
          // Networked: predict locally (advances the WASM sim) and ship the
          // command; reconciliation happens async in onSnapshot. Same sim read
          // below either way.
          const cmd = predictor.predict(input.state.buttons, input.state.yaw, input.state.pitch, active.id === 'rifle' ? 1 : 2);
          netConn.send(encodeCommand(cmd));
        } else {
          sim_tick(0, input.state.buttons, input.state.yaw);
        }
        const s = sim_get_state(0);
        player.position.set(s[0]!, s[1]!, s[2]!);
        player.velocity.set(s[3]!, s[4]!, s[5]!);
        player.onGround = s[6]! === 1;
        player.eyeHeight = s[7]!;
        player.viewPunch = s[8]!;
        player.duckAmount = s[9]!;
        player.ducked = player.duckAmount > 0.5;
        // Sync kinematic body so bots can hit-detect the player.
        bodyCenterScratch.set(
          player.position.x,
          player.position.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS,
          player.position.z,
        );
        movementCtx.body.setTranslation(bodyCenterScratch, true);
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
      world.updateSceneQueries(); // bot perception: human body at current tick position

      // Bug 3: while dead, free-fly the spectator cam (noclip). Does not touch
      // the WASM sim or player state — purely a render-camera position.
      if (!playerAlive && !round.matchOver) {
        moveSpectator(specPos, input.state.buttons, input.state.yaw, input.state.pitch, fixedDt);
      }

      // Bots (both teams): pick the nearest visible enemy, run the FSM, shoot.
      // In networked mode the server is authoritative for all entities; local bot
      // simulation would create duplicate models and waste CPU on shadow sim ticks.
      if (live && !predictor) {
        for (const e of enemies) {
          if (!e.alive) continue;
          e.fireCooldown = Math.max(0, e.fireCooldown - fixedDt);
          // Nearest visible enemy this tick (human or an opposing bot).
          const target = pickTarget(e);
          const targetAlive = target === 'human' ? playerAlive : target !== null && target.alive;
          const targetFeet = target === 'human' ? playerFeet : target ? target.brain.bot.position : playerFeet;
          // Build teammate positions for spread-out search (same-team, excl. self).
          const teammateFeet: Vector3[] = [];
          const teammateGoals: number[] = [];
          for (const other of enemies) {
            if (other === e || !other.alive) continue;
            if (other.team !== e.team) continue;
            teammateFeet.push(other.brain.bot.position);
            teammateGoals.push(other.brain.pathGoalNode);
          }
          const { fire, buttons, yaw } = tickBrain(
            e.brain, world, nav, rng, targetFeet, targetAlive, fixedDt,
            searchState, teammateFeet, localTick, teammateGoals,
          );
          // Apply WASM movement for this bot, then sync the TS kinematic body
          // so perception and hit-detection are up-to-date.
          const bs = sim_tick(e.brain.bot.wasmIndex, buttons, yaw);
          const b = e.brain.bot;
          b.position.set(bs[0]!, bs[1]!, bs[2]!);
          b.velocity.set(bs[3]!, bs[4]!, bs[5]!);
          b.onGround = bs[6]! === 1;
          b.eyeHeight = bs[7]!;
          b.duckAmount = bs[9]!;
          bodyCenterScratch.set(b.position.x, b.position.y + STANDING_HALF_HEIGHT + PLAYER_RADIUS, b.position.z);
          b.collider.setTranslation(bodyCenterScratch);
          b.body.setTranslation(bodyCenterScratch, true);
          const botSpeed = Math.hypot(b.velocity.x, b.velocity.z);
          driveBotAnim(e.anim, botSpeed, b.onGround, e.brain.mode, fixedDt);
          applyWeaponPose(e.root, 'rifle');
          if (fire && e.fireCooldown === 0 && target !== null && targetAlive) {
            e.fireCooldown = BOT_WEAPON.fireInterval;
            // Third-person muzzle flash + tracer from the bot's weapon (Phase 12.2).
            const wm = getWeaponMuzzle(e.root);
            if (wm) {
              vfx.muzzleFlash(wm.pos, wm.dir);
              vfx.tracer(wm.pos, wm.dir.clone().multiplyScalar(100).add(wm.pos));
            }
            botEye.set(b.position.x, b.position.y + EYE_HEIGHT_STANDING, b.position.z);
            const teye = target === 'human' ? player.eyeHeight : EYE_HEIGHT_STANDING;
            botToPlayer.set(targetFeet.x, targetFeet.y + teye, targetFeet.z).sub(botEye);
            const dist = botToPlayer.length();
            // Per-shot miss roll (deterministic via seeded rng). Only a landed
            // shot deals damage — no more guaranteed chest hits.
            if (botShotLands(dist, BOT_AIM_SPREAD, rng.next(), rng.next())) {
              if (target === 'human') {
                const dmg = computeDamage(BOT_WEAPON, dist, 'chest', armor);
                health -= dmg.health;
                armor -= dmg.armor;
                // Damage feedback: red flash, screen shake, hurt sound.
                damageFlash = Math.min(1, dmg.health / 25);
                shakeTime = 0.15;
                shakeIntensity = Math.min(0.03, dmg.health / 500);
                playHurt();
                if (health <= 0) {
                  health = 0;
                  playerAlive = false;
                  humanDeaths += 1;
                  e.kills += 1;
                  // Bug 3: enter free-fly spectator from the death eye position.
                  specPos.set(player.position.x, player.position.y + player.eyeHeight, player.position.z);
                  // Phase 12: ragdoll the player body so the spectator cam sees the corpse.
                  tintPlayerBody(playerTeam === 'CT');
                  playerRagdoll = spawnRagdollBody(ragdollWorld, player.position, player.velocity, simTime);
                }
              } else {
                target.hp -= computeDamage(BOT_WEAPON, dist, 'chest', 0).health;
                if (target.hp <= 0) {
                  target.alive = false;
                  target.deaths += 1;
                  e.kills += 1;
                  target.brain.bot.collider.setEnabled(false);
                  killBot(target.brain);
                  // Phase 12.3: spawn a cosmetic ragdoll body at the death position
                  // with the death-frame velocity (the body carries momentum).
                  const bp = target.brain.bot.position;
                  const bv = target.brain.bot.velocity;
                  const rbody = spawnRagdollBody(ragdollWorld, bp, bv, simTime);
                  ragdolls.set(target, rbody);
                }
              }
            }
            // Bot gunshot audio: distance-attenuated mono. A whiff is still a
            // bang — play for every shot, not only landed hits. Gate on
            // AUDIBLE_RANGE so the far side of the map stays quiet.
            if (dist < AUDIBLE_RANGE) playGunshot('rifle', falloff(dist));
          }
        }
      }
      world.updateSceneQueries(); // player fire: bot colliders at current tick position

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
            for (const e of enemies) if (e.alive && e.team !== playerTeam) hearSound(e.brain, playerFeet);
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
              // Friendly fire off: teammate bullets pass through (no damage), but
              // a hit on an enemy bot resolves the precise hitbox below.
              if (enemy && enemy.alive && enemy.team === playerTeam) {
                // Teammate — bullet absorbed, no effect.
              } else if (enemy && enemy.alive) {
                // Precise per-bone zone from the shot ray in the bot's frame;
                // fall back to the height band if it grazed the collider but
                // missed every bone box (an edge clip that still counts).
                const bp = enemy.brain.bot.position;
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
                  enemy.deaths += 1;
                  humanKills += 1;
                  enemy.brain.bot.collider.setEnabled(false);
                  killBot(enemy.brain);
                  const bp = enemy.brain.bot.position;
                  const bv = enemy.brain.bot.velocity;
                  const rbody = spawnRagdollBody(ragdollWorld, bp, bv, simTime);
                  ragdolls.set(enemy, rbody);
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
                  sim_disable_prop_box(bi); // also remove from sim movement collision
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

      // Decay damage feedback each sim tick.
      if (shakeTime > 0) {
        prevShakeX = shakeX;
        prevShakeY = shakeY;
        shakeTime -= fixedDt;
        if (shakeTime <= 0) {
          shakeTime = 0;
          shakeIntensity = 0;
          shakeX = 0;
          shakeY = 0;
        } else {
          const s = shakeIntensity * (shakeTime / 0.15);
          shakeX = (rng.next() - 0.5) * s * 2;
          shakeY = (rng.next() - 0.5) * s * 2;
        }
      }
      damageFlash = Math.max(0, damageFlash - fixedDt * 4);

      traceRecorder.push({ buttons: input.state.buttons, yaw: input.state.yaw });
    },
    render(alpha, frameDt): void {
      renderCtx.stats.begin();
      if (gameMode === 'menu') {
        // Overview camera: fixed angle looking at the map centre.
        renderCtx.camera.position.copy(OVERVIEW_POS);
        const dir = new Vector3().subVectors(OVERVIEW_LOOK, OVERVIEW_POS).normalize();
        // Compute yaw/pitch from the look-at direction so the camera faces centre.
        const flatLen = Math.hypot(dir.x, dir.z);
        const yaw = Math.atan2(-dir.x, -dir.z);
        const pitchUp = Math.atan2(dir.y, flatLen);
        renderCtx.camera.rotation.order = 'YXZ';
        renderCtx.camera.rotation.set(-pitchUp, yaw, 0);
      } else if (!playerAlive && !round.matchOver) {
        // Bug 3: spectator free-fly — pose the camera straight at specPos
        // (eyeHeight 0, no punch) instead of the frozen corpse view.
        renderCtx.camera.position.copy(specPos);
        renderCtx.camera.rotation.order = 'YXZ';
        renderCtx.camera.rotation.set(input.state.pitch, input.state.yaw, 0);
      } else {
        updateViewCamera(renderCtx.camera, prevView, currView, alpha, input.state.yaw, input.state.pitch);
        // Apply screen shake from damage feedback (lerped between sim ticks).
        if (shakeTime > 0) {
          renderCtx.camera.position.x += prevShakeX + (shakeX - prevShakeX) * alpha;
          renderCtx.camera.position.y += prevShakeY + (shakeY - prevShakeY) * alpha;
        }
      }
      vfx.update(frameDt); // age muzzle flash / tracers / impact puffs off real time

      // Apply the viewmodel anim pose on top of the active weapon's rest pose.
      // ponytail: read straight off the last sim tick, no render interpolation —
      // the kick/reload move fast and 64 Hz stepping is imperceptible on the gun.
      // Hide the welded viewmodel while spectating/match-over (no eye to hold it).
      active.root.visible = playerAlive && !round.matchOver;
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
      // In networked mode the server is authoritative for all entity
      // positions — render those through remoteRootFor below.
      if (!predictor) {
        for (const e of enemies) {
          if (e.alive) {
            const p = e.brain.bot.position;
            e.root.position.set(p.x, p.y, p.z);
            // Full reset, not just .y: a prior death drives e.root.quaternion from
            // the ragdoll (tumbled), leaving nonzero X/Z Euler. Setting only .y on
            // respawn keeps that tilt — the bot stands upright only if we clear it.
            e.root.rotation.set(0, e.brain.aim.yaw, 0);
          } else {
            // Phase 12.3: dead bots may have a ragdoll body. Drive the model
            // from the ragdoll transform; despawn when the timer expires.
            const r = ragdolls.get(e);
            if (r) {
              if (ragdollExpired(r, simTime)) {
                despawnRagdollBody(r);
                ragdolls.delete(e);
                e.root.visible = false;
                continue;
              }
              e.root.visible = true;
              const t = r.body.translation();
              e.root.position.set(t.x, t.y - PLAYER_RADIUS * 0.5, t.z);
              const q = r.body.rotation();
              e.root.quaternion.set(q.x, q.y, q.z, q.w);
            }
          }
        }
      }

      // Local player body: driven by the ragdoll while dead, hidden while alive.
      if (playerRagdoll) {
        if (ragdollExpired(playerRagdoll, simTime)) {
          despawnRagdollBody(playerRagdoll);
          playerRagdoll = null;
          playerBody.visible = false;
        } else {
          playerBody.visible = true;
          const t = playerRagdoll.body.translation();
          playerBody.position.set(t.x, t.y - PLAYER_RADIUS * 0.5, t.z);
          const q = playerRagdoll.body.rotation();
          playerBody.quaternion.set(q.x, q.y, q.z, q.w);
        }
      } else {
        playerBody.visible = false;
      }

      // Remote entities (Phase 6.4): interpolated networked players driven
      // by snapshot data from the authoritative server.
      if (predictor) {
        const mySlot = predictor.ownSlot;
        const remotes = interpBuf.interpolate(mySlot);
        for (const r of remotes) {
          const root = remoteRootFor(r.slot, r.teamCt);
          if (r.alive) {
            root.visible = true;
            root.position.set(r.pos[0], r.pos[1], r.pos[2]);
            root.rotation.y = r.yaw;
            // Phase 12.1: apply weapon-hold pose to remote models.
            applyWeaponPose(root, 'rifle');
            // Phase 12.2: spawn muzzle FX from pending EV_FIRE events.
            if (pendingFireSlots.delete(r.slot)) {
              const wm = getWeaponMuzzle(root);
              if (wm) {
                vfx.muzzleFlash(wm.pos, wm.dir);
                vfx.tracer(wm.pos, wm.dir.clone().multiplyScalar(100).add(wm.pos));
              }
            }
          } else {
            root.visible = false;
          }
        }
        // Hide roots for slots no longer in the snapshot (disconnected).
        const activeSlots = new Set(remotes.map((r) => r.slot));
        for (const [slot, root] of remoteRoots) {
          if (!activeSlots.has(slot)) root.visible = false;
        }
      }
      // Clear any fire events we couldn't deliver (e.g. slot not in this snapshot
      // yet, or stale event from a disconnected player). Don't let them pile up.
      pendingFireSlots.clear();

      // Phase 12.3: step the ragdoll world each render frame so dynamic bodies
      // respond to gravity and collide with the static map geometry.
      ragdollWorld.step();

      renderCtx.render();
      hud.update(
        {
          health,
          armor,
          weapon,
          ammo: active.state.ammo,
          reloading: active.state.reloading,
          spreadRad: computeSpread(weapon, stanceOf(player), active.state.recoil.sprayIndex),
          // ponytail: round # isn't on the wire; derive it from the synced score
          // (games played + 1). Holds while every round yields exactly one winner.
          round: serverScore ? serverScore.t + serverScore.ct + 1 : round.round,
          score: serverScore ?? round.score,
          timeLeft: serverRoundTimeSec >= 0 ? serverRoundTimeSec : round.timer,
          banner: bannerText(),
          damageFlash,
        },
        MathUtils.degToRad(renderCtx.camera.fov),
        renderCtx.renderer.domElement.clientHeight,
      );
      // Scoreboard roster. Multiplayer is server-authoritative — names and K/D
      // come straight off the latest snapshot. Single-player is tallied locally.
      const roster: PlayerScore[] = [];
      if (predictor) {
        for (const ent of lastSnapshot?.entities ?? []) {
          roster.push({
            slot: ent.slot,
            team: (ent.flags & F_TEAM_CT) !== 0 ? 'CT' : 'T',
            name: ent.name || `Bot ${ent.slot + 1}`,
            kills: ent.kills,
            deaths: ent.deaths,
            alive: (ent.flags & F_ALIVE) !== 0,
          });
        }
      } else {
        if (gameMode === 'playing') {
          roster.push({
            slot: 0, team: playerTeam, name: 'You',
            kills: humanKills, deaths: humanDeaths, alive: playerAlive,
          });
        }
        // Benched bots (the human's seat) are out of the roster.
        enemies.forEach((e, i) => {
          if (!e.active) return;
          roster.push({ slot: i + 1, team: e.team, name: `Bot ${i + 1}`, kills: e.kills, deaths: e.deaths, alive: e.alive });
        });
      }
      scoreboard.render(roster);
      const teamMenuShown = teamMenu.el.style.display !== 'none';
      if (teamMenuShown) {
        teamMenu.renderScoreboard(roster);
      }
      scoreboard.visible = input.state.scoreboard || teamMenuShown;
      renderCtx.stats.end();
    },
  });

  console.log(`Counter Douglas Globally Offended: sim locked at ${TICK_RATE} Hz — click to lock the mouse.`);
}

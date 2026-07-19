/**
 * Combat juice — Phase 5. The transient effects that give a shot weight:
 * muzzle flash, tracer, and a surface-typed impact puff (grey spark on the
 * world, blood on a bot). All pooled into three scene objects total, so firing
 * a thousand rounds never grows the scene graph or the draw-call count. No
 * per-shot allocation; scratch is module-level.
 *
 * This is a render-side sink, exactly like audio.ts: the deterministic sim
 * decides *when* something is hit and calls in here with world coordinates.
 * Nothing here is read back into sim state, and it ages off real frame dt
 * (passed from core/loop.ts) — never the fixed tick.
 *
 * On lights: art-direction.md forbids realtime scene lights, and the plan's
 * "muzzle flash light exception" is moot anyway — the map is unlit
 * MeshBasicMaterial and wouldn't receive a PointLight. So the flash is a bright
 * additive quad, not a light. Same Source read, zero lightmap-discipline risk.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';

export type Surface = 'concrete' | 'wood' | 'metal' | 'flesh';

/** Per-surface impact look: puff colour and whether a bullet hole is stamped. */
export const SURFACE_FX: Record<Surface, { color: number; decal: boolean }> = {
  concrete: { color: 0xcfc9bd, decal: true }, // pale dust
  wood: { color: 0xb08b4a, decal: true }, // splinters
  metal: { color: 0xfff2c0, decal: true }, // bright spark
  flesh: { color: 0xb0121a, decal: false }, // blood — no hole in a body
};

/** Pool sizes: enough in flight at rifle cadence. Each pool is one draw call. */
export const TRACER_POOL = 12;
export const IMPACT_POOL = 24;

const FLASH_LIFE = 0.045; // s — a single-frame-ish pop at 60 fps
const TRACER_LIFE = 0.055;
const IMPACT_LIFE = 0.11;

const FLASH_SIZE = 0.22; // m across at peak (unsuppressed rifle); scaled per-weapon
const TRACER_RADIUS = 0.012; // m — thin beam
const IMPACT_SIZE = 0.18; // m across

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const ORIGIN = new Vector3(0, 0, 0);

// Hot-loop scratch — reused, never allocated per effect.
const sMid = new Vector3();
const sDir = new Vector3();
const sQuat = new Quaternion();
const sScale = new Vector3();
const sMat = new Matrix4();
const sUp = new Vector3();
const sEye = new Vector3();
const sColor = new Color();
const CYL_AXIS = new Vector3(0, 1, 0); // CylinderGeometry runs along +Y

export interface Vfx {
  /** `scale` (default 1) shrinks/dims the flash — e.g. ~0.3 for a suppressed pistol. */
  muzzleFlash: (pos: Vector3, dir: Vector3, scale?: number) => void;
  tracer: (from: Vector3, to: Vector3) => void;
  impact: (point: Vector3, normal: Vector3, surface: Surface) => void;
  update: (dt: number) => void;
  liveCount: () => number;
}

export function createVfx(scene: Scene): Vfx {
  // --- Muzzle flash: one additive quad, scaled+faded per frame. ---
  const flashMat = new MeshBasicMaterial({
    color: 0xfff2b0,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const flash = new Mesh(new PlaneGeometry(1, 1), flashMat);
  flash.frustumCulled = false;
  flash.visible = false;
  scene.add(flash);
  let flashLife = 0;
  let flashScale = 1; // per-weapon multiplier for size + peak brightness

  // --- Tracers: thin additive cylinders (unit height along +Y), pooled. ---
  const tracers = new InstancedMesh(
    new CylinderGeometry(TRACER_RADIUS, TRACER_RADIUS, 1, 5, 1, true),
    new MeshBasicMaterial({ color: 0xffe08a, blending: AdditiveBlending, transparent: true, depthWrite: false }),
    TRACER_POOL,
  );
  tracers.frustumCulled = false;
  for (let i = 0; i < TRACER_POOL; i++) tracers.setMatrixAt(i, HIDDEN);
  scene.add(tracers);
  const tracerLife = new Float32Array(TRACER_POOL);
  let tracerNext = 0;

  // --- Impacts: normal-facing quads, per-instance colour, pooled. ---
  const impacts = new InstancedMesh(
    new CircleGeometry(0.5, 6), // unit-diameter quad, face +Z
    new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }),
    IMPACT_POOL,
  );
  impacts.frustumCulled = false;
  for (let i = 0; i < IMPACT_POOL; i++) {
    impacts.setMatrixAt(i, HIDDEN);
    impacts.setColorAt(i, sColor.set(0x000000));
  }
  scene.add(impacts);
  const impactLife = new Float32Array(IMPACT_POOL);
  let impactNext = 0;

  return {
    muzzleFlash(pos: Vector3, dir: Vector3, scale = 1): void {
      // Face the quad back along the shot so the shooter sees it flat-on.
      sQuat.setFromUnitVectors(CYL_AXIS.set(0, 0, 1), sDir.copy(dir).multiplyScalar(-1).normalize());
      CYL_AXIS.set(0, 1, 0);
      flashScale = scale;
      flash.position.copy(pos);
      flash.quaternion.copy(sQuat);
      flash.scale.setScalar(FLASH_SIZE * scale);
      flash.visible = true;
      flashLife = FLASH_LIFE;
    },

    tracer(from: Vector3, to: Vector3): void {
      const i = tracerNext;
      tracerNext = (tracerNext + 1) % TRACER_POOL;
      sDir.copy(to).sub(from);
      const len = sDir.length();
      if (len < 1e-4) return;
      sDir.divideScalar(len);
      sQuat.setFromUnitVectors(CYL_AXIS.set(0, 1, 0), sDir);
      sMid.copy(from).addScaledVector(sDir, len * 0.5);
      sMat.compose(sMid, sQuat, sScale.set(1, len, 1));
      tracers.setMatrixAt(i, sMat);
      tracers.instanceMatrix.needsUpdate = true;
      tracerLife[i] = TRACER_LIFE;
    },

    impact(point: Vector3, normal: Vector3, surface: Surface): void {
      const i = impactNext;
      impactNext = (impactNext + 1) % IMPACT_POOL;
      // Orient like a decal: +Z column faces out along the normal.
      const up = Math.abs(normal.y) < 0.99 ? sUp.set(0, 1, 0) : sUp.set(0, 0, 1);
      sMat.lookAt(sEye.copy(normal), ORIGIN, up);
      sMat.scale(sScale.set(IMPACT_SIZE, IMPACT_SIZE, IMPACT_SIZE));
      sMat.setPosition(point.x + normal.x * 0.01, point.y + normal.y * 0.01, point.z + normal.z * 0.01);
      impacts.setMatrixAt(i, sMat);
      impacts.setColorAt(i, sColor.set(SURFACE_FX[surface].color));
      impacts.instanceMatrix.needsUpdate = true;
      if (impacts.instanceColor) impacts.instanceColor.needsUpdate = true;
      impactLife[i] = IMPACT_LIFE;
    },

    update(dt: number): void {
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) {
          flash.visible = false;
        } else {
          const t = flashLife / FLASH_LIFE; // 1→0
          flashMat.opacity = t * flashScale; // dimmer for a suppressed weapon
          flash.scale.setScalar(FLASH_SIZE * flashScale * (1.4 - 0.4 * t)); // slight expand
        }
      }
      let tm = false;
      for (let i = 0; i < TRACER_POOL; i++) {
        const l = tracerLife[i] ?? 0;
        if (l > 0) {
          tracerLife[i] = l - dt;
          if (l - dt <= 0) {
            tracers.setMatrixAt(i, HIDDEN);
            tm = true;
          }
        }
      }
      if (tm) tracers.instanceMatrix.needsUpdate = true;
      let im = false;
      for (let i = 0; i < IMPACT_POOL; i++) {
        const l = impactLife[i] ?? 0;
        if (l > 0) {
          impactLife[i] = l - dt;
          if (l - dt <= 0) {
            impacts.setMatrixAt(i, HIDDEN);
            im = true;
          }
        }
      }
      if (im) impacts.instanceMatrix.needsUpdate = true;
    },

    liveCount(): number {
      let n = flashLife > 0 ? 1 : 0;
      for (let i = 0; i < TRACER_POOL; i++) if ((tracerLife[i] ?? 0) > 0) n++;
      for (let i = 0; i < IMPACT_POOL; i++) if ((impactLife[i] ?? 0) > 0) n++;
      return n;
    },
  };
}

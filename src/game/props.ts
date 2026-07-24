/**
 * Prop placement + set-dressing data for de_douglas: which glbs go where, which
 * of them break, and the shared placement math (mesh transform + collider box)
 * used by initial placement, round-reset restore, and the WASM sim mirror.
 * Extracted from main.ts when it split into shell + session.
 */

import { Box3, CanvasTexture, Color, DoubleSide, Group, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, type MeshStandardMaterial, Object3D, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import barrelUrl from '../../assets/props/barrel_explosive.glb?url';
import crateUrl from '../../assets/props/crate_wood.glb?url';
import jerryUrl from '../../assets/props/jerry_can.glb?url';
import palletUrl from '../../assets/props/pallet_wood.glb?url';
import coneUrl from '../../assets/props/traffic_cone.glb?url';
import { type Breakable } from './breakables';
import { addStaticBox } from '../physics/world';
import { type Surface } from '../render/vfx';

// Props that break when shot (crates + the explosive barrel). Wood pallets,
// cones and jerry-cans stay solid scenery. HP is tuned so a crate takes ~3 rifle
// hits and the fragile barrel ~2.
// ponytail: the barrel is "explosive" in name only — it just breaks. Radius
// damage to nearby bots/props is Phase 5 juice; add it when there's blast VFX to
// go with it, not a silent AoE.
export const BREAKABLE_HP = new Map<string, number>([
  [crateUrl, 90],
  [barrelUrl, 55],
]);

/** Impact surface for a prop glb: wood crates/pallets, metal barrels/cans, else
 *  the concrete default the map falls back to. */
export function propSurface(url: string | undefined): Surface {
  if (url === crateUrl || url === palletUrl) return 'wood';
  if (url === barrelUrl || url === jerryUrl) return 'metal';
  return 'concrete';
}

// [url, x, z, yawDeg, stack, tintHex?] per prop. Each prop is dropped so its base
// rests on the floor (y=0) from its measured bounding box, so mesh origins don't
// matter. `stack` (metres, default 0) lifts a prop to sit on top of another (crate
// stack). `tintHex` (optional) overrides the MeshBasicMaterial colour for variety
// — barrels can be slightly different rust shades, crates can be lighter/darker.
// All placements clear the walled hole (x in [-9, inner curve], |z|<16) and sit
// against the de_douglas cover: barrels/jerry by the west choke-B crates, crate
// stacks by the choke-A crates, loose crates + a pallet in the east arc, cones
// marking choke C and the connectors. Mirror-paired across z=0 like the map.
export const PROP_PLACEMENTS: readonly [string, number, number, number, number?, number?][] = [
  // Barrel + jerry-can clutter tucked against the west choke-B crates.
  [barrelUrl, -18.6, 4.4, 0],
  [barrelUrl, -17.4, 4.9, 0],
  [barrelUrl, -18.9, 5.7, 0],
  [jerryUrl, -16.6, 5.1, 25],
  [barrelUrl, -18.6, -4.4, 0],
  [barrelUrl, -17.4, -4.9, 0],
  [jerryUrl, -16.6, -5.1, -30],
  // Crate stacks by the choke-A crates (both spine ends).
  [crateUrl, -13.6, 12.4, 12],
  [crateUrl, -13.6, 12.4, -8, 0.7],
  [crateUrl, -13.6, -12.4, 12],
  [crateUrl, -13.6, -12.4, -8, 0.7],
  // Loose crates flanking the east arc centrepiece.
  [crateUrl, 14.5, 2.6, 20],
  [crateUrl, 14.5, -2.6, 20],
  // Pallets flat against the west spine wall + east arc.
  [palletUrl, -21, 8, 90],
  [palletUrl, -21, -8, 90],
  [palletUrl, 19, 0, 0],
  // Traffic cones marking choke C (spine) and the connectors.
  [coneUrl, -9.8, 2.5, 0],
  [coneUrl, -9.8, -2.5, 0],
  [coneUrl, 5, 19, 0],
  [coneUrl, 5, -19, 0],
  // Phase 13: more breakables — extra barrels near the east arc and mid.
  [barrelUrl, 13, 3, 55, 0, 0xcc6644],
  [barrelUrl, 13, -3, -60, 0, 0xcc6644],
  [barrelUrl, 0, 10, 30, 0, 0xaa5533],
  [barrelUrl, 0, -10, -30, 0, 0xaa5533],
  [crateUrl, 10, 9, -15, 0, 0x998877],
  [crateUrl, 10, -9, 15, 0, 0x998877],
  // Phase 13: extra scenery — spawn-area markers and chokepoint dress.
  [coneUrl, -18, 23, 0],   // CT spawn approach
  [coneUrl, -18, -23, 0],  // T spawn approach
  [jerryUrl, -20, 0, 45],  // mid-spine junction
  [coneUrl, 17, 18, 0],    // east arc perimeter
  [coneUrl, 17, -18, 0],
];

// One placed prop: its scene mesh and static collider, so a shot that breaks it
// can pull both. Index-aligned with PROP_PLACEMENTS.
export interface PlacedProp {
  mesh: Object3D;
  collider: import('@dimforge/rapier3d-compat').Collider;
}

/** Per-model template cached during prop loading — used to re-clone broken props
 *  on round reset without re-loading .glb files. */
export interface PropTemplate {
  root: Object3D;
  box: Box3;
}

/** The collider box for placement `i` in world space: centre, half-extents, yaw.
 *  Shared by the Rapier collider, the WASM sim mirror, and round-reset restore
 *  so the three can never drift apart. Null if the placement/template is missing. */
export interface PropBox {
  center: Vector3;
  half: { x: number; y: number; z: number };
  yawRad: number;
}

export function propBoxAt(i: number, templates: Map<string, PropTemplate>): PropBox | null {
  const p = PROP_PLACEMENTS[i];
  if (!p) return null;
  const [url, x, z, yawDeg, stack = 0] = p;
  const model = templates.get(url);
  if (!model) return null;
  const size = new Vector3();
  const localCenter = new Vector3();
  model.box.getSize(size);
  model.box.getCenter(localCenter);
  const posY = stack - model.box.min.y;
  const yawRad = MathUtils.degToRad(yawDeg);
  const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawRad);
  const center = new Vector3(localCenter.x, 0, localCenter.z)
    .applyQuaternion(quat)
    .add(new Vector3(x, posY + localCenter.y, z));
  return { center, half: { x: size.x / 2, y: size.y / 2, z: size.z / 2 }, yawRad };
}

/** Clone, position, rotate and tint the mesh for placement `i`. Null if the
 *  placement/template is missing. Caller adds it to the scene. */
export function buildPropMesh(i: number, templates: Map<string, PropTemplate>): Object3D | null {
  const p = PROP_PLACEMENTS[i];
  if (!p) return null;
  const [url, x, z, yaw, stack = 0, tintHex] = p;
  const model = templates.get(url);
  if (!model) return null;
  const prop = model.root.clone();
  prop.position.set(x, stack - model.box.min.y, z);
  prop.rotation.y = MathUtils.degToRad(yaw);
  // Per-placement colour tint for variety (Phase 13.4 set-dressing).
  if (tintHex !== undefined) {
    const tint = new Color(tintHex);
    prop.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshBasicMaterial) {
        o.material.color.copy(tint);
      }
    });
  }
  return prop;
}

/** Simple spawn-area direction sign: a flat quad with text baked to a CanvasTexture.
 *  Phase 13.4 map-life set-dressing — 1 draw call each, zero shipped bytes. */
export function makeSign(label: string, arrowDir: 'left' | 'right' | 'up' | 'down'): Group {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Group();
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.fillStyle = '#ff6600';
  ctx.font = 'bold 80px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const arrows: Record<string, string> = { left: '←', right: '→', up: '↑', down: '↓' };
  ctx.fillText(arrows[arrowDir] ?? '→', size / 2, size / 2 - 12);
  ctx.fillStyle = '#cccccc';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(label.toUpperCase(), size / 2, size / 2 + 52);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const geom = new PlaneGeometry(1.2, 1.2);
  const mat = new MeshBasicMaterial({ map: tex, side: DoubleSide, transparent: true });
  const sign = new Mesh(geom, mat);
  const root = new Group();
  root.add(sign);
  return root;
}

/**
 * Breakable metadata index-aligned with PROP_PLACEMENTS: null for solid scenery,
 * else a { hp, broken, restsOn } record. `restsOn` is the placement index this
 * prop is stacked on (a preceding placement at the same x,z with stack 0), so
 * breaking the base cascades to the crate on top of it (breakables.ts).
 */
export function buildBreakables(): (Breakable | null)[] {
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
export async function placeProps(scene: Object3D, world: import('@dimforge/rapier3d-compat').World): Promise<{ placed: PlacedProp[]; templates: Map<string, PropTemplate> }> {
  const loader = new GLTFLoader();
  const urls = [...new Set(PROP_PLACEMENTS.map((p) => p[0]))];
  // Per model: the flattened root plus its local bounding box (measured once,
  // unrotated, at the origin — includes any node transforms baked into the glb).
  const templates = new Map(
    await Promise.all(
      urls.map(async (url): Promise<[string, PropTemplate]> => {
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
  const placed: PlacedProp[] = [];
  for (let i = 0; i < PROP_PLACEMENTS.length; i++) {
    const prop = buildPropMesh(i, templates);
    const box = propBoxAt(i, templates);
    if (!prop || !box) continue;
    scene.add(prop);
    const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), box.yawRad);
    const collider = addStaticBox(world, box.center, box.half, quat);
    placed.push({ mesh: prop, collider });
  }
  return { placed, templates };
}

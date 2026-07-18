import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type Mesh, type MeshStandardMaterial, NoColorSpace, type Object3D } from 'three';

// glTF has no lightmap slot, so the baked lighting ships as a separate texture
// (tools/blender/build_map.py bakes it) and is assigned to the glb's materials
// by convention here. See docs/blender-pipeline.md §10.
//
// ponytail: loaded as EXR, not KTX2 — `toktx` isn't installed, and EXR is
// HDR-correct with zero new tooling. KTX2 is the payload optimisation (12 MB →
// ~1 MB); do it in `pnpm assets:opt` once toktx lands. Swap EXRLoader for
// KTX2Loader then — the material wiring below is identical.

// Three's lightmap irradiance handling has carried a factor of π at times, so a
// correct Blender bake lands between 1.0 and π here. Tuned by eye against the
// Blender render; write the final number down. See the doc's §10 note.
const LIGHTMAP_INTENSITY = 1.0;

/** Load a map glb + its baked lightmap EXR, wiring the lightmap onto every material. */
export async function loadLightmappedMap(glbUrl: string, exrUrl: string): Promise<Object3D> {
  const [gltf, lm] = await Promise.all([new GLTFLoader().loadAsync(glbUrl), new EXRLoader().loadAsync(exrUrl)]);

  lm.flipY = false; // glTF convention; must match the geometry
  lm.channel = 1; // TEXCOORD_1 / the `uv1` attribute
  lm.colorSpace = NoColorSpace; // linear light data, not colour

  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    mat.lightMap = lm;
    mat.lightMapIntensity = LIGHTMAP_INTENSITY;
    mat.needsUpdate = true;
  });

  return gltf.scene;
}

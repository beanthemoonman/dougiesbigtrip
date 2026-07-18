import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { type Mesh, type MeshStandardMaterial, NoColorSpace, type Object3D, type WebGLRenderer } from 'three';

// glTF has no lightmap slot, so the baked lighting ships as a separate texture
// (tools/blender/build_map.py bakes it → EXR; `pnpm assets:lightmap` encodes the
// KTX2) and is assigned to the glb's materials by convention here. See
// docs/blender-pipeline.md §10.
//
// KTX2/UASTC: 12.6 MB EXR master → ~0.3 MB shipped, stays compressed in VRAM.
// The basis transcoder is served from /basis (public/basis, vendored from three).

// Three's lightmap irradiance handling has carried a factor of π at times, so a
// correct Blender bake lands between 1.0 and π here. Tuned by eye against the
// Blender render; write the final number down. See the doc's §10 note.
const LIGHTMAP_INTENSITY = 1.0;

/** Load a map glb + its baked lightmap KTX2, wiring the lightmap onto every material. */
export async function loadLightmappedMap(glbUrl: string, ktx2Url: string, renderer: WebGLRenderer): Promise<Object3D> {
  const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  const [gltf, lm] = await Promise.all([new GLTFLoader().loadAsync(glbUrl), ktx2.loadAsync(ktx2Url)]);
  ktx2.dispose();

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

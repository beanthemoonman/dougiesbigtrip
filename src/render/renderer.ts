import {
  ACESFilmicToneMapping,
  DirectionalLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Stats from 'stats.js';

/**
 * Two render passes, one frame (docs/weapon-feel.md §1):
 *   world pass  — layer 0, 90° H FOV, near 0.1  (the map)
 *   viewmodel   — layer 1, own FOV, near 0.01   (the gun, drawn on top)
 * `clearDepth()` between them means the gun is never clipped by world geometry
 * and gets its own sane perspective. This is the #1 thing people get wrong.
 */
export interface RenderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Viewmodel scene — add the weapon here, on layer 1. Has its own light rig
   * (the world's lightmap can't reach it). */
  viewmodelScene: Scene;
  stats: Stats;
  render: () => void;
  /** Set the world (not viewmodel) horizontal FOV in degrees — the Settings
   * FOV slider. Viewmodel FOV is a separate fixed taste dial. */
  setWorldFov: (degrees: number) => void;
}

// CS default, non-negotiable for feel — see docs/art-direction.md. Three's
// PerspectiveCamera takes *vertical* FOV, so this must be converted from our
// horizontal FOV and recomputed on resize, or ultrawide users see less, not
// more. Now the Settings FOV slider's default rather than a hard constant.
const DEFAULT_WORLD_FOV_DEGREES = 90;

// Viewmodel is a separate taste dial (docs/weapon-feel.md §1): 54° large/forward
// (CS 1.6), 68° small/back (CS:GO). 60° is the doc's default. Horizontal.
const VIEWMODEL_FOV_DEGREES = 60;

function verticalFovFromHorizontal(hFovDegrees: number, aspect: number): number {
  const hFovRad = (hFovDegrees * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(hFovRad / 2) / aspect) * 180) / Math.PI;
}

export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Two passes drawn into one frame — we clear manually between them.
  renderer.autoClear = false;

  const scene = new Scene();
  const aspect = window.innerWidth / window.innerHeight;
  let worldFovDegrees = DEFAULT_WORLD_FOV_DEGREES;
  const camera = new PerspectiveCamera(verticalFovFromHorizontal(worldFovDegrees, aspect), aspect, 0.1, 500);

  // --- Viewmodel pass ---
  const viewmodelScene = new Scene();
  // Camera stays at the origin looking down -Z: the weapon is welded to the
  // view, so it lives in eye-space and needs no world transform. (The doc copies
  // the world camera's pose here; with an isolated viewmodel scene that's a
  // no-op, so we skip it. Revisit if world-anchored effects ever join this pass.)
  const viewCamera = new PerspectiveCamera(verticalFovFromHorizontal(VIEWMODEL_FOV_DEGREES, aspect), aspect, 0.01, 10);
  viewCamera.layers.set(1);

  // Full-metalness gunmetal reflects its surroundings, not direct light, so a PBR
  // gun with no environment renders black. RoomEnvironment gives it something to
  // reflect and doubles as soft fill. Not a realtime *world* light (that ban is
  // §art-direction, world scene only) — this is the viewmodel's own rig.
  const pmrem = new PMREMGenerator(renderer);
  viewmodelScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  viewmodelScene.environmentIntensity = 0.35;

  // key + fill (docs/weapon-feel.md §1), low and hand-placed, both on layer 1.
  const key = new DirectionalLight(0xfff2e0, 2.2);
  key.position.set(-0.6, 0.8, 0.4);
  key.layers.set(1);
  const fill = new DirectionalLight(0x9fb4cc, 0.7);
  fill.position.set(0.7, -0.2, 0.5);
  fill.layers.set(1);
  viewmodelScene.add(key, fill);

  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.style.position = 'absolute';
  stats.dom.style.left = '0';
  stats.dom.style.top = '0';
  document.body.appendChild(stats.dom);

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const asp = width / height;
    camera.aspect = asp;
    camera.fov = verticalFovFromHorizontal(worldFovDegrees, asp);
    camera.updateProjectionMatrix();
    viewCamera.aspect = asp;
    viewCamera.fov = verticalFovFromHorizontal(VIEWMODEL_FOV_DEGREES, asp);
    viewCamera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    viewmodelScene,
    stats,
    render(): void {
      renderer.clear(); // colour + depth
      renderer.render(scene, camera);
      renderer.clearDepth(); // <- the gun is drawn on top of the world, never clipped by it
      renderer.render(viewmodelScene, viewCamera);
    },
    setWorldFov(degrees: number): void {
      worldFovDegrees = degrees;
      camera.fov = verticalFovFromHorizontal(worldFovDegrees, camera.aspect);
      camera.updateProjectionMatrix();
    },
  };
}

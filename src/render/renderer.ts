import { ACESFilmicToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import Stats from 'stats.js';

/**
 * World render pass setup. Viewmodel gets its own camera/pass in Phase 2
 * (see docs/weapon-feel.md) — this is layer 0 only.
 */
export interface RenderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  stats: Stats;
  render: () => void;
  resize: () => void;
  dispose: () => void;
}

// CS default, non-negotiable for feel — see docs/art-direction.md. Three's
// PerspectiveCamera takes *vertical* FOV, so this must be converted from our
// fixed horizontal FOV and recomputed on resize, or ultrawide users see less,
// not more.
const WORLD_FOV_DEGREES = 90;

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

  const scene = new Scene();
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new PerspectiveCamera(verticalFovFromHorizontal(WORLD_FOV_DEGREES, aspect), aspect, 0.05, 1000);

  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.style.position = 'absolute';
  stats.dom.style.left = '0';
  stats.dom.style.top = '0';
  document.body.appendChild(stats.dom);

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.fov = verticalFovFromHorizontal(WORLD_FOV_DEGREES, camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    stats,
    render(): void {
      renderer.render(scene, camera);
    },
    resize,
    dispose(): void {
      window.removeEventListener('resize', resize);
      document.body.removeChild(stats.dom);
      renderer.dispose();
    },
  };
}

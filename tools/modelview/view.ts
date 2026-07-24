import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { PNG } from 'pngjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ANGLES: Record<string, readonly [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0.001],
  iso: [1, 0.8, 1],
};

const DEFAULT_SIZE = 1024;
const DEFAULT_BG = '808080';
const DEFAULT_OUT = '.modelview';

export interface RenderOptions {
  glbPath: string;
  angles: string[];
  size: number;
  bg: string;
  outDir: string;
  /** If true, return raw RGBA buffers instead of writing files. For testing. */
  returnBuffers?: boolean;
}

export interface AngleBuffer {
  name: string;
  rgba: Uint8Array;
}

/** MIME type lookup for the static file server. */
const MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
};

function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
      const normalized = resolve(PROJECT_ROOT, '.' + urlPath);
      if (!normalized.startsWith(PROJECT_ROOT)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const data = readFileSync(normalized);
        const ext = extname(normalized);
        res.writeHead(200, {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolvePromise({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

function pageHtml(serverUrl: string, size: number, bg: string): string {
  const hex = bg.replace(/^#/, '');
  return `<!DOCTYPE html>
<html><body style="margin:0;overflow:hidden">
<canvas id="c" width="${size}" height="${size}"></canvas>
<script type="importmap">
{
  "imports": {
    "three": "${serverUrl}/node_modules/three/build/three.module.js",
    "three/addons/": "${serverUrl}/node_modules/three/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(${size}, ${size}, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// ponytail: neutral grey bg for silhouette inspection, not the skybox
renderer.setClearColor(new THREE.Color('#${hex}'));

const scene = new THREE.Scene();
scene.background = new THREE.Color('#${hex}');

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

// ponytail: realtime lights for inspection rig, not the world scene
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
const key = new THREE.DirectionalLight(0xffffff, 2.0);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
scene.add(hemi, key, fill);

const gl = renderer.getContext();

// ponytail: no fog, no post FX — raw asset inspection
window.__renderer = renderer;
window.__scene = scene;
window.__camera = camera;
window.__key = key;
window.__fill = fill;
window.__gl = gl;
window.__size = ${size};
window.__THREE = THREE;
window.__GLTFLoader = GLTFLoader;
window.__ready = true;
</script>
</body></html>`;
}

export async function renderModel(options: RenderOptions): Promise<AngleBuffer[]> {
  const { glbPath, angles, size, bg, outDir, returnBuffers } = options;

  const server = await startServer();
  const glbFullPath = resolve(glbPath);
  const glbBase64 = readFileSync(glbFullPath).toString('base64');

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size });
    await page.setContent(pageHtml(server.url, size, bg), {
      waitUntil: 'load',
    });
    await page.waitForFunction('window.__ready === true');

    const loaderResult = await page.evaluate(
      (b64: string) => {
        const THREE = (window as unknown as Record<string, unknown>)
          .__THREE as typeof import('three');
        const GLTFLoaderCtor = (window as unknown as Record<string, unknown>)
          .__GLTFLoader as typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;
        const scene = (window as unknown as Record<string, unknown>)
          .__scene as import('three').Scene;

        return new Promise<{ cx: number; cy: number; cz: number; r: number }>(
          (resolvePromise, reject) => {
            const loader = new GLTFLoaderCtor();
            loader.load(
              'data:application/octet-stream;base64,' + b64,
              (gltf) => {
                scene.add(gltf.scene);
                const box = new THREE.Box3().setFromObject(gltf.scene);
                const center = box.getCenter(new THREE.Vector3());
                const r = box.getBoundingSphere(new THREE.Sphere()).radius as number;
                resolvePromise({ cx: center.x, cy: center.y, cz: center.z, r });
              },
              undefined,
              (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
            );
          },
        );
      },
      glbBase64,
    );

    const { cx, cy, cz, r } = loaderResult;
    const fovRad = (45 * Math.PI) / 180;
    const dist = (r / Math.sin(fovRad / 2)) * 1.15;

    const results: AngleBuffer[] = [];

    for (const name of angles) {
      const dirArr = ANGLES[name];
      if (!dirArr) {
        console.error(`Unknown angle: ${name}`);
        continue;
      }

      const pixelB64 = await page.evaluate(
        (params: {
          dir: readonly [number, number, number];
          cx: number;
          cy: number;
          cz: number;
          r: number;
          dist: number;
        }) => {
          const THREE = (window as unknown as Record<string, unknown>)
            .__THREE as typeof import('three');
          const renderer = (window as unknown as Record<string, unknown>)
            .__renderer as import('three').WebGLRenderer;
          const camera = (window as unknown as Record<string, unknown>)
            .__camera as import('three').PerspectiveCamera;
          const key = (window as unknown as Record<string, unknown>)
            .__key as import('three').DirectionalLight;
          const fill = (window as unknown as Record<string, unknown>)
            .__fill as import('three').DirectionalLight;
          const gl = (window as unknown as Record<string, unknown>)
            .__gl as WebGL2RenderingContext;
          const size = (window as unknown as Record<string, unknown>).__size as number;

          const center = new THREE.Vector3(params.cx, params.cy, params.cz);
          const dir = new THREE.Vector3(
            params.dir[0],
            params.dir[1],
            params.dir[2],
          ).normalize();

          camera.position.copy(center).addScaledVector(dir, params.dist);
          camera.lookAt(center);
          camera.near = Math.max(params.dist - params.r * 2, 0.001);
          camera.far = params.dist + params.r * 2;
          camera.updateProjectionMatrix();

          const lookDir = new THREE.Vector3()
            .copy(center)
            .sub(camera.position)
            .normalize();
          const camRight = new THREE.Vector3()
            .crossVectors(new THREE.Vector3(0, 1, 0), lookDir)
            .normalize();
          if (camRight.length() < 0.001) {
            camRight.set(1, 0, 0);
          }
          const camUp = new THREE.Vector3()
            .crossVectors(lookDir, camRight)
            .normalize();

          key.position
            .copy(camera.position)
            .addScaledVector(camRight, params.dist * 0.3)
            .addScaledVector(camUp, params.dist * 0.2);
          fill.position
            .copy(camera.position)
            .addScaledVector(camRight, -params.dist * 0.3)
            .addScaledVector(camUp, -params.dist * 0.2);

          renderer.render(
            (window as unknown as Record<string, unknown>).__scene as
              import('three').Scene,
            camera,
          );

          const pixels = new Uint8Array(size * size * 4);
          gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

          let binary = '';
          for (let i = 0; i < pixels.length; i++) {
            binary += String.fromCharCode(pixels[i]!);
          }
          return btoa(binary);
        },
        { dir: dirArr, cx, cy, cz, r, dist },
      );

      const raw = Uint8Array.from(Buffer.from(pixelB64, 'base64'));
      const flipped = flipVertically(raw, size);

      if (returnBuffers) {
        results.push({ name, rgba: flipped });
      } else {
        mkdirSync(outDir, { recursive: true });
        const base = basename(glbPath).replace(/\.(glb|gltf)$/, '');
        const png = new PNG({ width: size, height: size });
        png.data = Buffer.from(flipped);
        const outPath = join(outDir, `${base}__${name}.png`);
        writeFileSync(outPath, PNG.sync.write(png));
        console.log(outPath);
        results.push({ name, rgba: flipped });
      }
    }

    return results;
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

function flipVertically(src: Uint8Array, size: number): Uint8Array {
  const rowSize = size * 4;
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < size; y++) {
    const srcStart = y * rowSize;
    const dstStart = (size - 1 - y) * rowSize;
    dst.set(src.subarray(srcStart, srcStart + rowSize), dstStart);
  }
  return dst;
}

function parseArgs(): RenderOptions | null {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(
      'Usage: pnpm view <path.glb> [options]\n\n' +
        'Options:\n' +
        '  --angles <list>   Comma-separated: front,back,left,right,top,iso (default: all)\n' +
        '  --size <px>       Square render size (default: 1024)\n' +
        '  --out <dir>       Output directory (default: .modelview/)\n' +
        '  --bg <hex>        Background colour (default: 808080)\n',
    );
    return null;
  }

  const glbPath = args[0]!;
  let angles = ['front', 'back', 'left', 'right', 'top', 'iso'];
  let size = DEFAULT_SIZE;
  let outDir = DEFAULT_OUT;
  let bg = DEFAULT_BG;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--angles' && args[i + 1]) {
      angles = args[++i]!.split(',').map((s) => s.trim());
    } else if (arg === '--size' && args[i + 1]) {
      size = parseInt(args[++i]!, 10);
    } else if (arg === '--out' && args[i + 1]) {
      outDir = args[++i]!;
    } else if (arg === '--bg' && args[i + 1]) {
      bg = args[++i]!;
    }
  }

  return { glbPath, angles, size, bg, outDir };
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (!options) {
    process.exit(0);
  }

  try {
    readFileSync(resolve(options.glbPath));
  } catch {
    console.error(`File not found: ${options.glbPath}`);
    process.exit(1);
  }

  try {
    const results = await renderModel(options);
    const allBlank = results.every((r) => r.rgba.length === 0);
    if (allBlank) {
      console.error('All renders produced blank output.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Render failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

# Counter Douglas Globally Offended

[![CI](https://github.com/beanthemoonman/dougiesbigtrip/actions/workflows/ci.yml/badge.svg)](https://github.com/beanthemoonman/dougiesbigtrip/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Rust](https://img.shields.io/badge/Rust-edition_2024-000000?logo=rust&logoColor=white)](sim/Cargo.toml)
[![three.js](https://img.shields.io/badge/three.js-r170-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-shared_sim-654FF0?logo=webassembly&logoColor=white)](sim/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![assets: CC0 / permissive](https://img.shields.io/badge/assets-CC0%20%2F%20permissive-brightgreen)](docs/licensing-and-assets.md)

A browser FPS demo that imitates the look and feel of **Counter-Strike: Source** using only
CC0/permissively-licensed assets. The goal is *feel and art-direction fidelity*, not feature
completeness — movement that feels wrong is a P0 bug; a missing scoreboard is a P3.

No Valve assets, ever. Every texture, model, and sound is CC0 or permissively licensed with a
row in [`assets/CREDITS.md`](assets/CREDITS.md).

## Tech stack

```mermaid
graph TD
    subgraph Browser["Browser client"]
        Three["three.js r170<br/>WebGL2 renderer"]
        DOM["DOM overlay HUD"]
        Rapier["Rapier3D (WASM)<br/>raycasts + shapecasts"]
        Recast["recast-navigation<br/>baked navmesh"]
        ClientSim["sim.wasm<br/>(client copy)"]
        WS1["WebSocket client"]
    end

    subgraph Shared["Shared Rust"]
        Sim["sim crate<br/>Source-port movement<br/>fixed 64 Hz timestep"]
    end

    subgraph Server["Rust deathmatch server"]
        ServerSim["sim crate<br/>(server-authoritative)"]
        Tokio["tokio + tokio-tungstenite"]
        WS2["WebSocket server"]
    end

    subgraph Build["Build & assets"]
        Vite["Vite + TypeScript strict"]
        WasmPack["wasm-pack"]
        Blender["Blender MCP<br/>(agent-authored assets)"]
        GLTF["gltf-transform<br/>Meshopt + KTX2"]
    end

    Three --> DOM
    ClientSim -.same code.-> Sim
    ServerSim -.same code.-> Sim
    WS1 <-->|state sync| WS2
    ClientSim --> WS1
    Tokio --> ServerSim
    WasmPack --> ClientSim
    WasmPack --> ServerSim
    Blender --> GLTF --> Three
    Vite --> Three
```

### Why each piece

| Concern | Choice | Why |
|---|---|---|
| **Renderer** | [three.js](https://threejs.org) r170 (WebGL2) | The Source look is *baked lightmaps*, not realtime lights — three.js gives us lightmapped materials and a viewmodel render pass without a heavyweight engine. |
| **Physics** | [`@dimforge/rapier3d-compat`](https://rapier.rs) (WASM) | Used **only** for raycasts and collide-and-slide shapecasts. The character controller is hand-rolled — Rapier's built-in movement response doesn't feel like CS:S. |
| **Character movement** | Hand-rolled Rust `sim` crate | Air-accel, ground friction, and bhop/surf-adjacent behaviour are exact ports of the Source formulas in [`docs/source-movement.md`](docs/source-movement.md). Not invented, not "improved." |
| **Shared simulation** | [WebAssembly](https://webassembly.org) via [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) | The `sim` crate compiles once and runs in **both** the browser and the server. The server is authoritative; the client runs the identical WASM for prediction. One codebase, no drift. See [`docs/netcode.md`](docs/netcode.md). |
| **Server** | Rust + [tokio](https://tokio.rs) + tokio-tungstenite | Async WebSocket deathmatch server sharing the `sim` crate directly (native, not WASM). |
| **Navigation** | [recast-navigation](https://github.com/isaac-mason/recast-navigation-js) | Bot pathing on a navmesh baked offline to a binary blob. |
| **Build** | [Vite](https://vitejs.dev) + TypeScript (strict) | Fast HMR dev server; `vite-plugin-wasm` loads the shared sim. |
| **Assets** | glTF 2.0 `.glb`, Meshopt + [KTX2](https://github.khronos.org/KTX-Specification/) | Compressed via `gltf-transform` to hit the 48 MB initial / 60 MB total download budget. |
| **UI/HUD** | Plain DOM overlay | No React for a crosshair. |
| **Deploy** | Docker + compose | Separate client (nginx) and server images. |

### The agent authors the assets

There are no store-bought models in this repo. The 3D assets — maps, weapon viewmodels, props —
are created and edited **by Claude (the agent) driving Blender over an MCP server**. The agent
models geometry, bakes lightmaps, and exports glTF through the pipeline scripts in
[`tools/blender/`](tools/blender/); the export/optimize path is documented in
[`docs/blender-pipeline.md`](docs/blender-pipeline.md) and [`docs/asset-pipeline.md`](docs/asset-pipeline.md).
Every generated asset still earns its CC0/permissive licence row in
[`assets/CREDITS.md`](assets/CREDITS.md).

## Architecture notes

- **Server-authoritative, client-predicted.** The same Rust `sim` crate is the single source of
  truth for movement and collision. The server runs it natively; the browser runs the exact same
  logic compiled to `sim.wasm`. This is why the download budget was raised to 60 MB — to absorb
  the shared WASM.
- **Fixed 64 Hz timestep.** Simulation runs on an accumulator with interpolated rendering.
  Frame-rate-dependent physics changes the feel and is a bug. Nothing below `core/loop.ts` reads
  frame delta.
- **Deterministic.** `simulate(trace, {seed})` twice produces identical snapshots. RNG is seeded
  and injected — no `Date.now()` / `Math.random()` in the sim.

See [`docs/`](docs/) for the full set of specs. The docs are the spec — if code and doc disagree,
one of them is a bug.

## Getting Started

```bash
pnpm install
pnpm dev
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm test` | Vitest test suite (movement math has golden tests — keep them green) |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm assets:opt` | gltf-transform: Meshopt/Draco + KTX2 |
| `pnpm nav:bake` | Regenerate navmesh blob from `assets/maps/*.glb` |

### Running the server

The Rust deathmatch server and client ship as separate Docker images:

```bash
docker compose up
```

Rebuilding the shared WASM sim after editing `sim/src/` requires a specific ritual (pnpm keeps a
stale `file:` copy) — see the "Rebuilding the shared WASM sim" section in [`CLAUDE.md`](CLAUDE.md).

## Repo layout

```
src/       core loop, render, physics, player movement, weapons, ai, game, ui
sim/       shared Rust simulation crate → compiles to WASM (client) + native (server)
server/    Rust WebSocket deathmatch server
assets/    maps, weapons, props, characters, audio + CREDITS.md
tools/     blender export/bake, navbake, gltf optimize
docs/      the specs
tests/     golden (spec-derived), baseline (recorded), traces, harness, acceptance
```

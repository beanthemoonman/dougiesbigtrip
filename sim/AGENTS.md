# AGENTS.md — sim/

Supplements the root `AGENTS.md`; read that first. This covers only what is specific to `sim/`.

## What this is

The shared simulation crate (`sim`, Rust edition 2024). One codebase, two targets:

- **native `rlib`** — linked by `server/` (workspace member, see root `Cargo.toml`).
- **`cdylib` → `sim.wasm`** — built with `--features wasm`, emitted to `sim/pkg`, consumed by the
  client as the pnpm `file:` dependency `sim-wasm` (`import … from 'sim-wasm'`, mainly in
  `src/game/session.ts`).

Client prediction, single-player bots and the authoritative server all run this same code, so
there is no TS↔Rust port to drift. Movement, hitboxes, damage, bot AI and nav all live here.

## Layout

| Module | Responsibility |
|---|---|
| `lib.rs` | `pub mod` list + `wasm_bindings` (`#[cfg(feature = "wasm")]`): every `#[wasm_bindgen]` `sim_*` / `get_*` export. State is held in module-level `static Mutex` singletons (`SIM`, `BOTS`) — slot 0 is the local player. |
| `constants.rs` | Movement constants, already in metres, `f64`. Port of `src/player/constants.ts`. |
| `input.rs` | `Buttons` bitmask + wish-dir from buttons/yaw (mirrors `src/core/input.ts`). |
| `movement.rs` | Source movement: pure friction/accel/air-accel/clip (golden-tested, bit-exact) + `tick_movement` collide-and-slide over Rapier shapecasts. |
| `world.rs` | `SimWorld`: Rapier world, static map colliders, one kinematic capsule body per player slot. |
| `shapecast.rs` | The only Rapier query wrappers (shape-cast, ray-cast, overlap). f64 in, f32 at this boundary. |
| `map.rs` | Builds `SimWorld` colliders from `assets/maps/de_douglas.json` (same JSON the client's `src/game/map_douglas.ts` reads). |
| `hitbox.rs`, `damage.rs` | Per-bone hitbox ray test and damage model (ports of `src/game/hitbox.ts` / `damage.ts`). |
| `nav.rs` | A* + funnel over the baked triangle soup `de_douglas.navmesh.tris.bin` (`include_bytes!`, parsed once via `OnceLock`). Decides *how* bots walk. |
| `nav_graph.rs` | Hand-authored waypoint graph (`de_douglas.navnodes.json`), BFS. Decides *where* bots go. |
| `ai/` | Bot `bot.rs` (data + tuning consts), `perception.rs` (FOV/LOS), `aim.rs` (turn-rate, hit roll, `hash01`), `brain.rs` (`tick_bot` FSM, search-goal selection, unstick). |
| `protocol.rs` | Binary wire format (`Welcome`, `CommandFrame`, `Snapshot`, `Join`, …), `PROTOCOL_VERSION`. |
| `rng.rs` | mulberry32, seeded — the only randomness allowed. |

## Commands

```bash
cargo test -p sim                                     # Rust unit tests (inline #[cfg(test)] modules; no sim/tests/ dir)
wasm-pack build sim --target bundler --features wasm  # -> sim/pkg (also: tools/build_wasm.sh, zsh)
pnpm test                                             # TS-side parity: tests/ai_parity.test.ts,
                                                      # src/player/movement_wasm*.test.ts, src/net/protocol.test.ts
```

After any `wasm-pack` build, follow the **"Rebuilding the shared WASM sim"** ritual in the root
`AGENTS.md` (copy into `node_modules/.pnpm/sim@file+sim+pkg/…`, clear `node_modules/.vite`), or
the client keeps running the stale `.wasm`.

CI (`.github/workflows/ci.yml`) builds the WASM and runs `pnpm test`, but does **not** run
`cargo test`. Run it yourself.

## Invariants & gotchas

- **Determinism.** No wall-clock, no unseeded randomness. Bot "randomness" uses `aim::hash01`
  (seed/tick-derived) or `rng.rs`. `tests/ai_parity.test.ts` asserts `sim_tick_bot` twice on the
  same state → identical result; a flake is a P0 determinism bug.
- **`f64` everywhere, `f32` only at Rapier** (`world.rs` / `shapecast.rs`), matching JS number
  semantics. Don't push `f32` into the movement math.
- **Movement is a port.** `movement.rs` formulas follow `docs/source-movement.md`; the TS golden
  tables run against the WASM build. Changing a formula or constant means changing the doc too.
- **Two hosts, one API.** A change to a `pub` fn used by `server/` must still compile without the
  `wasm` feature; a new/changed `#[wasm_bindgen]` export needs the TS call sites
  (`src/game/session.ts`, tests) updated. Run `cargo build -p server` as well as `wasm-pack`.
- **Map data is compiled in.** `map.rs`, `nav.rs`, `nav_graph.rs` `include_str!`/`include_bytes!`
  files under `assets/maps/`. Re-baking the navmesh (`pnpm nav:bake`) or editing the map JSON
  needs a rebuild of both the WASM and the server binary.
- **Wire format has a TS twin.** `protocol.rs` must match `src/net/protocol.ts` byte-for-byte;
  bump `PROTOCOL_VERSION` in both on an incompatible change. Round-trip tests exist on both sides.
- **WASM state is global.** The bindings use process-wide `Mutex` singletons; `sim_init` resets
  the world, `sim_reset_player` / `sim_reset_bot` respawn without rebuilding colliders.
- **`docs/netcode.md` §2's tree is the original plan**, not current: there is no `round.rs`
  (round FSM is `server/src/game.rs`), and `nav.rs` sits at the crate root, not under `ai/`.

## Related docs

`docs/netcode.md` (§2 shared crate, §8 tests), `docs/source-movement.md`,
`docs/navmesh-pipeline.md` (portable `.tris.bin` format), `docs/plan-phase11-bot-ai.md`,
`docs/testing.md`.

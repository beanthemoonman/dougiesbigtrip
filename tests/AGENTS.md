# AGENTS.md — tests/

Supplements the root [`AGENTS.md`](../AGENTS.md) (test tiers T0–T3, golden vs baseline, determinism
rules, Definition of Done). Read that first; this file covers only what lives in `tests/`.

## What this is

Cross-cutting tests that don't belong next to one source file: the T1 sim harness, WASM bot-AI
parity, websocket e2e against the real Rust server, and the T3 human acceptance scripts.
**Most unit/T1 tests are colocated in `src/`** (`src/**/*.test.ts`, e.g.
`src/player/movement.test.ts` holds the golden movement values) plus `tools/modelview/view.test.ts`.
Put a new test next to its module unless it spans subsystems or needs a harness from here.

## Layout

| Path | Purpose |
|---|---|
| `harness/sim.ts` | `simulate(trace, spawnPoint?)` — headless 64 Hz replay of an `InputTrace` (`src/core/trace_recorder.ts`) against de_douglas colliders via `tickMovement`. Returns plain tuples so `toEqual` works. |
| `harness/sim.test.ts` | Harness determinism checks + crate-face free-fall regression. |
| `ai_parity.test.ts` | Bot AI through `sim-wasm` (Rust `sim/src/ai/`): determinism gate, modes, aim, LOS. Loads `assets/maps/de_douglas.json` + `de_douglas.navnodes.json`. |
| `e2e/*.e2e.ts` | WebSocket e2e vs the real server (`server-loop`, `combat`, `roster`, `two-clients`). See `e2e/README.md`. |
| `e2e/harness.ts` | Server spawn / `E2E_SERVER_URL` external mode, promise-queue WS `Client`, `joinTeam`, `FAST_ROUND_ENV`. |
| `acceptance/ACC-NNN-*.md` | T3 scripts for a human. Numbers are not contiguous (001/002/010/011 don't exist). |

**Not present on disk:** `tests/golden/`, `tests/baseline/`, `tests/traces/`. `docs/testing.md`
and the root DoD reference them, but today golden values live inline in colocated tests and no
committed trace files exist. If you add the first golden/baseline/trace file, create the dir and
keep the golden-vs-baseline separation from `docs/testing.md`.

## Commands

```bash
pnpm test                                        # unit + T1: src/**, tests/**, tools/** *.test.ts
pnpm test:e2e                                    # tests/e2e/**/*.e2e.ts only (vitest.e2e.config.ts)
cargo build --manifest-path server/Cargo.toml   # required before local e2e
docker compose -f docker-compose.e2e.yml up -d --build   # alt: containerised server on :9876
E2E_SERVER_URL=ws://localhost:9876 pnpm test:e2e
docker compose -f docker-compose.e2e.yml down
```

## Invariants & gotchas

- **E2E suffix is `.e2e.ts`, not `.test.ts`** — that's what keeps them out of `pnpm test`. A
  `.test.ts` under `e2e/` would run in the parallel unit pool and flake.
- E2E runs one file at a time in a single fork (`fileParallelism: false`, `singleFork`), 20 s test
  timeout. Each file binds its own port. Don't parallelise it.
- **Silent skip:** suites `skipIf(!SERVER_AVAILABLE)`. No built `target/debug/server(.exe)` and no
  `E2E_SERVER_URL` → green with zero tests run. Always check the executed test count.
- External mode can't inject per-test env; the target server must already use the fast-round env
  (`SERVER_FREEZE_MS=500`, `SERVER_ROUND_MS=10000`, `SERVER_END_MS=500`), as the compose file does.
- `ai_parity.test.ts` (and `src/player/movement_wasm*.test.ts`) import `sim-wasm`. After changing
  Rust in `sim/`, rebuild and recopy the pnpm `file:` dep (root AGENTS.md "Rebuilding the shared
  WASM sim") or these test a stale `.wasm`.
- Determinism: a T1 test must call the thing twice and `toEqual` the results; never retry a flake.
  Bot jitter is a tick hash (`sim_hash01`), not RNG.
- Acceptance scripts are written **before** tuning. Record results inline per step, e.g.
  `**PASS** (commit: 8070065)` (see `ACC-018`), or tick the `- [ ] Pass` boxes.
- `vitest.config.ts` has `passWithNoTests: true` — a typo'd include glob won't fail loudly.

## Related docs

- `docs/testing.md` — tiers, harness design, golden vs baseline rules
- `tests/e2e/README.md` — e2e roster rules under test, docker vs local
- `docs/netcode.md` — wire protocol exercised by e2e
- `vitest.config.ts`, `vitest.e2e.config.ts`, `docker-compose.e2e.yml`

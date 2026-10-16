# AGENTS.md — .github/workflows/

Supplements the root [`AGENTS.md`](../../AGENTS.md) (Definition of Done, commands) — read that first.

## What this is

GitHub Actions CI. One workflow, `ci.yml` (name `CI`), with one job `ci` on `ubuntu-latest`.
Triggers: `push` to `main` and `pull_request` targeting `main`. No schedules, no matrix, no
deploy/release jobs.

## Job steps (in order)

| Step | Purpose |
|---|---|
| `actions/checkout@v4` | |
| `dtolnay/rust-toolchain@stable` | Rust stable (repo has no `rust-toolchain` file) |
| `pnpm/action-setup@v4` | pnpm version comes from `packageManager` in `package.json` (`pnpm@11.3.0`) |
| `actions/setup-node@v4` node 22, `cache: pnpm` | Only cache in the workflow — pnpm store |
| `cargo install wasm-pack` | Compiled from source every run; not cached |
| `wasm-pack build sim --target bundler --features wasm` | Produces `sim/pkg/` (gitignored) |
| `pnpm install` | Must come **after** the wasm build: `sim-wasm` is `file:./sim/pkg` |
| `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` | eslint, `tsc --noEmit`, vitest, `tsc && vite build` |

## Local repro

```bash
wasm-pack build sim --target bundler --features wasm   # or tools/build_wasm.sh (zsh)
pnpm install        # re-copies sim/pkg into node_modules/.pnpm (see root WASM ritual)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Locally, a stale pnpm copy of `sim/pkg` can make tests pass/fail differently from CI, which
always installs fresh — follow the root "Rebuilding the shared WASM sim" steps.

## What CI does NOT run

- `cargo test` / `cargo clippy` for the `sim` or `server` crates (Rust tests incl.
  `sim/src/nav.rs`'s real-navmesh parse test only run if you run them yourself).
- `pnpm test:e2e` (needs a built Rust server; see `tests/e2e/README.md`).
- `pnpm nav:bake`, `pnpm assets:lightmap`, Blender scripts — baked outputs are committed, so CI
  never checks they are fresh.
- Any T2 runtime/budget check (draw calls, payload size, CREDITS rows) or T3 acceptance.

Vitest still exercises the WASM boundary (`sim-wasm` imports in e.g.
`src/player/movement_wasm.test.ts`, `tests/ai_parity.test.ts`), which is why the wasm build is
mandatory before `pnpm test`.

## Invariants & gotchas

- Adding a check: add a `package.json` script first, then a `- run: pnpm <script>` step here, and
  list it in the root `AGENTS.md` Commands block.
  Anything that imports `sim-wasm` must stay after the wasm-pack + install steps.
- Adding Rust checks: toolchain is already installed; `cargo test --workspace` covers `sim` and
  `server` (root `Cargo.toml` workspace). No cargo cache exists — consider `Swatinem/rust-cache`
  if Rust steps get slow.
- New vitest files are picked up automatically only under `src/`, `tests/`, `tools/`
  (`*.test.ts`, see `vitest.config.ts`); e2e files are `tests/e2e/*.e2e.ts` (only `vitest.e2e.config.ts` picks them up).
- `.gitattributes` forces `*.yml` to LF — keep it that way when editing on Windows.
- Lint ignores `dist/`, `public/`, `sim/pkg/`, `target/` (`eslint.config.js`).

## Related docs

`docs/testing.md` (tiers, what "green" means) · `docs/netcode.md` (sim crate / WASM share) ·
`tests/e2e/README.md`

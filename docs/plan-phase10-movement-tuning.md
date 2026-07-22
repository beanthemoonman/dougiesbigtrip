# Phase 10 — Movement & interaction tuning

Small, high-value feel fixes. Movement math is a port (`docs/source-movement.md`); everything
here is a **bug against the spec or the input layer**, not a re-tune of the accel/friction
curves. Any golden-value change edits `docs/source-movement.md` in the **same PR** (CLAUDE.md
gate).

## The dual-port tax (read first)

Movement lives in **two** places that must stay bit-identical:
- `src/player/movement.ts` + `src/core/input.ts` (TS client)
- `sim/src/movement.rs` + `sim/src/input.rs` + `sim/src/constants.rs` (Rust, shared WASM,
  server-authoritative)

Golden tests guard both: `movement.test.ts`, `movement_wasm.test.ts`, `movement_wasm_full.test.ts`.
**Every math/constant change in this phase lands in both files**, and after touching Rust you owe
the WASM rebuild ritual (CLAUDE.md → "Rebuilding the shared WASM sim"). Skip it and you get
`wasm.<fn> is not a function` or a client/server desync.

## What already exists (reuse, don't rebuild)

| Thing | Where | Note |
|---|---|---|
| `friction()` with the `speed < 0.1` early return | `movement.ts:56`, `movement.rs` | the creep suspect |
| `DUCK` button + duck hull swap + duck-jump feet-pull | `input.ts:28`, `movement.ts:371` | works; **no speed scale** |
| Ctrl-swallow (keys never reach browser) | `input.ts:80-87` | already covers all mapped keys incl. Ctrl |
| Breakable hp/cascade | `game/breakables.ts` | pure part done + tested |
| Prop colliders, `setEnabled(false)` on break | `main.ts:1253-1258` | client SP only |

## Decisions to lock

| Decision | Choice | Why |
|---|---|---|
| Creep fix vs. doc note | **Diagnose first** (10.0) — creep is intermittent, so it's not the always-on floor. Only if the cause is the `(0,0.1)` friction dead zone do we zero-under-floor and **update `source-movement.md:106`**; a wishdir/collide-slide leak is fixed there with the doc untouched. | Intermittent ≠ the simple floor leak. Don't edit the spec until the repro proves the floor is the cause. |
| Walk scale | `wishspeed *= 0.52` while WALK held & on ground | doc `source-movement.md:310` ("~52%") |
| Duck scale | `wishspeed *= 0.34` while ducked & on ground | Source `DUCK` speed; **add this line to the doc** (it's currently unspecified) |
| Walk key | `ShiftLeft`/`ShiftRight` → new `Buttons.WALK` | standard; swallow comes free via `KEY_TO_BUTTON` |
| Walk + duck stacked | multiply both scales (duck already slower; walk barely matters) | simplest; no special-case |

## Increment plan (each ends demoable; don't start N+1 until N's check passes)

### 10.0 — Residual creep → dead stop
**Symptom (from the developer):** movement normally stops fine, but *sometimes* you keep sliding
forward forever instead of friction bringing you to a stop. Intermittent → **the cause is not the
always-on `speed < 0.1` floor** (that path zeros within ~1 tick at `SV_FRICTION=4`). Diagnose
before fixing.

- **Reproduce first.** Instrument velocity at rest and find the input/geometry that triggers the
  endless slide. Prime suspects, in order:
  1. Velocity settling **inside the `(0, 0.1)` window** where `friction()` returns without
     decaying (movement.ts:63 / movement.rs) — a genuine dead zone that never zeros.
  2. `wishdir` leak — a stale bit or diagonal residual re-adding speed via `accelerate()` when the
     player thinks all keys are released (check `wishDirFromButtons` + `onPointerLockChange`
     clearing `buttons`).
  3. Collide-and-slide re-injecting tangential velocity on a specific surface/prop
     (`tryPlayerMove` / `stepMove`), so friction never wins.
- **Capture the trigger as a T1 trace** in `tests/traces/` that reproduces the slide, asserting
  `velocity` reaches **exactly** `(0,0,0)` within N ticks. Observe it fail.
- **Fix at the identified cause.** If it's the `(0,0.1)` dead zone, zero the velocity under the
  floor in **both** ports and update the `docs/source-movement.md:106` note (which currently
  mandates the return-without-zeroing that leaks it). If it's a wishdir/collide-slide leak, the
  friction note stays and the doc is untouched.
- **Check:** the repro trace stops dead in TS and WASM; slide no longer reproduces in-game.

### 10.1 — Walk (Shift) + crouch-walk speed cap
- Add `Buttons.WALK` + `ShiftLeft`/`ShiftRight` to `KEY_TO_BUTTON` (TS **and** `input.rs`).
- In `tickMovement`, scale `wishspeed`: `*= 0.34` if ducked, `*= 0.52` if WALK held (both if
  both). Same in `movement.rs`.
- Verify Shift no longer reaches the browser (it flows through the existing swallow because it's
  now a mapped key; add a T0/manual note). Ctrl/duck already swallowed — confirm, don't re-add.
- T1: three traces (walk-only, duck-only, walk+duck) → assert steady-state speed matches the
  scaled cap within tolerance. Add duck-scale line to `source-movement.md`.
- **Check:** Shift and Ctrl both slow you, change nothing in the browser; T1 + WASM green.

### 10.2 — Breakable collision (verify + harden)
- Confirm intact crate/barrel is solid to the player hull (shapecast hits the static cuboid) and
  the collider disables the **same tick** it breaks — no ghost box, no gap.
- T1 (SP, `game/`): player pressed against a prop can't pass; break it → player falls/passes next
  tick. Reuse `damageProp` + a stub collider-enabled flag.
- **Check:** can't walk through an intact crate; it stops being solid the instant it breaks.

### 10.3 — Crouch-jump onto crates
- Verify the duck-jump feet-pull (`movement.ts:375`) clears crate height and you land/stand on the
  crate collider (walkable-normal check passes on the cuboid top).
- If crate colliders are too short / normals wrong, fix the collider box, not the movement.
- T1: trace = approach crate, crouch-jump → assert final position rests on top (y ≈ crate top).
- **Check:** crouch-jump onto a crate and stand; shoot it out and you fall.

## Tests & Definition of Done

| Tier | What |
|---|---|
| **T1** | creep→zero, walk/duck steady-state speeds, breakable solid→gone, crouch-jump-onto-crate. All deterministic, committed traces. Mirror the movement ones in WASM golden. |
| **T3** | `tests/acceptance/ACC-018-movement-tuning.md`, **written before any tuning**: the exit test below, run once, PASS recorded against a commit hash. |

Determinism gate still applies: `simulate(trace,{seed})` twice → identical. No frame-delta reads
below `core/loop.ts`. Constants in `constants.ts`, metres only.

## Exit test (ACC-018)

Stop dead — no creep. Shift slows you and changes nothing in the browser; Ctrl (duck) slows you
and changes nothing in the browser. Crouch-jump onto a crate and stand on it; shoot it out and you
fall; you can't walk through an intact one.

## Deferred (named, not forgotten)

- Footstep silencing while walking (doc `source-movement.md:310`) — audio polish, not movement;
  fold into a later audio pass unless it's trivial when wiring WALK.
- Weapon-dependent speed cap (`source-movement.md:308`) — separate from walk/duck; out of scope
  here.

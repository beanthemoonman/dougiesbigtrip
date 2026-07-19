# Netcode (Phase 6) — authoritative Rust deathmatch server

This is the spec for Phase 6. The plan (`plan_to_implement.md`) mandates recording the
transport choice and the architecture *before* writing code. This doc is that record, and it
is the wire-format / behaviour spec both ends implement against. **If the code and this doc
disagree, that's a bug in one of them — decide which, in the PR.**

Read this alongside `docs/source-movement.md` (the sim being made authoritative) and
`docs/testing.md` (the DoD gate).

---

## The three decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| **Transport** | **WebSocket** (binary frames) | Universally supported, one dependency each side (`tokio-tungstenite` / native `WebSocket`), no SDP/ICE/DTLS yak-shave. TCP head-of-line blocking is a non-issue at single-host DM scale. |
| **AI** | **Full AI ported to Rust**, runs server-side | Bots must be authoritative and feel as good as single-player. The rich FSM (perception / brain / aim / nav) moves into the shared sim crate, not a throwaway stub. |
| **Sim ownership** | **WASM-share**: one Rust sim crate is the single source of truth; the client loads it as WASM | The client can't cheat behaviour it doesn't own — it runs the *same compiled binary* the server does. Prediction/reconciliation become **bit-exact** (no port drift), and there is exactly one place the movement/AI/game rules live. |

### What WASM-share actually means here

`sim/` (Rust) is compiled two ways from the **same source**:

- **native** (`cdylib`/`rlib`) → linked into the server binary, runs authoritatively at 64 Hz.
- **wasm32** (`wasm-bindgen`) → shipped to the browser, replacing the sim half of the current
  TypeScript. The client calls into WASM for movement, bot AI, hit resolution, and round rules.

Consequence: the current TS sim files become thin bindings or are deleted. See
[§7 Client migration](#7-client-migration-what-happens-to-the-existing-ts). The TS **golden
tests stay** — they now test the Rust sim (through the WASM boundary) instead of a TS
implementation, which is the anti-drift contract from `docs/source-movement.md` preserved.

---

## 1. Architecture

```
BROWSER (client)                                  RUST SERVER
┌────────────────────────────┐                    ┌────────────────────────────┐
│ input.ts → CommandFrame     │  ── WS binary ──▶  │ per-conn recv → cmd queue   │
│                             │                    │                             │
│ sim.wasm  (SAME crate)      │                    │ sim (native, SAME crate):   │
│  · predict local player     │                    │  · tick every slot          │
│    immediately on input     │                    │  · tick bots (full AI)      │
│  · reconcile on snapshot     │                    │  · resolve shots (lag comp) │
│  · interpolate remote ents  │  ◀── WS binary ──  │  · round rules              │
│                             │   Snapshot (delta) │                             │
│ render/vfx/audio/hud/       │                    │ snapshot ring buffer (~1s)  │
│ viewmodel  (TS, unchanged)  │                    │ slot mgr (join/spectate)    │
└────────────────────────────┘                    └────────────────────────────┘
```

Rendering, VFX, audio, HUD, viewmodel, decals stay in TypeScript and are untouched — they are
cosmetics that *read* sim state. The **source of truth** for transforms, health, ammo, round
state, and bot decisions is the Rust sim: authoritative on the server, predicted locally via
the identical WASM.

---

## 2. The shared sim crate

```
sim/                          # Rust crate, compiled native (server) AND wasm32 (client)
  Cargo.toml                  # crate-type = ["cdylib", "rlib"]; feature "wasm" gates wasm-bindgen
  src/
    lib.rs                    # public sim API + #[wasm_bindgen] exports under feature "wasm"
    constants.rs              # port of src/player/constants.ts — metres, exact values
    input.rs                  # Buttons bitmask + wishDirFromButtons
    movement.rs               # port of src/player/movement.ts (friction/accel/airAccel/clip/tryPlayerMove/stepMove/duck/jump/tick)
    world.rs                  # rapier3d world; static colliders built from assets/maps/de_douglas.json
    shapecast.rs              # capsuleCast / capsuleOverlapsAnything / rayCast — same semantics as shapecast.ts
    hitbox.rs                 # port of src/game/hitbox.ts (per-bone AABBs)
    damage.rs                 # port of src/game/damage.ts (armor + per-bone multipliers)
    round.rs                  # port of src/game/round.ts (freezetime/live/over, scores)
    rng.rs                    # port of src/core/rng.ts (mulberry32, seeded, injected)
    ai/
      nav.rs                  # load de_douglas.navmesh.tris.bin (portable soup) + path queries
      perception.rs           # FOV cone + LOS raycast + hearing radius
      brain.rs                # FSM: Idle→Patrol→Investigate→Engage→Reposition→Dead
      aim.rs                  # per-difficulty reaction delay / error radius / turn-rate cap
      bot.rs                  # synthesises wishdir+buttons → SAME movement tick
```

**Floating point:** the sim math runs in `f64` (matching JS number semantics), `f32` only at
the Rapier boundary (the client's `rapier3d-compat` WASM is f32; the server uses the native
`rapier3d` crate, same library, same major version). Because client and server run the *same*
compiled sim, there is no cross-language port to drift — the only residual nondeterminism is
Rapier's own query path, which reconciliation absorbs.

**Determinism guardrails** (from `CLAUDE.md`, non-negotiable): no wall-clock in the sim, 64 Hz
fixed, RNG seeded and injected. The server owns the seed and sends it in `Welcome`; the client
predicts with the same seed.

### What is NOT in the sim crate

Renderer, VFX, audio, HUD, viewmodel, decals, `src/ai/anim.ts` (animation *playback* is a
render concern — the AI *decisions* port, the clip driver stays TS).

---

## 3. Transport & wire format

WebSocket, binary messages. First byte is a message-type tag; second byte a protocol version.
`sim/net` (Rust) and `src/net` (TS) implement the **same** encode/decode and share a
round-trip test on each side.

### 3.1 Client → Server: `CommandFrame` (every client tick)

```
tag: u8 = CMD
seq: u32                  // monotonic; the server acks the highest consumed seq
lastAckSnapshot: u32      // server tick of the newest snapshot the client has (drives lag-comp rewind)
buttons: u16              // the existing Buttons bitmask (src/core/input.ts)
yaw: f32, pitch: f32
weapon: u8                // active slot
shot: 0 | 1               // fired this tick?
  if shot: eyePos: vec3f, dir: vec3f   // dir already carries recoil+spread (computed by the WASM sim, client-side)
```

Each packet re-sends any unacked commands (cheap redundancy against loss).

### 3.2 Server → Client: `Snapshot` (delta-encoded, ~20 Hz)

```
tag: u8 = SNAP
serverTick: u32
ackSeq: u32               // highest CommandFrame consumed for THIS client → reconciliation anchor
entities[]:  { slot:u8, flags:u8 (alive|ducked|team), pos:vec3f (feet), vel:vec3f,
               yaw:f32, pitch:f32, health:u8, armor:u8, weapon:u8, ammo:u8 }  // changed fields only
events[]:    kill(slot,by) | shotTracer(slot,from,to,weapon) | spawn(slot) | roundPhase(phase)
round:       { phase:u8, timeLeftMs:u16, scoreT:u16, scoreCT:u16 }
```

- Server **simulates** at 64 Hz, **sends** at ~20 Hz (interpolation covers the gap). Start by
  sending every tick if simpler; throttle only if bandwidth is measured to matter.
- Delta baseline is the client's last **acked** snapshot; `events` are resent until acked
  (reliable-ish over the ordered WS stream).
- Your own slot rides in the snapshot too — the client uses it to **reconcile**, not to render.

### 3.3 Control messages

```
Welcome  { yourSlot: u8 | SPECTATOR, map: string, seed: u32, serverTick: u32, tickRate: 64 }
Bye      { reason }
```

---

## 4. Connection & slot lifecycle

10 slots. Bots and humans share them.

```
connect:
  an empty-or-bot slot exists?   → assign it (evict the bot if present); Welcome{ yourSlot }
  all 10 slots hold humans?      → Welcome{ SPECTATOR }; stream snapshots; ignore CommandFrames
disconnect:
  the slot reverts to a bot (server spawns a bot into it)
```

This satisfies the exit test: *page load → join replaces a bot; 11th connection spectates;
disconnect frees the slot back to a bot.*

---

## 5. Netcode mechanics

### 5.1 Prediction (local player only)
Client runs the WASM sim on its own input immediately and stores `(seq, CommandFrame,
resultingState)` in a ring buffer. No visual latency on your own movement.

### 5.2 Reconciliation
On each snapshot, the client snaps its own slot to the authoritative state as-of `ackSeq`, then
**replays** every buffered command with `seq > ackSeq` through the WASM sim. Because it is the
*same binary* the server ran, the replay matches the server except where another player shoved
you or Rapier's query path diverged — a small, smoothed correction, never a rubber-band.

### 5.3 Interpolation (remote players + bots)
Render remote entities **~100 ms in the past**: keep ~1 s of snapshots, render at
`serverTime − interpDelay`, lerp position/yaw between the two bracketing snapshots. This is what
makes others look smooth under 20 Hz snapshots + jitter.

### 5.4 Lag compensation (hitscan)
Server keeps a ring buffer of every entity's hitbox positions per tick (~1 s). On a `shot`
command it rewinds targets to `renderTime = tick(CommandFrame.lastAckSnapshot) − interpDelay`,
then runs `hitbox::ray` from the supplied `eyePos`/`dir`. Hit → `damage` (armor + per-bone
multiplier) → health update → `kill` event. **This is why shots register where the shooter saw
the target.**

**Anti-cheat scope:** the server does a sanity check (eyePos near the shooter's authoritative
position; rate-of-fire gate) and otherwise trusts the aim vector. Full validation (recompute
spread from the seeded RNG, etc.) is deferred — noted here so it isn't mistaken for done. The
WASM-share choice already removes the *easy* client behaviour edits by making the client run the
authoritative binary; it is not a substitute for server-side hit validation.

---

## 6. Server (non-sim) components

```
server/                       # binary crate; depends on the sim crate (native)
  src/
    main.rs                   # tokio runtime; WS accept loop; spawns the game loop
    loop.rs                   # 64 Hz fixed accumulator (mirrors core/loop.ts tick discipline; no render)
    net/transport.rs          # tokio-tungstenite; per-conn tx/rx channels
    net/protocol.rs           # CommandFrame/Snapshot encode+decode (matches src/net wire format)
    net/snapshot.rs           # per-connection delta encoder + ack tracking
    game/state.rs             # slot table, per-slot PlayerState, entity registry
    game/lagcomp.rs           # hitbox ring buffer + rewind-to-time + resolve_shot
    game/slots.rs             # join/evict-bot/spectator/disconnect logic
```

The map geometry and navmesh are the **existing baked artifacts** — the server reads
`assets/maps/de_douglas.json` (same cuboid data the client's `map_douglas.ts` uses) and
`assets/maps/de_douglas.navmesh.tris.bin` (the portable soup — see `docs/navmesh-pipeline.md`).
No duplicated map data.

---

## 7. Client migration (what happens to the existing TS)

The sim half moves into WASM; the shell stays TS.

| Current TS | After Phase 6 |
|---|---|
| `src/player/movement.ts`, `constants.ts`, `src/core/rng.ts` | deleted / replaced by WASM binding calls |
| `src/physics/shapecast.ts`, `src/physics/world.ts` | folded into the sim crate's Rapier world |
| `src/ai/{brain,perception,aim,nav,bot}.ts` | ported into the sim crate |
| `src/ai/anim.ts` | **stays** (animation playback = render) |
| `src/game/{hitbox,damage,round}.ts` | ported into the sim crate |
| `src/game/{breakables,map_douglas}.ts` | map data stays TS-authored; collision/authority reads it in Rust |
| `src/render/*`, `src/ui/*`, `src/weapons/viewmodel.ts`, `src/core/{audio,loop,input}.ts` | **stay** (cosmetics / shell) |
| **NEW** `src/net/{connection,prediction,interpolation}.ts` | WS client, reconciliation, remote-entity lerp |

`src/main.ts` gains a `NETWORKED` branch: when connected, remote entities are driven by
snapshots and the local player predicts+reconciles against the WASM sim; single-player runs the
WASM sim locally with no server. The single-player path must keep working throughout.

---

## 8. Testing & Definition of Done

| Tier | What |
|---|---|
| **T0** | Rust unit tests on the ported pure fns (friction/accel/airAccel/clip, rng, damage) + protocol encode/decode round-trip (both ends). |
| **T1** | **Golden parity**: the existing `src/player/movement.test.ts` golden tables (spec-derived from `docs/source-movement.md`) now run against the WASM sim — must stay bit-exact. Rust-side `sim/tests/parity.rs` runs the same vectors natively. Plus a committed input trace fed to the sim → identical snapshot twice (determinism). |
| **T2** | Client budgets: < 400 draw calls, **< 48 MB initial** (raised from 16 MB for `sim.wasm`; verify it stays under). |
| **T3** | `tests/acceptance/ACC-010-netcode.md`, **written before tuning**: two browsers move+shoot with no rubber-band; a kill registers where the shooter saw the target; the 11th connection spectates; a disconnect frees a slot back to a bot. |

A T1 flake here is a **P0 determinism bug**, not a retry.

---

## 9. Increment plan (each ends demoable; don't start N+1 until N's check passes)

- **6.0 — Scaffold.** This doc committed. `sim/` + `server/` Cargo workspace. `wasm-pack`
  build of `sim/` importable by Vite. WS echo server ↔ browser handshake.
  *Check: browser connects, `Welcome` round-trips.*
- **6.1 — Sim crate + WASM parity.** Port movement/constants/input/rng/shapecast/world +
  de_douglas collider load. WASM bindings. **Re-point the golden movement tests at the WASM
  sim; they stay green bit-exact.** `parity.rs` green natively.
  *Check: golden tables pass through WASM; a headless input trace is deterministic.*
- **6.2 — Client runs on WASM (single-player).** Swap `main.ts` to drive the local player and
  bots through the WASM sim; delete the replaced TS. Single-player plays identically to today.
  *Check: ACC-007/008 re-run PASS against the WASM sim.*
- **6.3 — Authoritative one-human server.** CommandFrames in → server ticks movement →
  snapshots out → client predicts + reconciles. No remote players yet.
  *Check: in-browser movement is server-driven, reconciliation invisible, no rubber-band.*
- **6.4 — Remote entities + slots.** Second connection; interpolate remote player; slot manager
  (join / evict-bot / spectator / disconnect).
  *Check: two browsers see each other move smoothly; 11th spectates.*
- **6.5 — Full AI server-side.** Port `ai/{nav,perception,brain,aim,bot}`; bots fill empty
  slots and play the full FSM; human join evicts a bot.
  *Check: bots path the whole map and fight, same quality as single-player.*
- **6.6 — Combat: lag comp + damage + round.** Rewind hitreg, damage, round rules authoritative;
  kill/tracer/round events to clients.
  *Check: full ACC-010 PASS recorded against a commit hash → Phase 6 exit test met.*
- **6.7 — Connect UI + Tab scoreboard.** Plain-DOM connect overlay (default server URL prefilled)
  and a held-Tab 3v3 scoreboard; K/D accumulates client-side from 6.6's `kill` events. Full spec
  in `docs/connect-and-scoreboard.md`.
  *Check: page loads to connect overlay → default URL connects → hold Tab shows 3v3 + K/D
  (ACC-011).*

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Netcode balloons the project (the plan's headline risk) | Strict increment gates; WebSocket not WebRTC; trust-client-aim hitreg (server sanity-checks, no full anti-cheat); one sim crate, no duplicated logic. |
| Rapier native ≠ Rapier WASM query results | Same crate + major version; f64 math / f32 boundary on both; measure drift in 6.1 before building on it; reconciliation absorbs the residual. |
| Loading recast's `navmesh.bin` from Rust | **Resolved: the bake now also emits a portable, ABI-independent triangle soup (`de_douglas.navmesh.tris.bin`, format in `docs/navmesh-pipeline.md`) that Rust reads directly.** The old Detour `.navmesh.bin` is coupled to Detour's compile-time layout and retires when the WASM sim owns nav. |
| WASM bundle blows the initial budget | **Budget raised 16 → 48 MB** to absorb `sim.wasm`. Still measure in 6.1; `wasm-opt -Oz`, and Rapier is already WASM in the client today, so the net add is the sim logic, not the physics engine. |
| Wire-format skew between `net/protocol.rs` and `src/net` | This doc §3 is the shared spec; round-trip encode/decode test on both ends. |

---

## 11. Deferred (named, not forgotten)

- Full server-side hit validation (spread recompute from seed) — `ponytail:` sanity-check only
  for now; add when the demo goes public.
- Snapshot rate throttling / bandwidth tuning — start simple, measure first.
- WebRTC unreliable transport — swap behind the transport interface if real-internet packet
  loss shows up. WebSocket is the committed choice for the demo.
</content>
</invoke>

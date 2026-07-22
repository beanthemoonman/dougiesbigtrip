# Phase 12 — Third-person fidelity + ragdoll (redux of Phase 7)

Make **other** players read as players: hold the gun correctly, pose per-weapon, show a flash +
tracer when they fire, and drop into a light ragdoll on death. All of this is **cosmetic, client-
side render work** — no sim state, no server authority, no protocol widening except one new event
tag. The bot brain, aim model, hitboxes, and round flow are untouched.

## The two-surface tax (read first)

Third-person models come from **two** sources that must both get the same treatment:

| Surface | Where | Fire known how? | Death known how? |
|---|---|---|---|
| **SP local bots** | `enemies[]` in `main.ts` (cloned `ctTemplateScene`, `Enemy.root`) | locally — the bot fires in-process (`enemy.fireCooldown` / `killBot` path) | locally — `e.alive = false` (`main.ts:1243`) |
| **MP remote players** | `remoteRoots` map in `main.ts`, driven by `interpBuf.interpolate` | **not yet on the wire** — needs a fire event | snapshot `F_ALIVE` clears (alive→dead edge) |

Everything below lands **once** as shared helpers (rig-fix, stance, a `spawnMuzzleFx(model, dir)`,
a `spawnRagdoll(model, deathVel)`) and is called from **both** the `enemies` loop and the
`remoteRoots` loop (`main.ts:1342` and `:1356`). Don't fork the logic per surface — the model
hierarchy is the same cloned `ctTemplateScene` in both.

## What already exists (reuse, don't rebuild)

| Thing | Where | Note |
|---|---|---|
| Third-person weapon attach to the right-hand bone | `attachBotWeapon` `main.ts:686` | rifle glb parented to `/righthand/i` bone with a hand-tuned `BOT_GUN_POS/ROT` |
| Bot anim driver (idle/walk/**death** clips) | `src/ai/anim.ts` | `driveBotAnim`; the `death` clip is the current death visual we're replacing/backstopping |
| First-person muzzle flash + tracer | `vfx.muzzleFlash` / `vfx.tracer` `main.ts:1220` | pooled (`TRACER_POOL`/`IMPACT_POOL`) — reuse verbatim, just feed a third-person origin |
| Snapshot event channel | `GameEvent {tag,slot,by}`, `EV_KILL` `src/net/protocol.ts:216` | 3 bytes/event, already decoded + carried in `Snapshot.events`. Add `EV_FIRE` here. |
| Server per-slot shot record | `Slot.last_shot` `server/src/main.rs:108` | already set when a slot fires — the hook point to emit `EV_FIRE` |
| Remote entity yaw/pitch each snapshot | `EntityState` `protocol.ts:196` | gives the tracer direction for a remote's flash without widening the event |
| Rapier world + static box colliders | `src/physics/world.ts`, `createWorld` | the ragdoll's dynamic bodies live here; collision groups keep them off live players |
| Seeded RNG (if any randomness is wanted) | `src/core/rng.ts` | ragdoll takes **zero** RNG (see decisions) — listed only so nobody reaches for `Math.random` |

## Decisions to lock

| Decision | Choice | Why |
|---|---|---|
| **Ragdoll body plan** | **Single dynamic rigid body** (a capsule/box roughly the torso), spawned at the model's last transform with the death-frame velocity; the whole character mesh rides it and tumbles. **Not** a per-bone articulated skeleton. | "Light, not a muscle sim — the tuning is a trap" (Phase 7, verbatim). One body tumbling reads as "fell over" for a small map at range. `ponytail: single-body tumble; upgrade to a 4–5 body articulated chain only if it looks like a sliding board.` |
| **Ragdoll determinism** | Ragdoll takes **zero RNG** and lives entirely in the **render** path, stepped off frame dt — never in the 64 Hz sim, never read back into gameplay. Initial state is fully determined by (last pose, death velocity). | Cleaner than Phase 7's "driven off seeded RNG" wording: no randomness at all is more deterministic-safe than injected randomness, and a cosmetic body outside the sim can't desync it. **This diverges from the Phase-7 checklist line — update that line in this PR** (the doc is the spec). |
| **Ragdoll ↔ live-player collision** | Ragdoll bodies go in a Rapier **collision group** that interacts with **static world only**, never the player/bot capsules. Plus a settle-then-despawn timer (~3 s to sleep, despawn on a timer). | "Corpses must not be clip hazards — walk through a body" (Phase 7). Groups are the built-in, allocation-free way; no per-frame overlap filtering. |
| **Death visual: ragdoll vs. baked death clip** | Ragdoll **replaces** the baked `death` clip on death. Keep the clip as a fallback only if the model has no usable body/bone to seat the ragdoll on. | One death visual, not two fighting. The `death` clip stays in the glb; `driveBotAnim`'s dead branch just stops driving once the ragdoll owns the transform. |
| **MP fire signal** | Add **`EV_FIRE`** to the existing `GameEvent` tag enum — **no new packet, no widened struct**. Server emits it from the same place it sets `last_shot`; client reads `Snapshot.events`, looks up that slot's model + snapshot yaw/pitch for the tracer direction. | The event channel already exists and costs 3 bytes. Reusing yaw/pitch for direction avoids putting a full `Shot` on every fire. `ponytail: yaw/pitch tracer direction; carry an explicit dir only if the tracer visibly lies at close range.` |
| **Per-weapon stance source** | Two **static pose offsets** (rifle, pistol) applied to the upper-body/arm bones + the gun attach transform — authored as constants, not new animation clips. Weapon identity comes from the entity's `weapon` byte (already on the wire) / the bot's active weapon. | No new Mixamo clips to license/bake. A pose delta on a couple of bones is the lazy path to "rifle vs pistol reads different". `ponytail: static pose deltas; author real per-weapon clips only if the static pose looks stiff in motion.` |
| **World-model asset** | Keep reusing the **rifle viewmodel glb** as the world weapon (as `attachBotWeapon` does today); add a **pistol** world instance from the existing `pistol_viewmodel.glb` for the pistol stance. No new art. | Both glbs already ship. A dedicated low-poly world-model is a Phase 13 art concern, explicitly deferred. |

## Increment plan (each ends demoable; don't start N+1 until N's check passes)

### 12.0 — Rig & weapon orientation (the foundation)
The gun currently dangles because `BOT_GUN_POS/ROT` seats it on the right-hand bone with a
hand-tuned guess and nothing poses the arms. Fix the **hold** first — stances (12.1) are deltas on
top of a correct base pose.

- Audit the `ctTemplateScene` armature: confirm the named bones (`righthand`, and find the left-
  hand/forearm/spine bones) exist and their rest orientation. If the rig lacks a usable left-hand
  bone for the foregrip, note it and pose the right hand only.
- Re-seat the rifle so the **grip sits in the right hand and the muzzle points forward** out of the
  chest (not down the arm as a prop). Retune `BOT_GUN_POS/ROT`; record the values as named
  constants with a `ponytail:` calibration note (they're physical knobs, not derivable).
- If a left-hand/forearm bone exists, add a static pose that brings it onto the foregrip.
- **T2/config:** a runtime assert that the attached weapon's world-space forward (muzzle axis)
  aligns with the model's facing within a tolerance — cheap guard against the barrel pointing at
  the ground again. (No pixel-diff.)
- **Check (ACC-020 step 1):** watch a bot idle — hands are on the weapon, muzzle points where the
  bot faces, gun no longer clips through the wrist/chest.

### 12.1 — Per-weapon stances
- Define two pose deltas (`RIFLE_STANCE`, `PISTOL_STANCE`): upper-body/arm bone rotations + the gun
  attach transform, applied over the base pose from 12.0.
- Drive stance from weapon identity: SP bot's active weapon; MP remote's `EntityState.weapon` byte.
  Swap the attached world-model instance (rifle glb ↔ pistol glb) to match.
- Add a **movement pose bias** so the walk/idle reads "weapon up", not arms-at-side — a small
  additive on the base pose, not a new clip (keep `driveBotAnim`'s clip selection intact; layer the
  stance pose after the mixer updates).
- **T0:** stance selection is a pure fn `stanceFor(weapon) → RIFLE|PISTOL`; unit-test the mapping.
- **Check (ACC-020 step 2):** a bot with a rifle vs. one with a pistol are **visibly** different
  holds, and both walk with the weapon up.

### 12.2 — Third-person shooting feedback
Reuse `vfx.muzzleFlash`/`vfx.tracer`; the only work is computing a third-person muzzle origin and,
for MP, getting the fire signal on the wire.

- Add a shared `spawnMuzzleFx(model, dir, scale)` that computes the muzzle world position from the
  attached weapon (weapon world transform + a per-weapon muzzle offset) and calls the existing
  pooled `vfx` flash + tracer. `scale` matches the FP convention (`pistol ? 0.3 : 1`).
- **SP:** call it from the bot fire path (where `fireCooldown` resets / the bot's hitscan resolves)
  with the bot's aim direction.
- **MP:** add `EV_FIRE` to `protocol.ts`; server pushes it in `frame_events` where it records
  `last_shot` (`server/src/main.rs`). Client, in the snapshot-event loop, on `EV_FIRE` looks up
  `remoteRoots.get(slot)` and that entity's snapshot yaw/pitch → `spawnMuzzleFx`.
- **T0:** `protocol.test.ts` round-trips a snapshot carrying an `EV_FIRE` event (encode→decode).
- **T1 (server):** firing a shot puts exactly one `EV_FIRE` for that slot in the frame's events.
- **Check (ACC-020 step 3):** a bot/other player firing shows a flash + tracer **from its muzzle**,
  timed with its shots; verified in SP and in a two-client MP session.

### 12.3 — Ragdoll on death (all of Phase 7)
- On the alive→dead edge (SP: `e.alive = false`; MP: `F_ALIVE` clears for a remote), call a shared
  `spawnRagdoll(model, deathVel)`: create one Rapier **dynamic** body at the model's last transform,
  seed linear velocity from the death frame, and drive the character root's transform from the body
  each render frame. Stop `driveBotAnim` from touching that model once ragdolled.
- Put the body in a **collision group** that hits static world only (never player/bot capsules).
- Step the ragdoll body in the **render loop** off frame dt (cosmetic, outside the 64 Hz sim);
  settle fast (let it sleep), then **despawn on a timer** — remove the body + hide/return the model.
- Respawn/round-reset: on a bot/remote coming back alive, discard any lingering ragdoll and restore
  the live model (ties into the Phase 9 per-round reset already in place).
- Update the **Phase 7 checklist line** in `plan_to_implement.md` that says "driven off the seeded
  RNG" → "fully determined by last pose + death velocity, zero RNG, render-side only" (see decisions).
- **T2/config:** assert the ragdoll collider's collision group excludes the player group (the
  walk-through guarantee, tested at the config level, not by pixel-diff).
- **Check (ACC-020 step 4):** kill a bot (SP) and a remote (MP) — the body falls plausibly, you can
  **walk straight through it** without snagging or getting shoved, and it despawns on its timer.

## Tests & Definition of Done

Feature type per the CLAUDE.md matrix: this is **Rendering / art direction** (T2 config + T3) plus a
sliver of **HUD/UI-like** pure logic (T0 stance/protocol). No T1 sim traces — nothing here is sim
state. Determinism gate still applies to what it touches:

| Tier | What |
|---|---|
| **T0** | `stanceFor(weapon)` mapping; `EV_FIRE` snapshot encode/decode round-trip. |
| **T1** | Server emits exactly one `EV_FIRE` per shot (server crate test). No new sim traces — ragdoll/stances are not sim state. |
| **T2** | Muzzle-axis alignment assert (12.0); ragdoll collision-group excludes the player group (12.3); draw-call budget still `< 400` with ragdoll bodies + a second (pistol) world-model instance live. |
| **T3** | `tests/acceptance/ACC-020-thirdperson-ragdoll.md`, **written before any tuning**: the four checks above, run once in a real browser (SP) *and* a two-client MP session, PASS recorded against a commit hash. |

Determinism / hygiene:
- **No `Math.random`/`Date.now`/`performance.now`** in any of this except the render loop reading
  frame dt for the ragdoll step (allowed — it's below nothing in the sim; ragdoll is cosmetic).
- Ragdoll never writes gameplay state and is never read by the sim or the server. A T1 flake here
  would mean it leaked into the sim — that's the bug, not the test.
- Pose/attach constants live as named constants (metres/radians) with `ponytail:` calibration notes.
- `pnpm test` + `pnpm typecheck` green, no new `any`. Budgets re-verified on integrated graphics.

## Exit test (ACC-020)

Watch a bot / other player: it **holds the rifle correctly** (hands on the weapon, muzzle forward),
switches to a **visibly different pistol stance**, and when it shoots you see a **muzzle flash and a
tracer from its muzzle**. **Kill it** and the **ragdoll drops plausibly** and is **walk-through-able**
(no snag, no shove), then despawns. Verify in single-player *and* in a two-client MP session (the MP
fire feedback comes over `EV_FIRE`; MP death over `F_ALIVE`).

## Risk register (phase-local)

| Risk | Mitigation |
|---|---|
| Ragdoll balloons into an articulated muscle-sim tuning sink | Hard-cap at a **single dynamic body** tumble; the `ponytail:` note marks the multi-body upgrade path. Phase 7 already warned "the tuning is a trap". |
| Ragdoll bodies desync the sim / leak into gameplay | Cosmetic-only, render-loop stepped, zero RNG, collision-group isolated, never read back. T2 asserts isolation; any T1 flake means a leak. |
| Corpse is a clip hazard (shoves/snags live players) | Collision group excludes player/bot capsules (built-in Rapier filter) + fast settle + despawn timer. The walk-through is the exit test. |
| `EV_FIRE` spam bloats snapshots | 3 bytes/event on an already-existing channel, one per shot per slot — negligible; capped by fire rate. No new packet. |
| Rig lacks bones for a proper two-handed hold | 12.0 audits the armature first; if no left-hand bone, pose the right hand only and note it — the muzzle-forward fix still lands. |
| Reused viewmodel glbs look wrong as world-models | Accepted for this phase (art is Phase 13); a dedicated low-poly world-model is deferred, not blocking. |

## Deferred (named, not forgotten)

- Multi-body articulated ragdoll (limbs, joints) — only if the single-body tumble looks like a
  sliding board. The single body is the deliberate ceiling.
- Dedicated low-poly world-models per weapon (vs. reusing viewmodels) — Phase 13 art pass.
- Real per-weapon animation clips (vs. static pose deltas) — only if the static poses look stiff.
- Explicit fire-direction in `EV_FIRE` (vs. reusing snapshot yaw/pitch) — only if the tracer
  visibly lies at close range.
- Death-cause-driven ragdoll impulse (shot direction knocks the body) — cosmetic nice-to-have;
  seed from death velocity for now.

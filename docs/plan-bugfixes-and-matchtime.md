# Build plan — bot fixes, spectator cam, match time limit

Scope: four changes, all confined to `src/main.ts` (+ new test files) except the
match-time limit, which may add one const to `src/game/round.ts`. No shared-sim /
WASM rebuild, no new dependencies.

Root causes (1–3) were confirmed by reading the code; the wall bug was reproduced
with a throwaway test (a solid wall stops blocking `canSee` the instant you skip
`world.step()`).

Suggested order: **1 (P0) → 4 → 3 → 2**.

---

## Bug 1 — Bots shoot through walls  *(P0: fairness + shot feel)*

**Root cause:** `src/main.ts` never calls `world.step()` on the TS Rapier world
(only `sim_tick` drives the WASM sim). No query pipeline / BVH is built for the
static map colliders added by `buildMapColliders(world)` (main.ts:247), so
`canSee`'s LOS raycast **and** the player's bullet `rayCast` pass straight through
every map wall. Verified: a wall stops blocking `canSee` the moment the step is
skipped.

**Fix (one line, hot loop):** step the TS world once per tick, after the player +
all bot kinematic capsules are re-`setTranslation`ed and before perception/shots
resolve. Insert near the top of `tick(fixedDt)` (~main.ts:646):

```ts
world.step(); // refresh query pipeline: statics + kinematic capsules for LOS/hitscan
```

No dynamic bodies exist (props are static, player/bots are kinematic-position), so
stepping only rebuilds the BVH — it won't perturb positions or feel, and stays
deterministic.

**Tests (T1, spec-derived, write-first):**
- Add a `game/hitdetect` T1 that runs the game's own setup path (build colliders →
  `world.step()`) and asserts a bot at spawn A **cannot** see the human at spawn B
  across a known wall — a test that fails on today's code. (The existing
  `perception.test.ts` only passes because it hand-calls `step()`.)
- `pnpm test` + `pnpm typecheck` green.

**T3:** `ACC-bots-los.md` — hide behind cover, confirm bots stop hitting you; peek,
confirm they re-engage.

---

## Bug 2 — Bots don't hold their weapons  *(P2: art/read)*

**Root cause:** bot clones (main.ts:409-439) get no weapon model. No world-model
asset exists — only `ak_viewmodel.glb` / `pistol_viewmodel.glb`.

**Fix (lazy):** reuse the rifle viewmodel GLB as a world-model. When building each
Enemy (main.ts:412-428), find the clone's right-hand bone by name and parent a
cloned rifle mesh to it:

```ts
const hand = clone.getObjectByName('mixamorigRightHand'); // confirm exact name from the glb
if (hand) { const gun = rifleWorldScene.clone(true); gun.position.set(...); gun.rotation.set(...); hand.add(gun); }
```

- Confirm the bone name from the actual `ct_player.glb` (Mixamo rigs are usually
  `mixamorig*`; log the skeleton bone names once to be sure).
- **Leave the hand→grip position/rotation offset as named constants** — this is a
  tuning value, not derivable. That's the calibration knob.
- `rifleScene` (main.ts:553) is reparented onto the viewmodel layer/Group, so load a
  **separate** GLB instance (`rifleWorldScene`) for world-models, or clone before the
  viewmodel claims it. Set the clone's layer to 0 (world), not 1.
- Gun stays parented to the hand through the death anim — acceptable. Skip
  drop-on-death.

**Tests:** T2 config assert — each bot subtree contains a weapon mesh on layer 0;
draw calls still < 400 (5 bots × gun submeshes). No T0/T1 (pure scene wiring).
T3: `ACC-bots-armed.md` — guns in hands, aligned, not clipping.

**Skipped:** dedicated world-model asset, weapon matching each bot's actual weapon
(all rifle), drop-on-death. Add a real low-poly world-model when art budget allows.

---

## Bug 3 — Dying switches to a spectator cam  *(P3)*

**Root cause:** death just freezes first-person at the corpse — `playerAlive=false`
gates the sim (main.ts:669) and `updateViewCamera` keeps rendering the frozen eye.

**Fix (lazy free-fly spectator):** while `!playerAlive`, decouple the camera from the
corpse and free-fly it with existing look + WASD.

- Add module `specPos: Vector3` + a `SPEC_SPEED` const. On death (main.ts:743-746),
  seed `specPos` from the death eye position.
- In `tick`, when `live && !playerAlive`, read `input.state.buttons` (WASD is already
  in the bitmask) and move `specPos` along the current yaw/pitch look vector (noclip —
  it's a spectator). Do **not** touch the WASM sim.
- In `render`, when dead, pose the camera from `specPos` instead of the interpolated
  corpse view: build a `ViewState` with `position = specPos`, `eyeHeight = 0`, punches
  0, and feed the existing `updateViewCamera` with live `input.state.yaw/pitch`.
- Respawn / round-reset already flips `playerAlive` back, so first-person returns
  automatically. Add a "SPECTATING" HUD banner via `bannerText()`.

**Tests:** T1 — headless check that the spectator position integrates WASD while
`playerAlive=false` and does **not** advance the WASM sim / player state. T2: banner
shows when dead. T3: `ACC-spectator.md` — die, fly around, respawn returns to normal.

**Skipped:** spectate-a-teammate / killcam, collision on the spec cam. Add
follow-spectate if the DM netcode wants it later.

---

## Bug 4 — Fixed match time limit of 3 minutes  *(P2)*

**Goal:** the match ends after a fixed 3 minutes of play, regardless of rounds.

**Fix (lazy):** keep `round.ts`'s pure round FSM untouched; add a match clock in
`main.ts`.

- Add a const `MATCH_TIME = 180` (s). Put it next to `DEFAULT_ROUND` (or export from
  `round.ts` as `MATCH_TIME` if you'd rather keep all timers in one file — one line
  either way).
- Add `let matchClock = MATCH_TIME;` and a `let matchOver = false;` in `main`.
- At the top of `tick(fixedDt)`: `matchClock -= fixedDt;` then
  `if (matchClock <= 0) matchOver = true;` (accumulated `fixedDt` → deterministic).
- Guard the sim: while `matchOver`, skip `tickRound`, player movement, and the bot
  loop (freeze the world). Show a final banner ("MATCH OVER — T n : n CT") via
  `bannerText()`, and surface the remaining match time in the HUD if the banner slot
  allows.
- Decision left open (pick at implementation): whether the clock counts total elapsed
  time (simplest — counts freezetime too) or only `live` phases. Default to **total
  elapsed** unless play-testing says otherwise; it's a one-line change to gate on
  `round.phase === 'live'`.

**Tests (T1, write-first):**
- Headless: after `MATCH_TIME` seconds of ticks the match flips to over and further
  ticks no longer advance player/bot/round state (determinism: two runs identical).
- T3: `ACC-match-time.md` — play until the clock expires, confirm the match freezes
  with a final banner and does not silently loop into another round.

**Skipped:** overtime, match restart button, per-round time already exists
(`DEFAULT_ROUND.roundTime`). Add a restart affordance when there's a menu to hang it
on.

---

Everything above touches only `src/main.ts` (+ new tests), with an optional one-line
addition to `src/game/round.ts` for `MATCH_TIME`. No WASM rebuild ritual needed.

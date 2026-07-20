# Plan — bugfix round 2 (post-netcode regressions + scoreboard)

Follow-up to `plan-bugfixes-and-matchtime.md`. Four reported bugs, one of which
(gun orientation) is pure calibration. All changes stay in `src/main.ts` +
`src/core/input.ts` + one new tiny `src/ui/scoreboard.ts`, plus tests.

Reported:
1. Bullets no longer hit bots.
2. Bots make no sound when firing.
3. Bots don't target the player.
4. Tab opens the settings panel instead of a scoreboard.
5. (art) The rifle parented to the bot model isn't pointed outward.

---

## Bug 1 + Bug 3 — bullets miss bots / bots ignore the player (ONE root cause)

**Root cause.** The TS Rapier query pipeline is refreshed by
`ctx.world.updateSceneQueries()` at the end of `tickMovement`
(`src/player/movement.ts:455`). Phase 6.2 moved movement into the WASM sim, so
`tickMovement` is no longer called — the query pipeline went stale (walls + bots
un-queryable). Round-1 patched this with `world.step()` at the top of the tick
(`src/main.ts:692`). That refreshes queries **but a full physics step also
recomputes every kinematic collider's world transform from its parent rigid
body.** Bots are moved with `collider.setTranslation()` (the body never leaves
spawn), so each step snaps every bot collider back to its spawn in the query
BVH. Consequences, both observed:

- Player bullet raycasts query bots at their **spawn**, not where they stand →
  shots pass through the visible bot. ("Bullets don't hit bots.")
- Bot `canSee()` LOS rays run against a BVH where all teammates sit clustered at
  spawn, so a bot near spawn self-blocks on a teammate's stale collider and
  never acquires the player. ("Bots don't target the player.")

The player capsule is unaffected only because it's driven via the **body**
(`movementCtx.body.setTranslation`, `main.ts:750`), which step() honours.

**Fix (one line).** Replace `world.step()` with `world.updateSceneQueries()` at
`main.ts:692`. This is exactly what pre-6.2 code used: it rebuilds the query
pipeline from each collider's **current** transform (including the manual
`collider.setTranslation` bot moves) without stepping physics, so statics
(walls) stay queryable and bots are queried where they actually are. No dynamic
bodies exist, so nothing else relied on step().

Update the comment block at `main.ts:688-692` to say "refresh query pipeline
(no physics step — statics + kinematic collider transforms)".

**Test (T1, regression guard).** In `src/ai/perception.test.ts`, add a case that
a collider moved by `collider.setTranslation` after creation is queried at its
NEW position after `updateSceneQueries()` (and would be wrong after `step()`).
Minimal shape: create a kinematic capsule, `setTranslation` it onto the
sightline, `world.updateSceneQueries()`, assert `canSee(...) === false`. The
existing "does NOT block LOS until stepped" test stays; add the
`updateSceneQueries` twin so the tool swap is pinned.

---

## Bug 2 — bots are silent when they fire

**Root cause.** The bot fire block (`main.ts:793-822`) rolls damage but never
calls `playGunshot`. Only the human's shot plays audio (`main.ts:860`).

**Fix.** When a bot fires (inside `if (fire && e.fireCooldown === 0 && …)`),
play a distance-attenuated gunshot. Audio is mono Web Audio (`core/audio.ts`),
so no true spatialisation — just scale gain by bot→player distance:

- Extend `playGunshot(weapon: WeaponId, gain = 1)` in `core/audio.ts`: multiply
  the two envelope gains by `gain`.
- In the bot fire block, `dist` (bot eye → target) is already computed at
  `main.ts:798`. Call `playGunshot('rifle', falloff(dist))` where
  `falloff = clamp(1 - dist / AUDIBLE_RANGE, 0, 1)` with e.g.
  `AUDIBLE_RANGE = 40` m (matches `SIGHT_RANGE`). Only bots the player can
  roughly see/hear register.
- ponytail: linear rolloff, mono, no per-ear panning. Real positional/distance-
  tail audio is the Howler job the stack notes still defer (`CLAUDE.md`); add it
  when there are enough simultaneous sources for panning to matter.

Play it for **every** bot shot the player is in range of, not only landed shots
(a whiff is still a bang). Gate on `AUDIBLE_RANGE` so the far side of the map
stays quiet.

**Test.** T0-lite: `falloff()` is the only non-trivial bit — an inline
`assert`-style check (0 at/over range, 1 at 0, monotonic) is enough. No audio
mocking.

---

## Bug 4 — Tab opens settings instead of a scoreboard

**Root cause.** Tab is unhandled in `core/input.ts`. In pointer lock the browser
default for Tab is focus navigation, which moves focus off the canvas → pointer
lock drops → `pointerlockchange` shows the settings panel (`main.ts:240-243`).
There is no scoreboard at all yet (`CLAUDE.md` lists it as P3 — but it's
explicitly requested here).

**Fix (two parts).**

1. **Stop Tab stealing focus.** In `input.ts` `onKeyDown`, add
   `if (e.code === 'Tab') e.preventDefault();` and track a held flag on
   `InputState` (`scoreboard: boolean`) set in keydown / cleared in keyup and in
   `onPointerLockChange` (same "don't leave it stuck" reasoning as `buttons`).

2. **A minimal scoreboard overlay.** New `src/ui/scoreboard.ts`:
   `createScoreboard(parent)` returns `{ update(data), show(), hide() }` — a
   plain absolutely-positioned DOM panel (no React, per stack rules), two
   columns (T / CT), one row per player with name + alive/dead + the team score
   header. Feed it from data already in `main.ts`: `round.score`, the human
   (team T, `playerAlive`), and `enemies[]` (`team`, `alive`). In the render
   loop, `input.state.scoreboard ? scoreboard.show() : scoreboard.hide()`.

   ponytail: static "BOT 1..n" + "YOU" labels; no K/D tracking (we don't record
   per-entity kills yet). Add columns when there's kill bookkeeping to fill them.

**Test.** T3 only (it's UI/DOM). Add `tests/acceptance/ACC-017-scoreboard.md`:
hold Tab in-play → scoreboard shows, pointer lock is NOT lost, settings panel
does NOT appear; release → it hides. No T0/T1 (no logic beyond show/hide).

---

## Bug 5 — bot rifle points the wrong way (calibration)

**Root cause.** `BOT_GUN_ROT = (0, π/2, 0)` at `main.ts:384` is a hand guess; the
reused viewmodel rifle's local forward axis doesn't line up with the hand bone's
axis, so the barrel points off (into the torso / sideways) rather than down the
arm.

**Fix.** This is a tuning knob, not a derivable value (ponytail hardware rule:
leave the calibration knob). Steps:

- Adjust `BOT_GUN_ROT` (and `BOT_GUN_POS` if it clips) by eye against the loaded
  model until the barrel points forward down the aim line. Start by trying yaw
  `0` and `-π/2`, and a `±π/2` pitch, to find which axis the viewmodel's barrel
  runs along.
- Verify in ACC-014 step 2 (already written) — mark it Pass with the final
  numbers, or note the residual clip.

No automated test — orientation is a visual property (`CLAUDE.md`: never
pixel-diff the renderer).

---

## Order of work

1. **Bug 1/3** (one-line query-pipeline swap + regression test) — highest impact,
   unblocks combat.
2. **Bug 2** (bot gunshot audio).
3. **Bug 4** (Tab preventDefault + scoreboard).
4. **Bug 5** (gun rotation) — do last, in a running build, alongside ACC-014.

## Definition of Done

- `pnpm typecheck` + `pnpm test` green; new T1 perception guard + `falloff` check
  included.
- ACC-017 written before the scoreboard is coded; ACC-013 (LOS) and ACC-014
  (armed bots) re-run in a real browser after Bug 1/3 and Bug 5.
- `claude_changelog.md` appended; `CLAUDE.md`/`agents.md` synced if any behaviour
  they describe changed (none expected — all fixes restore intended behaviour).

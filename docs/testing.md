# Testing Strategy

The *how* behind the Definition of Done in `CLAUDE.md`. Read this once; after that the DoD
checklist should be enough.

---

## Why naive TDD only half-applies here

The honest version: **you cannot write a failing test for "the movement feels like CS."** Feel
is a perceptual property. Anyone who tells you they've unit-tested it is testing something
else.

But that's a much smaller category than it first appears, and the usual reaction — "games are
untestable, just playtest it" — throws away the 70% that *is* testable and leaves you with a
codebase where every change is a coin flip.

The split for this project:

| Category | Example | Testable? |
|---|---|---|
| **Pure math** | air accel produces 6.35 m/s after N ticks | Yes, trivially. Golden values. |
| **Deterministic simulation** | given this 400-tick input trace, the player ends at this position | **Yes** — because we're fixed-timestep and input-driven. This is the big one. |
| **Data invariants** | every spray pattern has 30 entries; every material name maps to a surface type | Yes. Cheap. Catch at CI. |
| **Runtime budgets** | < 400 draw calls, < 48 MB initial | Yes, headless, assertable |
| **Rendering correctness** | the lightmap is applied to `uv1` | Partially — assert material state, not pixels |
| **Feel** | "does the AK spray feel right" | **No.** Human, scripted, recorded. |

So the rule is: **everything except feel gets a test. Feel gets a written acceptance script
with a named human running it.** Not "we played it and it seemed fine."

---

## The enabling idea: the determinism harness

This is what makes the whole strategy work, and it's the reason fixed timestep is a Phase 0
task rather than a Phase 3 optimisation.

Because the sim is:
- fixed 64 Hz,
- driven entirely by an input struct per tick,
- seeded for all randomness (spread, bot error),
- and free of any dependency on wall-clock time or frame rate,

…it is a **pure function**: `(state, inputTrace, seed) -> state'`.

Which means you can record a real play session's input trace, replay it headlessly in Node in
milliseconds, and assert on the exact resulting state. No renderer, no browser, no GPU.

```ts
// tests/harness/sim.ts
export function simulate(trace: InputTrace, opts?: { seed?: number; map?: string }): SimResult {
  const world = createHeadlessWorld(opts?.map ?? 'test_greybox');
  const rng   = mulberry32(opts?.seed ?? 1);
  for (const tick of trace.ticks) {
    stepSim(world, tick, FIXED_DT, rng);
  }
  return snapshot(world);   // positions, velocities, health, ammo, events[]
}
```

Everything downstream falls out of this:

- **Golden traces** — record once, commit the trace + expected snapshot. Any change to
  movement, weapons, or damage that alters the outcome fails loudly.
- **Bug reproduction** — a player reports getting stuck; you replay their trace in a unit test.
- **Bot testing** — bots are just another input source. Assert they reach the site in < N ticks.
- **Free netcode groundwork** — the same purity is what an authoritative server and client
  prediction require. You get it as a side effect of testing well.

**Any code that breaks determinism is a P0 bug**, including: `Date.now()` in the sim,
`Math.random()` in the sim, iterating a `Set`/`Map` whose insertion order depends on load
order, or reading `deltaTime` anywhere below `core/loop.ts`.

There's a test for this, and it must never be deleted:

```ts
it('is deterministic', () => {
  const a = simulate(TRACE, { seed: 42 });
  const b = simulate(TRACE, { seed: 42 });
  expect(a).toEqual(b);
});
```

---

## The four tiers

| Tier | Name | Runs in | Speed | Gate |
|---|---|---|---|---|
| **T0** | Unit / pure logic | Vitest, Node | < 1 ms each | every save (watch mode) |
| **T1** | Sim / determinism | Vitest + headless harness | < 100 ms each | every commit |
| **T2** | Runtime / budget | Vitest + `headless-gl` or Playwright | seconds | every PR |
| **T3** | Human acceptance | A person, a script, a build | minutes | phase exit |

### T0 — Unit

Pure functions, no world. `friction()`, `accelerate()`, `clipVelocity()`, damage falloff,
spread cone math, spray pattern lookup, surface-name → surface-type mapping.

Golden values come from `docs/source-movement.md`, not from running the code and pasting
the output. **A test that asserts what the code currently does is not a test, it's a
screenshot.** If you can't derive the expected value from the spec, the value doesn't belong
in a golden test — put it in a regression baseline (below) and label it as such.

### T1 — Sim

Uses the harness. No renderer. Assert on state and emitted events.

```ts
it('bunnyhop strafe exceeds ground speed cap', () => {
  const r = simulate(traces.bhopCorridor);
  expect(horizSpeed(r.player.velocity)).toBeGreaterThan(8.0);  // ground cap is 6.35
});

it('cannot walk up a 0.5m riser', () => {
  const r = simulate(traces.walkIntoTallStep, { map: 'test_steps' });
  expect(r.player.position.y).toBeLessThan(0.1);
});

it('AK spray pattern is repeatable', () => {
  const a = simulate(traces.fullMagAtWall, { seed: 1 });
  const b = simulate(traces.fullMagAtWall, { seed: 1 });
  expect(a.events.filter(isImpact)).toEqual(b.events.filter(isImpact));
});
```

**Golden vs. regression baseline — keep these separate:**

- `tests/golden/` — values derived from the spec. Changing one means the spec changed. Requires
  a doc update in the same PR.
- `tests/baseline/` — values recorded from a known-good build. Changing one is *allowed*, but
  the PR description must say why and a human must have re-run the relevant T3 script.

Conflating them is how a suite rots into "just run `--update-snapshots` until green."

### T2 — Runtime

The things that only break in a real browser with a real GPU.

```ts
it('map renders within draw call budget', async () => {
  const { renderer, scene, camera } = await bootHeadless('mymap');
  renderer.render(scene, camera);
  expect(renderer.info.render.calls).toBeLessThan(400);
});

it('lightmap is wired to the second UV set', async () => {
  const { scene } = await bootHeadless('mymap');
  const mats = collectMaterials(scene);
  expect(mats.length).toBeGreaterThan(0);
  for (const m of mats) {
    expect(m.lightMap).not.toBeNull();
    expect(m.lightMap.channel).toBe(1);            // TEXCOORD_1
    expect(m.lightMap.colorSpace).toBe(THREE.NoColorSpace);
  }
});

it('has no realtime shadow-casting lights in the world scene', async () => {
  const { scene } = await bootHeadless('mymap');
  const bad = [];
  scene.traverse(o => { if ((o as THREE.Light).isLight && (o as THREE.Light).castShadow) bad.push(o.name); });
  expect(bad).toEqual([]);
});
```

Also T2: asset budget and asset integrity, which run against `dist/` and `assets/`:

```ts
it('initial payload is under budget', () => {
  expect(bytesOf(criticalPathFiles())).toBeLessThan(16 * 1024 * 1024);
});

it('every map mesh has TEXCOORD_1', () => { /* gltf-transform inspect */ });
it('every texture is KTX2', () => { /* no .png/.jpg in dist/assets */ });
it('every asset file has a CREDITS.md row', () => { /* see licensing-and-assets.md */ });
```

That last one is a licence check masquerading as a test. It belongs here because it's the only
mechanism that actually works.

### T3 — Human acceptance

Written, repeatable, in the repo at `tests/acceptance/<feature>.md`. Not a vibe check.

```markdown
# ACC-MOVE-01 — Movement feel

Build: <commit>   Tester: <name>   Date: <date>   Result: PASS / FAIL

1. Load `test_greybox`. Sprint down the 40 m corridor.
   - [ ] Strafe-jumping sustains > 8 m/s (check the debug speedometer, `?debug=speed`)
   - [ ] Speed gain is smooth, not steppy
2. Walk at a 45° angle into a wall.
   - [ ] Slides along it. No sticking, no judder, no camera shake.
3. Walk into the 0.4 m stairs.
   - [ ] Walked up without jumping, no view bounce per step
4. Stand on the 40° ramp, release input.
   - [ ] Does not slide
5. Stand on the 50° ramp.
   - [ ] Slides down
6. Land from 5 m.
   - [ ] View punch is present and proportionate

Notes:
```

Rules for T3:
- Each phase exit in `plan_to_implement.md` maps to one or more `ACC-*` scripts.
- The result gets committed. A phase is not done until a PASS is in the repo with a name on it.
- If a T3 step fails twice in a row for the same reason, **that step becomes a T1 test.**
  T3 is expensive; use failures to migrate work down the pyramid.

---

## Which tiers does a feature need?

| Feature type | T0 | T1 | T2 | T3 |
|---|:--:|:--:|:--:|:--:|
| Movement math change | ✅ | ✅ | — | ✅ |
| New weapon | ✅ | ✅ | — | ✅ |
| Damage / hitbox change | ✅ | ✅ | — | — |
| Bot AI behaviour | — | ✅ | — | ✅ |
| Nav / pathing | — | ✅ | — | ✅ |
| New map or map geometry | — | ✅ (walkability) | ✅ (budgets) | ✅ |
| Rendering / material setup | — | — | ✅ | ✅ |
| Art direction (fog, tonemap, palette) | — | — | ✅ (settings assert) | ✅ |
| Asset added | — | — | ✅ (credits, format, budget) | — |
| HUD / UI | ✅ (formatting) | — | ✅ (renders) | ✅ |
| Refactor, no behaviour change | — | ✅ (unchanged) | — | — |
| Build / tooling | — | — | ✅ | — |

A refactor's whole point is that T1 stays green **without touching the tests.** If you had to
edit a test to make a refactor pass, it wasn't a refactor.

---

## The loop, as it actually applies

Red-green-refactor works fine for T0 and T1. It's the T3-only work where people give up, so:

**For spec-derived work (movement, damage, weapons) — real TDD:**
1. Open the spec doc. Find the number.
2. Write the failing T0/T1 test asserting the number.
3. Implement until green.
4. Refactor.

**For feel work (recoil tuning, viewmodel FOV, bot difficulty) — inverted:**
1. Write the T3 acceptance script **first**. Deciding what "good" looks like before you start
   tuning is the discipline; it's what stops you from moving the goalposts to wherever you
   landed.
2. Add a T1 determinism/regression test so the behaviour is *pinned* even though it isn't
   *specified*.
3. Tune by hand until the T3 script passes.
4. Update the T1 baseline, note why in the PR.

**For art work — neither:**
1. T2 asserts the *configuration* (lightmap channel, no shadow casters, fog range, tonemapping).
2. T3 asserts the *result*, with a reference screenshot committed alongside.
3. Never assert pixels. Pixel-diffing a 3D renderer across GPU drivers is a flake factory that
   will train the team to ignore CI. This is a hill worth dying on.

---

## What NOT to test

- **three.js, Rapier, or recast internals.** They have their own suites. Test *your usage*.
- **Pixels.** See above.
- **Getters, setters, or data files' contents.** Test the *invariants* of data files (every
  weapon has a spray pattern of length 30), not the values.
- **Blender.** The bake is verified by the 10-minute cube walkthrough and by T2's
  `TEXCOORD_1` assertion, not by a test.
- **Anything where the test would just restate the implementation.**

---

## Infrastructure needed

Build this in Phase 0/1, not "when we have time":

| Piece | Where | When |
|---|---|---|
| Vitest + coverage | root | Phase 0 |
| `tests/harness/sim.ts` — headless world + step | `tests/harness/` | Phase 1, day 1 |
| Seeded RNG (`mulberry32`), injected — never global `Math.random` | `src/core/rng.ts` | Phase 1 |
| `InputTrace` record/replay + `?record` debug flag | `src/core/input.ts` | Phase 1 |
| `tests/traces/*.json` | committed | Phase 1 onward |
| `bootHeadless()` — three + `headless-gl` (or Playwright + WebGL2) | `tests/harness/` | Phase 3 |
| Budget checks against `dist/` | `tests/budget/` | Phase 3 |
| `tests/acceptance/ACC-*.md` | committed, filled in | each phase exit |

The trace recorder is worth calling out: a debug key that dumps the last 30 s of input to JSON.
Ten minutes of work. It turns "I got stuck near B site, I dunno, it just happened" into a
committed regression test in about ninety seconds.

---

## Flake policy

Zero tolerance, because this suite's value is entirely in people trusting it.

- A flaky test is **deleted or fixed within one working day.** Not skipped indefinitely.
- `it.skip` requires a linked issue and an owner. CI prints skipped tests in the summary so
  they can't hide.
- If T1 flakes, that is not a test problem — **it's a determinism bug in the sim**, and it's a
  P0. Chase it, don't retry it.
- No `retry: 3` in the Vitest config. Ever. Retries convert a real bug into a slow test.

---

## Coverage

There's no line-coverage target, because a line-coverage target on a codebase that's 40%
renderer glue produces tests written to hit lines rather than to catch bugs.

Instead, these must be at or near 100% branch coverage, and CI enforces it per-directory:

- `src/player/` (movement)
- `src/weapons/` (damage, spread, recoil)
- `src/game/` (round state, scoring, hitboxes)

Everything else: covered where it's cheap, ignored where it isn't. `src/render/` is covered by
T2 and T3, not by unit tests, and that's the correct answer rather than a compromise.

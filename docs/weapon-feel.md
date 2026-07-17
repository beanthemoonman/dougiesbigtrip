# Weapon Feel

Reference for `src/weapons/`. Everything here is non-obvious, and every item is something
that reads as "this feels cheap" when you get it wrong without knowing why.

---

## 1. The viewmodel is a separate render pass

This is the #1 thing people get wrong and it's invisible until you see it side by side.

### Why not just put the gun in the world scene?

Three reasons, all fatal:

1. **Depth clipping.** Walk into a wall and the gun — which is ~30 cm from the camera —
   intersects the wall and gets sliced in half by the depth buffer.
2. **FOV distortion.** At the 90° world FOV, an object 30 cm from the near plane is
   catastrophically stretched at the screen edges. It looks like a fisheye photo of a gun.
3. **Near-plane clipping.** Your camera's `near` has to be ~0.1 m to avoid z-fighting at
   range, but the gun's grip is inside that.

### The fix

Two cameras, two passes, one frame:

```ts
// Setup
const worldCamera = new THREE.PerspectiveCamera(worldVFov, aspect, 0.1, 500);
const viewCamera  = new THREE.PerspectiveCamera(viewVFov,  aspect, 0.01, 10);
// viewVFov derived from a 54–68° HORIZONTAL viewmodel FOV — see art-direction.md for the conversion

worldCamera.layers.set(0);
viewCamera.layers.set(1);
viewmodelRoot.traverse(o => o.layers.set(1));

// Per frame
renderer.autoClear = false;
renderer.clear();                      // colour + depth
renderer.render(scene, worldCamera);

renderer.clearDepth();                 // <-- the crucial line
viewCamera.quaternion.copy(worldCamera.quaternion);
viewCamera.position.copy(worldCamera.position);
renderer.render(viewmodelScene, viewCamera);
```

`clearDepth()` between passes means the gun is always drawn on top of the world, never clipped
by it, and its perspective is computed with its own sane FOV. This is exactly what Source does.

The viewmodel scene needs its own light rig (a key + fill, low, hand-placed) since it can't use
the lightmap. Tune it once, looking at the gun against both a bright wall and a dark corner.

**Viewmodel FOV is a taste dial and it matters.** 54° puts the gun large and forward (CS 1.6 /
"classic"); 68° pulls it back and small (CS:GO-ish). Pick one, expose it in settings, default
to 60°.

---

## 2. Bullets come from the camera, not the muzzle

The trace originates at the **camera centre**, along the **camera's forward vector**, with
spread applied. The muzzle flash and tracer are cosmetic and start at the muzzle, but the
hitscan does not.

If you trace from the muzzle:
- Standing at a corner, your crosshair is on an enemy but the gun barrel is behind the wall →
  your bullets hit the wall. Players will call this broken, and they'll be right.
- Left-handed vs right-handed viewmodel changes where your bullets go.

The tracer visual therefore lies slightly — it's drawn from muzzle → the camera trace's
impact point, not along the actual trace. Every FPS does this. Nobody notices.

---

## 3. Recoil moves the view, and the bullet follows the view

This is the CS mechanic, and it's different from "the bullet goes somewhere random":

```
per shot:
  1. advance sprayIndex
  2. look up the pattern offset (yaw, pitch) for that index
  3. apply it to the VIEW ANGLES (punch)   <-- the camera actually moves
  4. trace along the NEW view direction + a small random spread disc
```

Consequences that define the skill ceiling:
- **The spray pattern is deterministic.** Shot 7 always goes to the same place relative to
  where shot 1 went. Players learn to compensate by pulling the mouse against the pattern.
- Because recoil moves the *view*, you can see where you're shooting. Pull down and the
  bullets come down with you.
- The random spread disc on top is small — it's what makes the pattern a *cluster* rather
  than a *dot*, and prevents perfect memorisation.

### Recovery

On trigger release (or after `~0.4 s` of no fire), the accumulated punch decays back toward
the original angles over ~`0.35 s`, and `sprayIndex` resets to 0 after a `resetTime` (rifle:
~1.0 s). This is why tapping is accurate and spraying is not.

### Authoring a pattern

Don't procedurally generate it. Author 30 `(yaw, pitch)` pairs in `src/weapons/defs.ts` as
data. AK-style shape: up hard for shots 1–7, then left for 8–12, then right for 13–20, then
loose scatter. Test by firing at a wall and looking at the decals.

**Acceptance test:** fire two full mags at a wall from 10 m. The decal patterns must be
recognisably the same shape. If they're two random clouds, your recoil is random and you've
built a different, worse game.

---

## 4. Accuracy modifiers

Inaccuracy (the radius of the random spread disc) is a sum:

| Condition | Effect |
|---|---|
| Standing still, crouched | baseline (smallest) |
| Standing still | ×1.3 |
| Walking | ×2 |
| Running | ×5 |
| **In the air** | **×20** — jumping should be near-useless for shooting. This is load-bearing; without it, everyone bunnyhop-sprays. |
| Consecutive shots | grows with `sprayIndex` |

Cap air inaccuracy hard. It's the balance mechanism that keeps the movement system from eating
the gunplay.

---

## 5. The crosshair is a readout

The gap between the crosshair arms should be driven by **current inaccuracy**, in real time.
It's not decoration — it's the UI for the accuracy state machine above. Jump and it blooms;
stop and crouch and it tightens. Players read it constantly, mostly unconsciously.

Static crosshair as an option, dynamic as default.

---

## 6. Damage model

- **Range falloff:** `damage × pow(falloffCoef, distance_m / 5)`. Rifle `falloffCoef ≈ 0.98`,
  pistol ≈ `0.75`. So a pistol at 40 m is a pea-shooter and a rifle isn't.
- **Hitbox multipliers:** head ×4, chest ×1, stomach ×1.25, arms ×1, legs ×0.75. The stomach
  bonus is real and surprises people.
- **Armour:** reduces incoming damage and absorbs armour points. Different weapons have
  different armour penetration values. Even a simplified version of this makes fights feel
  more like CS than a flat HP pool does.
- **Wallbang:** trace continues through geometry up to `n` surfaces, losing damage per
  penetration based on the surface's material. Optional for the demo, but it's a big part of
  the identity. Drive it off the material name convention (`docs/blender-pipeline.md` §7).

## 7. Audio

- Firing sound must be **sample-accurate to the shot**, not scheduled a frame later. Preload
  and use Howler sprites; do not `new Howl()` per shot.
- Distinct **first-person** and **third-person** variants of every gunshot. The FP one is
  punchier and drier; the TP one has a tail.
- **Distance tail:** beyond ~25 m, layer in a delayed crack/reverb. Cheap, and it's most of
  what makes gunfire feel like it's happening in a place.
- Reload is multiple sounds on the animation timeline (mag out, mag in, bolt), not one blob.

## 8. Small things with big returns

| Thing | Why |
|---|---|
| Shell casings with physics + a tink sound | Costs an hour, everybody notices |
| Impact decals matched to surface type | Sells the wallbang and the spray pattern |
| Impact particle colour/type per surface | Concrete puffs grey, metal sparks, wood splinters |
| Muzzle flash `PointLight`, ~50 ms | The one dynamic light we allow — see art-direction.md |
| Weapon inspect animation on a key | Free personality |
| Viewmodel sway/lag on mouse movement | Small positional lag behind the camera. Subtle. Its absence makes the gun feel welded to your face. |
| Weapon bob while walking | Small. Too much is nauseating; none feels robotic. |

# Source-Style Movement

The reference for `src/player/movement.ts`. **Read this before touching movement code.**

This is the most important document in the repo. Rendering makes it *look* like CS. This makes
it *feel* like CS, and feel is what people actually remember.

---

## Why you can't just use a physics engine's character controller

Rapier, PhysX, Bullet, Unity's CharacterController — they all give you a kinematic capsule
that moves at the velocity you ask for and slides along walls. That's the easy 20%.

The 80% is *how velocity changes*, and Quake/Source do it in a way that is, from a physics
standpoint, **wrong on purpose**:

- Ground acceleration is not force-based. It's "add a fixed amount toward your wish direction,
  but only up to the point where your speed *along that direction* reaches a cap."
- The cap is applied to the **projection of velocity onto the wish direction**, not to the
  velocity magnitude.
- In the air, the same function runs but the target speed is clamped to a tiny value
  (0.762 m/s) — **while the acceleration amount is computed from the unclamped value.**

That last bullet is the entire reason air-strafing and bunnyhopping exist. It's a 1996 bug in
Quake that shipped, became the defining feel of a genre, and was deliberately preserved by
Valve for 25 years. If you "fix" it, you have made a different game.

So: hand-roll the velocity math, and use Rapier only for collision *queries* (shape-casts and
raycasts). Rapier's `KinematicCharacterController` may be used for the collide-and-slide
resolution, but the accel/friction curve is ours.

---

## Units

**Source uses 1 unit = 1 inch = 0.0254 m. This project uses metres.** Every constant below is
pre-converted. If you see a bare `320` or `800` in movement code, it's a bug.

| Concept | Source (u) | This project (m) |
|---|---|---|
| Gravity | 800 u/s² | **20.32 m/s²** |
| Max run speed (rifle) | 250 u/s | **6.35 m/s** |
| `sv_maxspeed` | 320 u/s | **8.128 m/s** |
| `sv_stopspeed` | 100 u/s | **2.54 m/s** |
| Air wish-speed cap | 30 u/s | **0.762 m/s** |
| Jump impulse | 268.3281573 u/s | **6.8151 m/s** |
| Jump apex rise | 45 u | **1.143 m** |
| Step height | 18 u | **0.4572 m** |
| Player hull, standing | 32 × 32 × 72 u | radius **0.4064 m**, height **1.8288 m** |
| Player hull, ducked | 32 × 32 × 36 u | radius **0.4064 m**, height **0.9144 m** |
| Eye height, standing | 64 u | **1.6256 m** |
| Eye height, ducked | 28 u | **0.7112 m** |

Dimensionless (no conversion):

| Constant | Value | Notes |
|---|---|---|
| `sv_accelerate` | **5.0** | CS value. HL2 uses 10 and feels sluggish by comparison. |
| `sv_airaccelerate` | **10.0** | |
| `sv_friction` | **4.0** | |
| Overbounce | **1.0** | Source uses 1.0 for players. Quake used 1.001 — don't. |
| `MAX_CLIP_PLANES` | **5** | |
| Clip iterations | **4** | |
| Ground normal threshold | **0.7** | `dot(normal, up) >= 0.7` → walkable. = 45.573° |
| Tickrate | **64** | `dt = 1/64 = 0.015625` |
| Duck transition | **0.4 s** | |

Put these in `src/player/constants.ts`. Nowhere else.

---

## Per-tick order of operations

This order is not arbitrary. Reordering it changes the feel.

```
1.  Read input      → wishdir (world-space, normalised, horizontal), buttons
2.  categorizePosition()      → onGround?, groundNormal, surfaceFriction
3.  handleDuck()              → update hull height, eye height
4.  if (jumpPressed && onGround && !jumpHeld) → checkJump()
5.  if (onGround)  friction()
6.  if (onGround)  walkMove()   else  airMove()
7.  if (!onGround) velocity.y -= gravity * dt      // full-tick, applied AFTER accel
8.  tryPlayerMove()           → collide-and-slide, writes position
9.  categorizePosition()      → re-evaluate ground for next tick's prediction
```

Note step 7: gravity applied after acceleration, once, full `dt`. Source actually applies half
gravity before and half after (`StartGravity`/`FinishGravity`) for better integration. Either
is defensible; **pick one and put a comment saying which**, because switching later will
subtly change jump arcs and invalidate the golden tests.

---

## The functions

### `friction()`

Only runs when on the ground. Note the `stopspeed` floor — this is what makes stopping feel
crisp at low speed instead of asymptotically drifting.

```ts
function friction(vel: Vector3, dt: number, onGround: boolean, surfaceFriction: number) {
  const speed = vel.length();
  if (speed < 0.1) return;               // NOTE: Source returns, does NOT zero the velocity

  let drop = 0;
  if (onGround) {
    const friction = SV_FRICTION * surfaceFriction;
    const control = speed < SV_STOPSPEED ? SV_STOPSPEED : speed;
    drop += control * friction * dt;
  }

  let newspeed = speed - drop;
  if (newspeed < 0) newspeed = 0;
  if (newspeed !== speed) vel.multiplyScalar(newspeed / speed);
}
```

### `accelerate()` — ground

```ts
function accelerate(vel: Vector3, wishdir: Vector3, wishspeed: number,
                    accel: number, dt: number, surfaceFriction: number) {
  const currentspeed = vel.dot(wishdir);          // projection, not magnitude
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return;                      // already at/over cap in this direction

  let accelspeed = accel * dt * wishspeed * surfaceFriction;
  if (accelspeed > addspeed) accelspeed = addspeed;

  vel.addScaledVector(wishdir, accelspeed);
}
```

### `airAccelerate()` — the important one

```ts
function airAccelerate(vel: Vector3, wishdir: Vector3, wishspeed: number,
                       accel: number, dt: number, surfaceFriction: number) {
  // Clamp the TARGET speed...
  let wishspd = wishspeed;
  if (wishspd > AIR_WISHSPEED_CAP) wishspd = AIR_WISHSPEED_CAP;   // 0.762 m/s

  const currentspeed = vel.dot(wishdir);
  const addspeed = wishspd - currentspeed;                        // uses CLAMPED
  if (addspeed <= 0) return;

  // ...but NOT the acceleration amount. This asymmetry is the entire mechanic.
  let accelspeed = accel * wishspeed * dt * surfaceFriction;      // uses UNCLAMPED
  if (accelspeed > addspeed) accelspeed = addspeed;

  vel.addScaledVector(wishdir, accelspeed);
}
```

**Do not "simplify" this by making both use the same variable.** Reviewers and LLMs both try
to. It looks like a bug. It is not a bug. There is a comment in the code saying so; leave it.

Why it works: `addspeed = 0.762 - dot(v, wishdir)`. If you're moving fast *forward* and your
wishdir is nearly *sideways*, `dot(v, wishdir)` is near zero, so `addspeed` stays positive and
you get to add a full `accelspeed` chunk — perpendicular to your motion. Perpendicular
addition to a velocity vector increases its magnitude. Sweep the mouse to keep wishdir just
ahead of your velocity, and you gain speed every tick, forever, with no upper bound. That's
air-strafing. Chain it across jumps and that's bunnyhopping.

### `clipVelocity()`

```ts
function clipVelocity(vin: Vector3, normal: Vector3, out: Vector3, overbounce = 1.0) {
  const backoff = vin.dot(normal) * overbounce;
  out.copy(vin).addScaledVector(normal, -backoff);

  // Source's numerical safety pass: make sure we're not still moving into the plane
  const adjust = out.dot(normal);
  if (adjust < 0) out.addScaledVector(normal, -adjust);
}
```

### `tryPlayerMove()` — collide and slide

```
remaining = dt
planes = []
for i in 0..3:                                # 4 iterations
    if velocity is ~zero: break
    hit = shapecast(capsule, position, velocity * remaining)
    if no hit:
        position += velocity * remaining
        break

    position += velocity * remaining * hit.fraction * 0.99   # epsilon back-off
    remaining *= (1 - hit.fraction)

    if planes.length >= MAX_CLIP_PLANES:   # 5
        velocity = 0; break
    planes.push(hit.normal)

    if planes.length == 1:
        velocity = clipVelocity(velocity, planes[0])
    else:
        # try clipping against each plane; accept the first result that doesn't
        # violate any other plane
        found = false
        for p in planes:
            v = clipVelocity(velocity, p)
            if all(v.dot(q) >= 0 for q in planes if q != p):
                velocity = v; found = true; break
        if not found:
            if planes.length == 2:
                # slide along the crease
                dir = cross(planes[0], planes[1]).normalize()
                velocity = dir * dir.dot(velocity)
            else:
                velocity = 0; break          # wedged in a corner
```

The 4-iteration cap and the crease-handling are why Source players slide smoothly into corners
instead of sticking. Cheap approximations of this produce a very recognisable "catching on
geometry" feel.

### Stairs

Source does not detect stairs. It does a three-trace dance every tick you're moving on ground:

1. Do the normal `tryPlayerMove()`. Remember the result (`downPos`, `downVel`).
2. Reset to the start. Trace **up** by `stepSize` (0.4572 m).
3. From there, do `tryPlayerMove()` again with the original velocity.
4. Trace **down** by `stepSize`.
5. If the down-trace lands on a **walkable** surface (`dot(normal, up) >= 0.7`) **and** the
   stepped-up attempt covered more horizontal distance than the flat attempt → keep the
   stepped result. Otherwise keep `downPos`/`downVel`.

Only run this when `onGround`. Running it in the air lets players climb walls.

### `checkJump()`

```ts
if (!onGround || jumpHeld) return;
vel.y = JUMP_IMPULSE;        // 6.8151 — SET, do not add
onGround = false;
jumpHeld = true;             // cleared on button release
```

`vel.y = ` not `vel.y +=`. Additive jumping produces rocket-jump-off-a-ramp behaviour.

Source clears `jumpHeld` on release, which is why auto-bhop is a server setting. Default here:
**no auto-bhop.** You must re-press. It's the CS behaviour and it's a skill expression.

---

## Golden values

`src/player/movement.test.ts` asserts against these. They're derived analytically from the
formulas above; if your implementation disagrees, your implementation is wrong.

`dt = 1/64`, `surfaceFriction = 1`, `sv_friction = 4`, `sv_stopspeed = 2.54`,
`sv_accelerate = 5`, `wishspeed = 6.35`.

### Case A — ground acceleration from rest, wishdir = forward

Order per tick: friction, then accelerate.

| tick | speed (m/s) |
|---|---|
| 1 | 0.49609 |
| 2 | 0.83344 |
| 3 | 1.17078 |
| 4 | 1.50813 |
| 5 | 1.84547 |

Ticks 2–5 are exactly `+0.33734` apart, because below `stopspeed` friction removes a constant
`2.54 × 4 / 64 = 0.15875` per tick and accel adds a constant `5 × 6.35 / 64 = 0.49609`.
Above `stopspeed` the spacing shrinks. Terminal ground speed is exactly `wishspeed` = 6.35.

### Case B — friction decel from 6.35 m/s, no input

Above `stopspeed`, each tick is `× (1 - 4/64) = × 0.9375`.

| tick | speed (m/s) |
|---|---|
| 1 | 5.95313 |
| 2 | 5.58105 |
| 3 | 5.23223 |
| 4 | 4.90522 |
| 5 | 4.59864 |

### Case C — air strafe

Not analytically tidy, so: implement A and B first, get them green, then **generate** case C
from your own implementation, eyeball the curve for sanity (speed must monotonically increase
while the mouse sweeps at the right rate), and freeze it as a regression baseline. It guards
against drift, not correctness.

**Acceptance criterion for the whole phase:** a competent player can strafe-jump down a
corridor and sustain speeds well above 6.35 m/s. If they can't, air accel is wrong — most
likely you clamped `wishspeed` in the `accelspeed` line.

---

## Feel details that are not optional

- **Duck-jump.** Ducking mid-air pulls the hull's feet up, so you clear obstacles higher than
  1.143 m. Players expect this.
- **Landing view punch.** A small pitch dip proportional to impact speed. Cheap, and its
  absence makes landings feel weightless.
- **Speed cap is weapon-dependent.** Knife 250 u/s, rifle 221 u/s, AWP 210 u/s. Scale
  `wishspeed` by the equipped weapon's multiplier. This is a real part of the game's feel.
- **Walk (Shift)** scales `wishspeed` to ~52% and silences footsteps.
- **No air control fudge factor.** Don't add one "to help players". The air accel *is* the
  air control.

---

## Things not to do

- Don't run movement at render framerate. 64 Hz fixed, always. A player on a 240 Hz monitor
  must not move differently from one on 60 Hz.
- Don't use Rapier's dynamic rigid body for the player. Kinematic only.
- Don't add damping, drag, or a `maxLinearVelocity` anywhere in the Rapier config. The
  friction function is the only thing allowed to remove speed.
- Don't normalise velocity to a max speed. There is no max speed in the air. That's the point.
- Don't tune these numbers because something "feels off" until you've confirmed the golden
  tests pass. Nine times out of ten the numbers are right and the *order of operations* is
  wrong.

## References

- Source SDK 2013, `game/shared/gamemovement.cpp` — `CGameMovement::WalkMove`,
  `AirMove`, `Friction`, `Accelerate`, `AirAccelerate`, `TryPlayerMove`, `ClipVelocity`,
  `StepMove`, `CategorizePosition`. Read the real thing; it's ~3000 lines and the movement
  core is maybe 400 of them.
- Quake III `bg_pmove.c` — the same code, ancestrally, and shorter.
- "Bunnyhopping from the Programmer's Perspective" (Flafla2) — the clearest write-up of *why*
  the air accel asymmetry produces speed gain.

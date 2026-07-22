# ACC-020 — Third-person fidelity & ragdoll (Phase 12)

Tester: ___________   Date: ___________   Commit: ___________   Result: PASS / FAIL

## Summary

Verify bots hold weapons correctly, switch stances visibly, show muzzle flash +
tracer when firing, and drop into a walk-through ragdoll on death. Test in both
single-player *and* a two-client MP session.

## Setup

1. `pnpm dev` — open the build in a real windowed browser (not headless).
2. SP: no `?connect=` parameter. Click the canvas to lock the mouse, pick CT from
   the team menu.
3. MP: start the server (`cargo run -p server`), open a second browser tab with
   `?connect=ws://127.0.0.1:9876`, pick T in one and CT in the other.

---

## Step 1 — Rifle hold (SP, 12.0)

Wait for a CT bot to be visible (they patrol the spine corridor and east curve).

- [ ] Pass: The bot's hands are on the rifle — right hand on the grip, left hand
        near the foregrip. The muzzle points forward out of the bot's chest.
- [ ] Pass: The weapon does not clip through the bot's wrist, chest, or face.

NOTES:


## Step 2 — Per-weapon stance (SP, 12.1)

- [ ] Pass: Bots (all armed with rifles) hold the rifle with both hands, weapon up
        at shoulder level, not dangling at arm's length.
- [ ] Pass: During idle and walk animations, the weapon stays roughly in the same
        hold position without drifting far from the hands.

NOTES:


## Step 3 — Third-person muzzle flash + tracer (SP, 12.2)

Move into LOS of a bot (approach the spine corridor or east curve). Watch it fire.

- [ ] Pass: When the bot fires, a brief muzzle flash appears at the end of its
        rifle barrel.
- [ ] Pass: A thin tracer streak runs from the muzzle toward the target (the
        player).
- [ ] Pass: The flash and tracer are timed with the bot's shot audio.
- [ ] Pass: The tracer does NOT originate from the bot's face/eye — it comes from
        the weapon.

NOTES:


## Step 4 — Ragdoll on death (SP, 12.3)

Shoot a bot to death at close range, watching the body.

- [ ] Pass: The bot drops under gravity — it does NOT freeze in place, levitate,
        or instantly vanish.
- [ ] Pass: The body tumbles (even a single-body roll is acceptable) and settles
        on the ground within ~2 seconds.
- [ ] Pass: The body does NOT clip or snag against the player when walked over —
        you can walk straight through the corpse without being pushed or
        blocked.
- [ ] Pass: The corpse is visible for at least 3 seconds, then disappears (despawn
        timer).
- [ ] Pass: Shoot a bot on a slope or near a wall — the body tumbles against the
        geometry, not through it.
- [ ] Pass: Kill all 3 CT bots. When the round resets, the old corpses are gone
        and the reborn bots hold their weapons correctly (no leftover body
        geometry).

NOTES:


## Step 5 — MP fire feedback (12.2)

With both MP clients connected:

- [ ] Pass: When the other player fires, a muzzle flash and tracer appear at their
        weapon muzzle.
- [ ] Pass: The tracer direction matches where the other player's crosshair is
        aimed (roughly — it's their snapshot yaw/pitch).

NOTES:


## Step 6 — MP ragdoll (12.3)

In the MP session, have one player kill the other.

- [ ] Pass: The dead player's model drops into a ragdoll (tumbles, does not
        vanish instantly).
- [ ] Pass: The living player can walk through the corpse without snagging.
- [ ] Pass: The corpse despawns after a few seconds.

NOTES:


## Step 7 — Budget check

- [ ] Pass: Draw calls stay below 400 (check the Stats.js panel — top-left of
        the canvas, right column).
- [ ] Pass: No new console errors after the boot sequence completes.

NOTES:

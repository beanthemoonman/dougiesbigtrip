# ACC-023 — Spatial audio & other actors' footsteps

Build: ______   Tester: ______   Date: ______   Result: ______

Written before tuning `FOOTSTEP_RANGE` / source gain. Wear headphones — half of
these steps are about left/right, which speakers will not reliably show.

## 1. Your own sounds stay at the ear

- [ ] Spawn, fire a burst, reload, take a hit from a bot.
- [ ] Your gunshot, your reload clicks, and the hurt thud are all dead centre —
      they do not pan when you turn.
- [ ] Your own footsteps are centred and unchanged in volume from before.

## 2. A bot's footsteps are audible and directional

- [ ] Stand still in the open and let a bot patrol past you.
- [ ] Footsteps are clearly audible as it approaches.
- [ ] They come from the correct side: bot on your left → sound on the left.
- [ ] Turn 180° on the spot while it walks — the sound swaps sides.

## 3. Footsteps carry a short distance only

- [ ] Follow a bot from ~20 m. Its steps are inaudible.
- [ ] Close to ~10 m. Steps become audible and grow as you close.
- [ ] At contact range they are prominent but not louder than a gunshot.
- [ ] Standing in T spawn, you cannot hear bots moving in CT spawn.

## 4. Footstep pacing reads as movement, not a metronome

- [ ] A running bot steps noticeably faster than a walking one.
- [ ] A stationary bot is silent — no residual ticking.
- [ ] A bot that stops and immediately restarts does not fire a step the instant
      it starts moving.
- [ ] A jumping bot makes no footstep while airborne.

## 5. Gunfire and impacts are positional

- [ ] A bot firing at you from your right sounds to the right.
- [ ] Shoot a wall to your left; the impact tick comes from the left.
- [ ] A bot firing across the map (>40 m, out of LOS) is silent.
- [ ] Gunfire is still clearly louder and carries much further than footsteps.

## 6. Death, spectating, and respawn

- [ ] Die. While free-flying as a spectator, bots' footsteps and gunfire pan
      relative to the spectator camera, not your corpse.
- [ ] Fly toward a firefight — it gets louder. Fly away — it fades.
- [ ] On respawn, no stale step fires from your last position.
- [ ] At team select (overview camera) nothing sounds broken or stuck-on.

## 7. Multiplayer (`?connect=`)

- [ ] With a second client connected, you can hear the other player's footsteps.
- [ ] They are directional and cut out at roughly the same range as a bot's.
- [ ] A remote player who dies and respawns elsewhere does not emit a single
      loud step at the moment of respawn (the teleport-step case).
- [ ] A player disconnecting mid-run leaves no lingering footstep sound.

## 8. No regressions

- [ ] The volume slider still scales everything, positional voices included.
- [ ] No crackling, clipping, or audio dropout during a full round of combat.
- [ ] Sustained combat with 10 bots does not degrade framerate (panner nodes are
      created per voice — watch for a slow leak over a long match).

## Notes

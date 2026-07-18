# ACC-007 — Greybox map playtest

Covers the **Phase 3 greybox step**: "Playtest the greybox with Phase 1 movement *before*
texturing. Timings and sightlines are set now; art is set later." This is the layout sign-off —
routes, sightlines, and that the movement feel survives on real map geometry (not the Phase 1
test room). Lighting/texture is a separate later increment (ACC-008, to be written then).

Written **before** any layout tuning, per the Definition of Done. Run in a **real windowed
browser** (headless Chromium's synthetic pointer-lock click injects a spurious yaw jump; every
step here is look/movement dependent).

- **Build:** `pnpm dev`, open the printed URL.
- **Tester:** ______  **Date:** ______  **Commit:** ______  **Result:** ⬜ (not yet run)

Map: `de_greybox` (`src/game/map_greybox.ts`). You spawn at **T** (south). The **site** is the
open area to the north; **CT** hold is behind it.

## Steps

1. **You spawn on the floor, facing into the map.** Click to lock the mouse. You are standing on
   the ground in the south spawn, not floating and not clipped into the floor. Looking north you
   see the three lane openings.
   - [ ] Pass

2. **Three routes reach the site.** Walk from T spawn to the site three times, once per lane:
   **West** (tunnels), **Mid** (through the doorway choke), **East** (long). Each lane gets you
   into the open site. None is a dead end.
   - [ ] Pass

3. **The mid choke is passable at speed.** Run through the mid doorway without ducking. You pass
   cleanly — no getting wedged, no juddering against the doorframe edges.
   - [ ] Pass

4. **Movement feel survives on the map.** In an open lane, bunnyhop-strafe and exceed the
   6.35 m/s ground cap (same as the Phase 1 room). Strafing into a wall at an angle slides along
   it without sticking.
   - [ ] Pass

5. **Step-up, not hop.** Walk onto the step→platform stack on the east side of the site. You walk
   up both rises smoothly; you do not have to jump.
   - [ ] Pass

6. **No slope slide.** Stand still on the ramp in the west of the site. You do not slide down it.
   - [ ] Pass

7. **Sightlines read.** From the site, the crates and pillars break the lines of sight enough that
   there are angles to hold and angles to peek — it is not one flat empty box. (Subjective; note
   anything that feels too open or too cramped for retuning.)
   - [ ] Pass

## Notes / retune list
_(record layout changes to make before texturing)_

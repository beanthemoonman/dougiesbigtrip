# Phase 11 — Advanced bot AI: search & engage

Replace scripted **fixed patrol waypoints** with an emergent **search ↔ engage** loop. The FSM,
`lastKnown` pursuit, LOS-raycast perception, and the non-snapping aim model already exist — this is
a *behaviour rework on top of them*, not a from-scratch AI. Most FSM transitions stay; two
behaviours change (patrol → spread-out search; straight-line move → path-to-goal) and one new
capability is added (server-side pathing).

## The dual-port tax (read first)

Bot AI, like movement, lives in **two** places that behave differently *today*:

| Port | Files | Has nav? | Runs in |
|---|---|:--:|---|
| **TS** (single-player) | `src/ai/brain.ts` + `perception.ts` + `nav.ts` + `aim.ts`, ticked at `main.ts:1107` | ✅ recast `findPath` | SP client |
| **Rust** (authoritative) | `server/src/ai.rs`, driven from `server/src/main.rs` | ❌ **straight-line only** (`ai.rs:232`) | MP server |

The Rust server bots **have no pathfinding** — they walk straight at the goal and rely on
collide-and-slide to scrape around walls. That is fine-ish on open ground and useless in the "D"
loop's spine corridor. **The authoritative AI is the Rust one** (exit test is server-side), so every
behaviour in this phase must land in `ai.rs` and be covered by T1 there; the TS brain is mirrored so
SP doesn't regress. After touching Rust, owe the WASM rebuild ritual only if `sim/` changed — `ai.rs`
lives in the `server` crate, not `sim/`, so a plain `cargo build -p server` is usually enough (the
nav helper in 11.0 goes in `server`, not the shared WASM sim).

## What already exists (reuse, don't rebuild)

| Thing | TS | Rust | Note |
|---|---|---|---|
| FSM: Idle/Investigate→Engage→Reposition→Idle | `brain.ts:138` | `ai.rs:164` | keep the shape; rework Idle & the move goal |
| LOS raycast (occludes on world colliders) | `perception.ts` `canSee` | `ai.rs:81` `can_see` | the "no wallhack" primitive — verify props included |
| `lastKnown` pursuit + give-up timer | `brain.ts:201` `loseMemory` | `ai.rs:170` `LOSE_MEMORY=4s` | give-up already exists — reuse for 11.4 |
| Non-snapping aim (reaction/turn-rate/error) | `aim.ts`, `DIFFICULTIES` | `ai.rs:189` | untouched — the engage loop already fires only while visible |
| Fixed patrol routes (what we're replacing) | `brain.patrol` `brain.ts:63` | `PATROL_CT/PATROL_T` `main.rs:37`, `Bot.waypoints` | delete/repurpose as search seed nodes |
| Baked navmesh (recast blob) | `de_douglas.navmesh.bin` via `nav.ts` | — none — | TS only; server can't read the recast blob |

## Decisions to lock

| Decision | Choice | Why |
|---|---|---|
| **Server pathing** | **Static waypoint graph + greedy hop**, not a Rust recast port. Hand-place ~8–12 nodes across the map with adjacency (neighbours chosen to have clear LOS so straight-line + collide-slide between them never snags); bots path node-to-node. Seed it from the existing `PATROL_*` points. | A Rust recast runtime is weeks and needs the blob re-exported to a Rust-readable format. The map is one small fixed loop — a hand-authored graph is the classic small-map bot nav, is deterministic, and reuses data we already have. `ponytail: waypoint graph, upgrade to a real navmesh port only if a second map lands.` |
| **Where the graph lives** | New `assets/maps/de_douglas.navnodes.json` (nodes + edges), loaded by **both** ports (Rust `serde` on the server, `import` in TS). Single source of truth. | No third divergent copy. TS keeps recast for *movement* quality but selects the *same* search node so behaviour matches. |
| **Search goal selection (shared spec)** | Pick the graph node maximising `w1·(min distance to any teammate) + w2·(time since this node was last visited by anyone)`. Deterministic tie-break by node index. No RNG in selection (keeps T1 replays exact). | "Spread out + sweep unvisited" falls straight out of those two terms. No per-bot randomness → deterministic. |
| **TS pathing under the shared goal** | SP keeps recast `findPath` to the chosen node (better-looking); server uses the graph hop. Same node chosen → same behaviour, different smoothness. | Don't throw away the working recast path in SP; only the *goal* must match, not the interpolation. |
| **Difficulty knobs** | Unchanged. Search/give-up timings reuse `LOSE_MEMORY` / `loseMemory`; no new difficulty fields unless a trace demands one. | YAGNI. |

## Increment plan (each ends demoable; don't start N+1 until N's check passes)

### 11.0 — Server pathing foundation (the enabler)
The one piece of genuinely new machinery. Search and last-known pursuit both need the server bot to
*reach* a goal that isn't in a straight line.

- Author `assets/maps/de_douglas.navnodes.json`: `{ nodes: [[x,y,z]...], edges: [[i,j]...] }`. Place
  nodes so every edge has clear LOS between its endpoints (walk the "D" loop: spine corridor, curve,
  counter, each spawn). Seed from `PATROL_CT`/`PATROL_T`.
- Rust: load it in `server` (serde), add `nav_graph.rs` — `nearest_node(pos)`, `next_hop(from_node,
  goal_node)` via a tiny BFS/Dijkstra over edges (≤ ~12 nodes; no fancy A*). Store `path_goal_node`
  on `Bot`; movement walks toward the current hop's position, advancing when within `WAYPOINT_RADIUS`.
- Replace the straight-line `let (gx, gz) = ...waypoint...` block (`ai.rs:212-224`) with a hop lookup.
- TS: load the same JSON; add matching `nearestNode`/`nextHop` so SP can pick the same node, then hand
  the node position to the existing recast `findPath`.
- **T1:** a bot placed on one side of the spine with a goal on the other reaches it (arrives within
  radius in ≤ N ticks) instead of pinning against the wall. Deterministic replay, committed trace.
- **Check:** a server bot routed to a goal behind a wall walks *around* via nodes, doesn't grind the wall.

### 11.1 — Spread-out search (replaces fixed patrol)
- Add search-goal selection (the shared spec above) in both ports. Track per-node `lastVisitedTick`
  (map-global, server-owned) and read teammate positions (already available to `tick_bot` via
  `player_positions` + team info).
- In `Idle` (rename intent to "searching" — no new state needed): when the current search goal is
  reached or none is set, pick a new node by the formula and path to it via 11.0.
- Delete the `waypoint_index` cycling (`ai.rs:234`) and `brain.patrol`/`patrolIndex` route-walking;
  the graph + selection replaces both.
- **T1:** drop 3 same-team bots at one spawn, no targets; after M ticks their chosen nodes are
  mutually distant (assert pairwise min-distance ≥ threshold) and cover ≥ K distinct nodes over time.
- **Check:** with no targets, a squad fans out and sweeps rather than conga-lining one loop.

### 11.2 — Engage loop (verify + wire pursuit through nav)
The Engage side largely exists (`Engage` fires only while `sees`, drops to `Reposition` on LOS loss).
The gap is **Reposition on the server straight-lines to `last_known`** — route it through 11.0 instead.

- Server: in `Reposition`, set the path goal to `nearest_node(last_known)` and hop toward it via the
  graph (final approach to the exact `last_known` point once at the nearest node).
- TS already does this via `findPath(nav, pos, lastKnown)` — verify unchanged.
- Confirm the engage/fire path is untouched (aim model, `reaction_timer`, fire tolerance).
- **T1:** bot sees target → `Engage` + fires while visible; target steps behind a wall → `Reposition`,
  bot paths toward last-known (assert it advances along nodes, not into the wall).
- **Check:** bot shoots while it can see you; on LOS loss it moves toward where it last saw you.

### 11.3 — No wall-hacks (verify + harden)
- Confirm `can_see` / `canSee` raycast occludes against **all** world colliders on the server —
  **including breakable props** (crates/barrels). Verify the server world actually adds prop colliders
  (SP adds them in `main.ts`; confirm the server does too, or add them). A gap here = bots seeing
  through crates.
- Confirm the `dist - 0.1` shorten (`ai.rs:113`) doesn't let a shot register through a paper-thin wall
  the ray tip skips.
- **T1:** wall (and separately, an intact crate) placed exactly between bot and target → assert **no
  acquisition** (`sees == false`), then remove it → acquisition. Both ports.
- **Check:** standing behind a wall or an intact crate, no bot ever tracks or fires at you through it.

### 11.4 — Give-up timeout → back to search
- Already present as `LOSE_MEMORY`/`loseMemory` (Reposition → Idle after the timer). Extend the trigger:
  also give up **on reaching `last_known` without re-acquiring** (TS `pickGoal` already flips to idle at
  path end; mirror that in `ai.rs` — on arrival at the last-known node with no LOS, clear target and
  return to search).
- On give-up, `target_slot = None`, `last_known = None`, fall back into 11.1 search (not a camp).
- **T1:** bot loses LOS, paths to last-known, target stays hidden → after arrival (or timeout) bot
  clears target and resumes search (asserts a new spread-out goal is chosen).
- **Check:** break LOS and hide; after a short beat the bot stops staring at the spot and resumes sweeping.

## Tests & Definition of Done

| Tier | What |
|---|---|
| **T1** | The five traces above, **authoritative on the Rust server AI** (`server` crate tests / sim harness), mirrored for the TS brain so SP doesn't regress. All deterministic — `simulate(trace,{seed})` twice → identical. No RNG in goal selection (see decisions). |
| **T3** | `tests/acceptance/ACC-019-bot-search-engage.md`, **written before any tuning**: the exit test below, run once in a real browser (SP) *and* two-client MP, PASS recorded against a commit hash. |

Determinism gate applies: goal selection is pure over (positions, visit ticks), tie-broken by index;
no `Date.now`/`Math.random` under `src/` or in `ai.rs`; give-up/search timings in named constants.
Golden bot traces changing means the behaviour spec (this doc) changes in the same PR.

## Exit test (ACC-019)

Drop bots into the map with no scripted routes — they fan out and sweep. Show yourself: a bot engages
and fires while it can see you; break LOS and it moves to where it last saw you; stay hidden and after
a short beat it resumes searching. Standing behind a wall (and behind an intact crate), no bot ever
tracks or shoots you through it. Verify in SP and in a two-client MP session (server is authoritative).

## Risk register (phase-local)

| Risk | Mitigation |
|---|---|
| Server bot nav balloons into a recast port | Hard-cap at the hand-authored waypoint graph. One small fixed map — a real navmesh port is out of scope; the `ponytail:` note marks the upgrade path. |
| TS and Rust search behaviours drift | Shared `navnodes.json` + identical goal-selection formula; the *node chosen* is the contract, pathing smoothness isn't. T1 on both. |
| Bad node placement traps bots on a wall corner | Nodes authored so every edge has LOS; the 11.0 T1 (route across the spine) is the guard. |
| Prop LOS gap makes bots wallhack through crates | 11.3 explicitly tests an intact crate between bot and target, both ports. |

## Deferred (named, not forgotten)

- Real navmesh on the server (recast blob → Rust) — only if a second map lands. The waypoint graph is
  the deliberate ceiling.
- Squad tactics beyond spread (bounding overwatch, trade-frags, flanking coordination) — this phase is
  search + engage, not team play. A later AI pass.
- Difficulty-scaled search aggression — reuse existing difficulty knobs; add a search-specific field
  only if a trace proves the single timing feels wrong.
- Full per-weapon aim patterns (burst-fire, tap discipline, target-tracking — Phase 2 covers human
  weapons only).

## Phase 11.5 — Caution tuning (post-implementation)

After the initial playtest, bots felt too aggressive — rushing full-speed between nodes into the
killbox with no tactical pacing. The following constants were added to both ports to make search
behaviour read as "cautious sweep" rather than "speed-run the waypoint graph":

| Constant | Value | What |
|---|---|---|
| `CAUTION_MOVE_TICKS` | 160 (~2.5 s) | How long a search-mode bot walks before pausing |
| `CAUTION_PAUSE_TICKS` | 96 (~1.5 s) | How long it stands still and scans before walking again |
| `CAUTION_JITTER` | 64 (±1 s) | Per-bot tick offset so they don't pause in lockstep |
| `SCAN_RATE` | 1.0 rad/s | Yaw rotation speed during the pause scan |
| `SEARCH_DUTY_ON` / `_PERIOD` | 3 / 4 | FORWARD pressed only 3 of every 4 ticks in search mode |
| `W_TEAMMATE_DIST` | 3.0 (was 1.0) | Weight on teammate-spread in search-goal scoring |
| `W_RECENCY` | 2.0 (unchanged) | Weight on avoiding recently-visited nodes |
| `REACTION_TIME` | 0.5 s (was 0.35 s) | Server-side normal difficulty reaction time |
| TS easy/normal reactionTime | 0.8 / 0.5 (was 0.6 / 0.35) | Matched to new server constant |

The caution rhythm lives entirely in `ai.rs:search` and `brain.ts:search` — it does not affect
Engage (stand + shoot) or Reposition (full-speed pursuit) modes. The stop-and-scan head turn uses
`server_tick + tick_offset` to produce a deterministic left/right pan so replays stay identical.

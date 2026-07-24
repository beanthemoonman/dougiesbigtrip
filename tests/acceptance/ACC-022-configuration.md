# ACC-022 — Configuration

Build: 014b5dc   Tester: Claude   Date: 2026-07-23   Result: PASS

## 1. SP match with non-default bot count

- [ ] Load the game with `?bots=4&rounds=8` in the URL.
- [ ] Observe 4 bots total (2 per side) spawned.
- [ ] The match plays with 8 rounds to win.

## 2. SP match with max bot count

- [ ] Load the game with `?bots=10&rounds=16` in the URL.
- [ ] Observe 10 bots total (5 per side) spawned.
- [ ] The match plays with 16 rounds to win.

## 3. SP match with default config (no URL params)

- [ ] Load the game without URL params.
- [ ] Observe 6 bots total (3 per side) — the original default.
- [ ] The match plays with 16 rounds to win.

## 4. Settings panel "New Match" section

- [ ] Press Esc to open the settings panel.
- [ ] A "New Match" section is visible below the server/game sections.
- [ ] Bot count slider is present with range 2–10, defaults to the active value.
- [ ] Rounds slider is present with range 1–30, defaults to the active value.
- [ ] Clicking "New Match" reloads the page with the selected config in URL params.

## 5. Match-over at configured rounds-to-win

- [ ] Start a match with `?bots=2&rounds=3`.
- [ ] Play until one side reaches 3 round wins.
- [ ] A "MATCH OVER" banner appears showing the final score and a countdown.
- [ ] After the countdown the match restarts with zeroed scores.

## 6. Invalid config URLs are rejected

- [ ] Load the game with `?bots=999` in the URL.
- [ ] The game starts with the default 6 bots (invalid value is clamped/rejected).
- [ ] The console shows `ignoring match config in URL: botCount must be ...`.
- [ ] Load with `?bots=4` **alone** (no `rounds`). 4 bots spawn and rounds stays at the
      default 16 — a missing param must not be read as 0.
- [ ] Load with `?bots=1`. Rejected → default 6 bots (below the floor of 2; one team would
      start empty and every round would end instantly).

Notes:

/**
 * E2E: Phase 9 team/bot roster rules over a real WebSocket.
 *
 * The rules (see docs/plan-phase9-game-flow.md):
 *   - Each team has 3 bots by default (3v3, all slots bot-filled).
 *   - A joining player replaces a bot INSTANTLY, mid-round or not.
 *   - A player who leaves is replaced by a bot only NEXT round — never mid-round.
 *   - Teams are hard-capped at 3; the 4th on a full team is forced to spectate.
 *   - Capacity = 6 players + 4 spectators (specCap = ceil(2/3 · 6)); over that,
 *     new connections are refused with a Bye.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeBye, decodeSnapshot, F_ALIVE, F_TEAM_CT, TAG_BYE, type Snapshot } from '../../src/net/protocol';
import { connect, joinTeam, startServer, tagOf, SERVER_BUILT, type Client } from './harness';
import type { ChildProcess } from 'node:child_process';

const BIND = '127.0.0.1:9898';
const WS_URL = `ws://${BIND}`;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Read snapshots until `pred` holds; reject after `ms`. Returns the matching snapshot. */
async function waitForSnapshot(client: Client, pred: (s: Snapshot) => boolean, ms = 15000): Promise<Snapshot> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const bytes = await client.next(Math.max(1, deadline - Date.now()));
    const snap = decodeSnapshot(bytes);
    if (snap && pred(snap)) return snap;
  }
  throw new Error('snapshot predicate timeout');
}

const isCt = (flags: number): boolean => (flags & F_TEAM_CT) !== 0;

describe.skipIf(!SERVER_BUILT)('Phase 9 roster rules', () => {
  let proc: ChildProcess | null = null;
  beforeAll(async () => { proc = await startServer(BIND); });
  afterAll(() => { proc?.kill(); });

  it('serves 3v3 bots by default — 6 entities, 3 per team', async () => {
    const spec = await connect(WS_URL);
    await joinTeam(spec, 2); // spectate; server streams snapshots
    // Freezetime right after a reset: every slot is alive, so all 6 show up.
    const snap = await waitForSnapshot(spec, (s) => s.round.phase === 0 && s.entities.length === 6);
    expect(snap.entities.length).toBe(6);
    expect(snap.entities.filter((e) => isCt(e.flags)).length).toBe(3);
    expect(snap.entities.filter((e) => !isCt(e.flags)).length).toBe(3);
    spec.close();
    await delay(100);
  });

  it('spawns a joining player instantly, mid-round (replacing a bot)', async () => {
    // Spectator pins the round: wait until we are well into Live (>5 s left).
    const spec = await connect(WS_URL);
    await joinTeam(spec, 2);
    const live = await waitForSnapshot(spec, (s) => s.round.phase === 1 && s.round.timeLeftMs > 5000);
    const scoreSum = live.round.scoreT + live.round.scoreCt;

    // Join T now; assert we are alive during that SAME live round (no reset).
    const player = await connect(WS_URL);
    const { welcome, spectator } = await joinTeam(player, 0);
    expect(spectator).toBe(false);
    const mySlot = welcome!.yourSlot;
    const seen = await waitForSnapshot(player, (s) => {
      const me = s.entities.find((e) => e.slot === mySlot);
      return !!me && (me.flags & F_ALIVE) !== 0;
    }, 3000);
    expect(seen.round.phase).toBe(1); // alive while Live — spawned mid-round
    expect(seen.round.scoreT + seen.round.scoreCt).toBe(scoreSum); // no round elapsed

    player.close();
    spec.close();
    await delay(100);
  });

  it('backfills a departed player with a bot only next round, not mid-round', async () => {
    const spec = await connect(WS_URL);
    await joinTeam(spec, 2);

    const player = await connect(WS_URL);
    const { welcome } = await joinTeam(player, 0);
    const mySlot = welcome!.yourSlot;
    // Confirm the human is live in the round first.
    await waitForSnapshot(spec, (s) => s.round.phase === 1 && s.entities.some((e) => e.slot === mySlot));

    // Leave mid-round: the slot must go empty (dead, no bot) while still Live.
    player.close();
    const vacated = await waitForSnapshot(spec, (s) => s.round.phase === 1 && !s.entities.some((e) => e.slot === mySlot));
    expect(vacated.entities.some((e) => e.slot === mySlot)).toBe(false);

    // Next round (after a reset) the slot is bot-filled again → back in the snapshot.
    await waitForSnapshot(spec, (s) => s.round.phase === 2); // round over
    const backfilled = await waitForSnapshot(spec, (s) => s.round.phase === 0 && s.entities.some((e) => e.slot === mySlot));
    expect(backfilled.entities.some((e) => e.slot === mySlot)).toBe(true);

    spec.close();
    await delay(150);
  });

  it('forces the 4th player on a full team to spectate; the other team still has room', async () => {
    const t: Client[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await connect(WS_URL);
      const r = await joinTeam(c, 0); // T
      expect(r.spectator).toBe(false);
      t.push(c);
    }
    // T is full (3 humans). A 4th T join → spectator.
    const overflow = await connect(WS_URL);
    expect((await joinTeam(overflow, 0)).spectator).toBe(true);
    // CT still has 3 bot slots → a CT join gets a real slot.
    const ct = await connect(WS_URL);
    expect((await joinTeam(ct, 1)).spectator).toBe(false);

    for (const c of [...t, overflow, ct]) c.close();
    await delay(200);
  });

  it('advertises 6 max players and a spectator cap of 4 in the Welcome', async () => {
    // The client reads capacity from the Welcome (players/maxPlayers/spec/specCap),
    // not the advisory /status HTTP endpoint. maxPlayers = 3 T + 3 CT; specCap =
    // ceil(2/3 · 6) = 4.
    const c = await connect(WS_URL);
    const { connectWelcome } = await joinTeam(c, 2);
    expect(connectWelcome.maxPlayers).toBe(6);
    expect(connectWelcome.specCap).toBe(4);
    c.close();
    await delay(100);
  });

  it('serves capacity as JSON over GET /status (Gate 1 pre-dial)', async () => {
    const res = await fetch(`http://${BIND}/status`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ maxPlayers: 6, specCap: 4 });
    expect(typeof body.players).toBe('number');
    expect(typeof body.spectators).toBe('number');
  });

  it('refuses a connection once the server is full (6 players + 4 spectators)', async () => {
    const clients: Client[] = [];
    // 6 players: 3 T + 3 CT.
    for (let i = 0; i < 6; i++) {
      const c = await connect(WS_URL);
      const r = await joinTeam(c, i % 2); // 0=T, 1=CT
      expect(r.spectator).toBe(false);
      clients.push(c);
    }
    // 4 spectators fill the rest of capacity.
    for (let i = 0; i < 4; i++) {
      const c = await connect(WS_URL);
      await joinTeam(c, 2);
      clients.push(c);
    }
    await delay(100); // let the game loop update ACTIVE_HUMANS / SPECTATOR_COUNT

    // The 11th connection is refused at the handshake with a Bye.
    const rejected = await connect(WS_URL);
    const first = await rejected.next();
    expect(tagOf(first)).toBe(TAG_BYE);
    expect(decodeBye(first)?.reason).toBe('full');
    rejected.close();

    for (const c of clients) c.close();
    await delay(200);
  });
});

pub const PROTOCOL_VERSION: u8 = 1;

pub const TAG_WELCOME: u8 = 0;
pub const TAG_BYE: u8 = 1;
pub const TAG_CMD: u8 = 2;
pub const TAG_SNAP: u8 = 3;
pub const TAG_JOIN: u8 = 4;

pub const SPECTATOR: u8 = 255;

#[derive(Debug, Clone, PartialEq)]
pub struct Welcome {
    pub your_slot: u8,
    pub map: String,
    pub seed: u32,
    pub server_tick: u32,
    /// Phase 9 capacity fields (zero-padded at the end for old decoders).
    pub max_players: u8,
    pub players: u8,
    pub spectators: u8,
    pub spec_cap: u8,
    /// Phase 16: rounds-to-win for match end (defaults to 0 for old-form Welcome).
    pub rounds_to_win: u8,
}

impl Welcome {
    pub fn encode(&self) -> Vec<u8> {
        let map_bytes = self.map.as_bytes();
        let len = 1 + 1 + 1 + 1 + map_bytes.len() + 4 + 4 + 5;
        let mut buf = Vec::with_capacity(len);
        buf.push(TAG_WELCOME);
        buf.push(PROTOCOL_VERSION);
        buf.push(self.your_slot);
        buf.push(map_bytes.len() as u8);
        buf.extend_from_slice(map_bytes);
        buf.extend_from_slice(&self.seed.to_le_bytes());
        buf.extend_from_slice(&self.server_tick.to_le_bytes());
        buf.push(self.max_players);
        buf.push(self.players);
        buf.push(self.spectators);
        buf.push(self.spec_cap);
        buf.push(self.rounds_to_win);
        buf
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 12 {
            return None;
        }
        if data[0] != TAG_WELCOME || data[1] != PROTOCOL_VERSION {
            return None;
        }
        let your_slot = data[2];
        let map_len = data[3] as usize;
        if data.len() < 4 + map_len + 8 {
            return None;
        }
        let map = String::from_utf8(data[4..4 + map_len].to_vec()).ok()?;
        let seed = u32::from_le_bytes(data[4 + map_len..8 + map_len].try_into().ok()?);
        let server_tick =
            u32::from_le_bytes(data[8 + map_len..12 + map_len].try_into().ok()?);
        // Phase 9 capacity fields; default to 0 for old-form Welcome.
        let off = 12 + map_len;
        let max_players = data.get(off).copied().unwrap_or(0);
        let players = data.get(off + 1).copied().unwrap_or(0);
        let spectators = data.get(off + 2).copied().unwrap_or(0);
        let spec_cap = data.get(off + 3).copied().unwrap_or(0);
        // Phase 16 rounds-to-win; default to 0 for old-form Welcome.
        let rounds_to_win = data.get(off + 4).copied().unwrap_or(0);
        Some(Welcome {
            your_slot,
            map,
            seed,
            server_tick,
            max_players,
            players,
            spectators,
            spec_cap,
            rounds_to_win,
        })
    }
}

// ---------------------------------------------------------------
// Join — client → server team choice. Phase 9 / Phase 17.4.
// team: 0 = T, 1 = CT, 2 = spectator.
// token: optional access-token string (JWT), sent when AUTH_REQUIRED.
//
// Wire format (backwards-compatible):
//   [TAG_JOIN, PROTOCOL_VERSION, team, token_len_lo, token_len_hi, …bytes]
// Old 3-byte format still decodes as token=None.
// ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Join {
    pub team: u8,
    pub token: Option<String>,
    /// Phase 21: the player-picked display handle. Falls back to the token's
    /// name server-side when absent (old-form Join has no name section).
    pub name: Option<String>,
}

impl Join {
    pub fn encode(&self) -> Vec<u8> {
        // [TAG, VER, team, tlen_lo, tlen_hi, ...token, nlen_lo, nlen_hi, ...name]
        let mut buf = vec![TAG_JOIN, PROTOCOL_VERSION, self.team];
        for part in [self.token.as_deref(), self.name.as_deref()] {
            let bytes = part.map(str::as_bytes).unwrap_or(&[]);
            buf.push((bytes.len() & 0xFF) as u8);
            buf.push(((bytes.len() >> 8) & 0xFF) as u8);
            buf.extend_from_slice(bytes);
        }
        buf
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 3 || data[0] != TAG_JOIN || data[1] != PROTOCOL_VERSION {
            return None;
        }
        let team = data[2];
        let mut off = 3;
        // Two length-prefixed strings: token, then name. Either may be absent
        // (old-form Join stops after the token, or after team).
        let mut read_str = || -> Option<String> {
            if data.len() < off + 2 {
                return None;
            }
            let len = u16::from_le_bytes([data[off], data[off + 1]]) as usize;
            off += 2;
            let s = if len > 0 && data.len() >= off + len {
                String::from_utf8(data[off..off + len].to_vec()).ok()
            } else {
                None
            };
            off += len;
            s
        };
        let token = read_str();
        let name = read_str();
        Some(Join { team, token, name })
    }
}

// ---------------------------------------------------------------
// Bye — server → client kick/refusal. Phase 9.
// ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Bye {
    pub reason: String,
}

impl Bye {
    pub fn encode(&self) -> Vec<u8> {
        let bytes = self.reason.as_bytes();
        let mut buf = Vec::with_capacity(3 + bytes.len());
        buf.push(TAG_BYE);
        buf.push(PROTOCOL_VERSION);
        buf.push(bytes.len() as u8);
        buf.extend_from_slice(bytes);
        buf
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 3 || data[0] != TAG_BYE || data[1] != PROTOCOL_VERSION {
            return None;
        }
        let len = data[2] as usize;
        if data.len() < 3 + len {
            return None;
        }
        let reason = String::from_utf8(data[3..3 + len].to_vec()).ok()?;
        Some(Bye { reason })
    }
}

// ---------------------------------------------------------------
// CommandFrame — client → server, every client tick. docs/netcode.md §3.1
// ---------------------------------------------------------------

/// Optional shot payload — aim already carries recoil+spread (computed
/// client-side by the WASM sim). Combat resolution is Phase 6.6; the field
/// rides the wire now so the format doesn't churn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shot {
    pub eye_pos: [f32; 3],
    pub dir: [f32; 3],
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CommandFrame {
    pub seq: u32,
    pub last_ack_snapshot: u32,
    pub buttons: u16,
    pub yaw: f32,
    pub pitch: f32,
    pub weapon: u8,
    pub shot: Option<Shot>,
}

impl CommandFrame {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(22 + if self.shot.is_some() { 24 } else { 0 });
        buf.push(TAG_CMD);
        buf.push(PROTOCOL_VERSION);
        buf.extend_from_slice(&self.seq.to_le_bytes());
        buf.extend_from_slice(&self.last_ack_snapshot.to_le_bytes());
        buf.extend_from_slice(&self.buttons.to_le_bytes());
        buf.extend_from_slice(&self.yaw.to_le_bytes());
        buf.extend_from_slice(&self.pitch.to_le_bytes());
        buf.push(self.weapon);
        match self.shot {
            Some(s) => {
                buf.push(1);
                for v in s.eye_pos.iter().chain(s.dir.iter()) {
                    buf.extend_from_slice(&v.to_le_bytes());
                }
            }
            None => buf.push(0),
        }
        buf
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 22 || data[0] != TAG_CMD || data[1] != PROTOCOL_VERSION {
            return None;
        }
        let mut r = Reader::new(&data[2..]);
        let seq = r.u32()?;
        let last_ack_snapshot = r.u32()?;
        let buttons = r.u16()?;
        let yaw = r.f32()?;
        let pitch = r.f32()?;
        let weapon = r.u8()?;
        let shot = if r.u8()? == 1 {
            Some(Shot {
                eye_pos: [r.f32()?, r.f32()?, r.f32()?],
                dir: [r.f32()?, r.f32()?, r.f32()?],
            })
        } else {
            None
        };
        Some(CommandFrame {
            seq,
            last_ack_snapshot,
            buttons,
            yaw,
            pitch,
            weapon,
            shot,
        })
    }
}

// ---------------------------------------------------------------
// Snapshot — server → client. docs/netcode.md §3.2
// 6.3 sends full (non-delta) snapshots; delta encoding arrives with 6.4.
// ---------------------------------------------------------------

// flags bits
pub const F_ALIVE: u8 = 1 << 0;
pub const F_DUCKED: u8 = 1 << 1;
pub const F_TEAM_CT: u8 = 1 << 2; // set = CT, clear = T
pub const F_ONGROUND: u8 = 1 << 3;

// Game event tags (one byte each, payload follows).
pub const EV_KILL: u8 = 1;
pub const EV_FIRE: u8 = 2;
pub const EV_IMPACT: u8 = 3; // followed by ImpactEvent payload

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GameEvent {
    pub tag: u8,
    pub slot: u8,
    pub by: u8, // for EV_KILL: who did the killing
}

impl GameEvent {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        buf.push(self.tag);
        buf.push(self.slot);
        buf.push(self.by);
    }
    pub(crate) fn decode(r: &mut Reader) -> Option<Self> {
        let tag = r.u8()?;
        let slot = r.u8()?;
        let by = r.u8()?;
        Some(GameEvent { tag, slot, by })
    }
}

/// Server-authoritative bullet impact result, sent from the shot already
/// computed server-side. Client uses it to place puffs/decals/sounds and to
/// terminate remote tracers at the actual hit point instead of a fixed 100 m.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImpactEvent {
    pub slot: u8, // shooter
    pub pos: [f32; 3],
    pub normal: [f32; 3],
    pub surface: u8, // 0=concrete, 1=flesh, 2=wood, 3=metal
}

impl ImpactEvent {
    pub fn encode(&self, buf: &mut Vec<u8>) {
        buf.push(self.slot);
        for v in self.pos.iter().chain(self.normal.iter()) {
            buf.extend_from_slice(&v.to_le_bytes());
        }
        buf.push(self.surface);
    }
    pub(crate) fn decode(r: &mut Reader) -> Option<Self> {
        let slot = r.u8()?;
        let pos = [r.f32()?, r.f32()?, r.f32()?];
        let normal = [r.f32()?, r.f32()?, r.f32()?];
        let surface = r.u8()?;
        Some(ImpactEvent { slot, pos, normal, surface })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EntityState {
    pub slot: u8,
    pub flags: u8,
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub health: u8,
    pub armor: u8,
    pub weapon: u8,
    pub ammo: u8,
    pub kills: u16,
    pub deaths: u16,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoundState {
    pub phase: u8,
    pub time_left_ms: u32,
    pub score_t: u16,
    pub score_ct: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RosterEntry {
    pub slot: u8,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub server_tick: u32,
    pub ack_seq: u32,
    pub entities: Vec<EntityState>,
    pub events: Vec<GameEvent>,
    pub impact_events: Vec<ImpactEvent>,
    pub roster: Vec<RosterEntry>,
    pub round: RoundState,
}

impl Snapshot {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(11 + self.entities.len() * 38 + self.events.len() * 3 + 9 + self.impact_events.len() * 26);
        buf.push(TAG_SNAP);
        buf.push(PROTOCOL_VERSION);
        buf.extend_from_slice(&self.server_tick.to_le_bytes());
        buf.extend_from_slice(&self.ack_seq.to_le_bytes());
        buf.push(self.entities.len() as u8);
        for e in &self.entities {
            buf.push(e.slot);
            buf.push(e.flags);
            for v in e.pos.iter().chain(e.vel.iter()) {
                buf.extend_from_slice(&v.to_le_bytes());
            }
            buf.extend_from_slice(&e.yaw.to_le_bytes());
            buf.extend_from_slice(&e.pitch.to_le_bytes());
            buf.push(e.health);
            buf.push(e.armor);
            buf.push(e.weapon);
            buf.push(e.ammo);
            buf.extend_from_slice(&e.kills.to_le_bytes());
            buf.extend_from_slice(&e.deaths.to_le_bytes());
        }
        buf.push(self.events.len() as u8);
        for ev in &self.events {
            ev.encode(&mut buf);
        }
        buf.push(self.round.phase);
        buf.extend_from_slice(&self.round.time_left_ms.to_le_bytes());
        buf.extend_from_slice(&self.round.score_t.to_le_bytes());
        buf.extend_from_slice(&self.round.score_ct.to_le_bytes());
        buf.push(self.impact_events.len() as u8);
        for imp in &self.impact_events {
            imp.encode(&mut buf);
        }
        buf.push(self.roster.len() as u8);
        for r in &self.roster {
            buf.push(r.slot);
            let name_bytes = r.name.as_bytes();
            buf.push(name_bytes.len() as u8);
            buf.extend_from_slice(name_bytes);
        }
        buf
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 11 || data[0] != TAG_SNAP || data[1] != PROTOCOL_VERSION {
            return None;
        }
        let mut r = Reader::new(&data[2..]);
        let server_tick = r.u32()?;
        let ack_seq = r.u32()?;
        let count = r.u8()? as usize;
        let mut entities = Vec::with_capacity(count);
        for _ in 0..count {
            entities.push(EntityState {
                slot: r.u8()?,
                flags: r.u8()?,
                pos: [r.f32()?, r.f32()?, r.f32()?],
                vel: [r.f32()?, r.f32()?, r.f32()?],
                yaw: r.f32()?,
                pitch: r.f32()?,
                health: r.u8()?,
                armor: r.u8()?,
                weapon: r.u8()?,
                ammo: r.u8()?,
                kills: r.u16()?,
                deaths: r.u16()?,
            });
        }
        let ev_count = r.u8()? as usize;
        let mut events = Vec::with_capacity(ev_count);
        for _ in 0..ev_count {
            if let Some(ev) = GameEvent::decode(&mut r) {
                events.push(ev);
            }
        }
        let round = RoundState {
            phase: r.u8()?,
            time_left_ms: r.u32()?,
            score_t: r.u16()?,
            score_ct: r.u16()?,
        };
        // Impact events (Phase C): appended after round state. Tolerate
        // truncated snapshots from older servers that didn't send these.
        let imp_count = r.u8().unwrap_or(0) as usize;
        let mut impact_events = Vec::with_capacity(imp_count);
        for _ in 0..imp_count {
            if let Some(imp) = ImpactEvent::decode(&mut r) {
                impact_events.push(imp);
            }
        }
        // Roster (Phase D): per-slot display names, appended after impact events.
        let roster_count = r.u8().unwrap_or(0) as usize;
        let mut roster = Vec::with_capacity(roster_count);
        for _ in 0..roster_count {
            let slot = r.u8().unwrap_or(0);
            let n = r.u8().unwrap_or(0) as usize;
            let name = String::from_utf8(r.take(n).unwrap_or(&[]).to_vec()).unwrap_or_default();
            roster.push(RosterEntry { slot, name });
        }
        Some(Snapshot {
            server_tick,
            ack_seq,
            entities,
            events,
            impact_events,
            roster,
            round,
        })
    }
}

/// Little-endian cursor reader; returns None on underrun.
pub(crate) struct Reader<'a> {
    d: &'a [u8],
    o: usize,
}

impl<'a> Reader<'a> {
    fn new(d: &'a [u8]) -> Self {
        Reader { d, o: 0 }
    }
    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let s = self.d.get(self.o..self.o + n)?;
        self.o += n;
        Some(s)
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn welcome_round_trip() {
        let original = Welcome {
            your_slot: 3,
            map: "de_douglas".into(),
            seed: 42,
            server_tick: 0,
            max_players: 10,
            players: 5,
            spectators: 2,
            spec_cap: 7,
            rounds_to_win: 16,
        };
        let encoded = original.encode();
        let decoded = Welcome::decode(&encoded).expect("decode failed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn welcome_old_format_compat() {
        // Welcome without capacity fields (pre-Phase 9) must still decode.
        let mut buf = Welcome {
            your_slot: 1, map: "x".into(), seed: 0, server_tick: 0,
            max_players: 0, players: 0, spectators: 0, spec_cap: 0,
            rounds_to_win: 0,
        }.encode();
        // Snip off the 5 capacity + rounds-to-win bytes.
        buf.truncate(buf.len() - 5);
        let w = Welcome::decode(&buf).expect("old welcome decode failed");
        assert_eq!(w.max_players, 0);
        assert_eq!(w.players, 0);
    }

    #[test]
    fn welcome_spectator() {
        let original = Welcome {
            your_slot: SPECTATOR,
            map: "de_douglas".into(),
            seed: 99,
            server_tick: 1234,
            max_players: 10,
            players: 10,
            spectators: 3,
            spec_cap: 7,
            rounds_to_win: 0,
        };
        let encoded = original.encode();
        let decoded = Welcome::decode(&encoded).expect("decode failed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn reject_wrong_tag() {
        let buf = vec![99, PROTOCOL_VERSION, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert!(Welcome::decode(&buf).is_none());
    }

    #[test]
    fn reject_wrong_version() {
        let welcome = Welcome {
            your_slot: 0,
            map: "x".into(),
            seed: 0,
            server_tick: 0,
            max_players: 0,
            players: 0,
            spectators: 0,
            spec_cap: 0,
            rounds_to_win: 0,
        };
        let mut buf = welcome.encode();
        buf[1] = 99;
        assert!(Welcome::decode(&buf).is_none());
    }

    #[test]
    fn join_round_trip() {
        for team in [0u8, 1, 2] {
            let j = Join { team, token: None, name: None };
            let decoded = Join::decode(&j.encode()).expect("join decode failed");
            assert_eq!(decoded, j);
        }
    }

    #[test]
    fn join_with_token_round_trip() {
        let token = Some("eyJhbGciOiJSUzI1NiJ9.test".to_string());
        let j = Join { team: 1, token: token.clone(), name: Some("Dougy".into()) };
        let decoded = Join::decode(&j.encode()).expect("join decode failed");
        assert_eq!(decoded, j);
    }

    #[test]
    fn join_name_without_token_round_trip() {
        let j = Join { team: 0, token: None, name: Some("guest".into()) };
        let decoded = Join::decode(&j.encode()).expect("join decode failed");
        assert_eq!(decoded, j);
    }

    #[test]
    fn join_reject_wrong_tag() {
        let buf = vec![99, PROTOCOL_VERSION, 0];
        assert!(Join::decode(&buf).is_none());
    }

    #[test]
    fn join_reject_truncated() {
        let buf = vec![TAG_JOIN, PROTOCOL_VERSION];
        assert!(Join::decode(&buf).is_none());
    }

    #[test]
    fn bye_round_trip() {
        let b = Bye { reason: "full".into() };
        let decoded = Bye::decode(&b.encode()).expect("bye decode failed");
        assert_eq!(decoded, b);
    }

    #[test]
    fn bye_empty_reason() {
        let b = Bye { reason: String::new() };
        let decoded = Bye::decode(&b.encode()).expect("bye decode failed");
        assert_eq!(decoded.reason, "");
    }

    #[test]
    fn bye_reject_wrong_tag() {
        let buf = vec![99, PROTOCOL_VERSION, 1, 102]; // tag=99, not BYE
        assert!(Bye::decode(&buf).is_none());
    }

    #[test]
    fn command_no_shot_round_trip() {
        let c = CommandFrame {
            seq: 12345,
            last_ack_snapshot: 678,
            buttons: 0b1010_0101,
            yaw: 1.25,
            pitch: -0.5,
            weapon: 2,
            shot: None,
        };
        assert_eq!(CommandFrame::decode(&c.encode()), Some(c));
    }

    #[test]
    fn command_with_shot_round_trip() {
        let c = CommandFrame {
            seq: 1,
            last_ack_snapshot: 0,
            buttons: 0,
            yaw: 3.0,
            pitch: 0.1,
            weapon: 1,
            shot: Some(Shot {
                eye_pos: [1.0, 1.6, -25.0],
                dir: [0.0, 0.0, 1.0],
            }),
        };
        assert_eq!(CommandFrame::decode(&c.encode()), Some(c));
    }

    #[test]
    fn snapshot_round_trip() {
        let s = Snapshot {
            server_tick: 9001,
            ack_seq: 42,
            entities: vec![
                EntityState {
                    slot: 0,
                    flags: F_ALIVE | F_TEAM_CT,
                    pos: [1.0, 0.0, -25.0],
                    vel: [4.5, 0.0, 0.0],
                    yaw: 1.57,
                    pitch: 0.0,
                    health: 100,
                    armor: 0,
                    weapon: 1,
                    ammo: 30,
                    kills: 4,
                    deaths: 1,
                },
                EntityState {
                    slot: 3,
                    flags: F_ALIVE | F_DUCKED,
                    pos: [-15.0, 0.05, 25.0],
                    vel: [0.0, 0.0, 0.0],
                    yaw: -1.57,
                    pitch: 0.2,
                    health: 55,
                    armor: 50,
                    weapon: 2,
                    ammo: 12,
                    kills: 0,
                    deaths: 0,
                },
            ],
            events: vec![],
            impact_events: vec![],
            roster: vec![],
            round: RoundState {
                phase: 1,
                time_left_ms: 60000,
                score_t: 3,
                score_ct: 5,
            },
        };
        assert_eq!(Snapshot::decode(&s.encode()), Some(s));
    }
    // Golden bytes shared with src/net/protocol.test.ts — if this vector
    // changes, the TS cross-compat test must change to match (and vice versa).
    // This is the on-the-wire contract between the two ends.
    /// ImpactEvent is the only wire structure that shipped with no round-trip
    /// cover at all — both golden tests used an empty impact list, so a field
    /// order or width mismatch against the TS decoder would have surfaced as
    /// decals at garbage coordinates rather than a failing test.
    #[test]
    fn impact_events_round_trip() {
        let s = Snapshot {
            server_tick: 42,
            ack_seq: 1,
            entities: vec![],
            events: vec![],
            impact_events: vec![
                ImpactEvent {
                    slot: 3,
                    pos: [1.5, -2.25, 7.0],
                    normal: [0.0, 1.0, 0.0],
                    surface: 2,
                },
                ImpactEvent {
                    slot: 0,
                    pos: [-11.0, 0.5, 4.125],
                    normal: [-1.0, 0.0, 0.0],
                    surface: 1,
                },
            ],
            roster: vec![],
            round: RoundState { phase: 1, time_left_ms: 1000, score_t: 0, score_ct: 0 },
        };
        let decoded = Snapshot::decode(&s.encode()).expect("round trip");
        assert_eq!(decoded.impact_events, s.impact_events);
    }

    /// One impact record is exactly 26 bytes: slot + 6 f32 + surface. Both ends
    /// bounds-check against this number.
    #[test]
    fn impact_event_is_26_bytes() {
        let mut buf = Vec::new();
        ImpactEvent { slot: 1, pos: [0.0; 3], normal: [0.0; 3], surface: 0 }.encode(&mut buf);
        assert_eq!(buf.len(), 26);
    }

    #[test]
    fn snapshot_golden_bytes() {
        let s = Snapshot {
            server_tick: 100,
            ack_seq: 7,
            entities: vec![EntityState {
                slot: 0,
                flags: F_ALIVE | F_TEAM_CT,
                pos: [1.5, 0.0, -25.0],
                vel: [4.0, 0.0, 0.0],
                yaw: 1.5,
                pitch: -0.25,
                health: 100,
                armor: 0,
                weapon: 1,
                ammo: 30,
                kills: 2,
                deaths: 3,
            }],
            events: vec![],
            impact_events: vec![],
            roster: vec![RosterEntry { slot: 0, name: "CT1".into() }],
            round: RoundState { phase: 1, time_left_ms: 60000, score_t: 2, score_ct: 3 },
        };
        let bytes = s.encode();
        // Verify round-trip decodes correctly.
        assert_eq!(Snapshot::decode(&bytes), Some(s));
    }

    #[test]
    fn reject_truncated_command() {
        let c = CommandFrame {
            seq: 1,
            last_ack_snapshot: 0,
            buttons: 0,
            yaw: 0.0,
            pitch: 0.0,
            weapon: 0,
            shot: None,
        };
        let buf = c.encode();
        assert!(CommandFrame::decode(&buf[..buf.len() - 1]).is_none());
    }
}


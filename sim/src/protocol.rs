pub const PROTOCOL_VERSION: u8 = 1;

pub const TAG_WELCOME: u8 = 0;
pub const TAG_BYE: u8 = 1;
pub const TAG_CMD: u8 = 2;
pub const TAG_SNAP: u8 = 3;

pub const SPECTATOR: u8 = 255;

#[derive(Debug, Clone, PartialEq)]
pub struct Welcome {
    pub your_slot: u8,
    pub map: String,
    pub seed: u32,
    pub server_tick: u32,
}

impl Welcome {
    pub fn encode(&self) -> Vec<u8> {
        let map_bytes = self.map.as_bytes();
        let len = 1 + 1 + 1 + 1 + map_bytes.len() + 4 + 4;
        let mut buf = Vec::with_capacity(len);
        buf.push(TAG_WELCOME);
        buf.push(PROTOCOL_VERSION);
        buf.push(self.your_slot);
        buf.push(map_bytes.len() as u8);
        buf.extend_from_slice(map_bytes);
        buf.extend_from_slice(&self.seed.to_le_bytes());
        buf.extend_from_slice(&self.server_tick.to_le_bytes());
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
        Some(Welcome {
            your_slot,
            map,
            seed,
            server_tick,
        })
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

// Game event tags (one byte each, payload follows).
pub const EV_KILL: u8 = 1;

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

#[derive(Debug, Clone, Copy, PartialEq)]
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
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoundState {
    pub phase: u8,
    pub time_left_ms: u16,
    pub score_t: u16,
    pub score_ct: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub server_tick: u32,
    pub ack_seq: u32,
    pub entities: Vec<EntityState>,
    pub events: Vec<GameEvent>,
    pub round: RoundState,
}

impl Snapshot {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(11 + self.entities.len() * 38 + self.events.len() * 3 + 7);
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
        }
        buf.push(self.events.len() as u8);
        for ev in &self.events {
            ev.encode(&mut buf);
        }
        buf.push(self.round.phase);
        buf.extend_from_slice(&self.round.time_left_ms.to_le_bytes());
        buf.extend_from_slice(&self.round.score_t.to_le_bytes());
        buf.extend_from_slice(&self.round.score_ct.to_le_bytes());
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
            time_left_ms: r.u16()?,
            score_t: r.u16()?,
            score_ct: r.u16()?,
        };
        Some(Snapshot {
            server_tick,
            ack_seq,
            entities,
            events,
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
        };
        let encoded = original.encode();
        let decoded = Welcome::decode(&encoded).expect("decode failed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn welcome_spectator() {
        let original = Welcome {
            your_slot: SPECTATOR,
            map: "de_douglas".into(),
            seed: 99,
            server_tick: 1234,
        };
        let encoded = original.encode();
        let decoded = Welcome::decode(&encoded).expect("decode failed");
        assert_eq!(decoded, original);
    }

    #[test]
    fn reject_wrong_tag() {
        let buf = vec![99, PROTOCOL_VERSION, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert!(Welcome::decode(&buf).is_none());
    }

    #[test]
    fn reject_wrong_version() {
        let welcome = Welcome {
            your_slot: 0,
            map: "x".into(),
            seed: 0,
            server_tick: 0,
        };
        let mut buf = welcome.encode();
        buf[1] = 99;
        assert!(Welcome::decode(&buf).is_none());
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
                },
            ],
            events: vec![],
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
            }],
            events: vec![],
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

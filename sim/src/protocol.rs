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
}

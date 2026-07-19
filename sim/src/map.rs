//! Loads the de_douglas layout (assets/maps/de_douglas.json) into a native
//! SimWorld. The client builds the SAME colliders in TypeScript from the SAME
//! JSON (src/game/map_douglas.ts) — one source of truth, so server and client
//! collision geometry can't drift. See docs/netcode.md §6.

use serde::Deserialize;

use crate::world::SimWorld;

#[derive(Deserialize)]
struct Box {
    c: [f64; 3],
    s: [f64; 3],
    #[serde(default)]
    ry: f64,
}

#[derive(Deserialize)]
struct Ramp {
    start: [f64; 3],
    end: [f64; 3],
    width: f64,
    thickness: f64,
}

#[derive(Deserialize)]
struct Spawns {
    #[serde(rename = "T")]
    t: [f64; 3],
    #[serde(rename = "CT")]
    ct: [f64; 3],
}

#[derive(Deserialize)]
struct Map {
    spawns: Spawns,
    boxes: Vec<Box>,
    #[serde(default)]
    ramps: Vec<Ramp>,
}

pub struct Spawn {
    pub t: [f64; 3],
    pub ct: [f64; 3],
}

/// Parse the de_douglas JSON and populate `world` with its colliders.
/// Returns the T/CT spawn points. Panics on malformed JSON (the map is a
/// committed build artifact — a parse failure is a build bug, not a runtime one).
pub fn load(world: &mut SimWorld, json: &str) -> Spawn {
    let map: Map = serde_json::from_str(json).expect("de_douglas.json parse");
    for b in &map.boxes {
        world.add_static_box(
            b.c[0], b.c[1], b.c[2],
            b.s[0] / 2.0, b.s[1] / 2.0, b.s[2] / 2.0,
            b.ry,
        );
    }
    for r in &map.ramps {
        world.add_ramp(
            r.start[0], r.start[1], r.start[2],
            r.end[0], r.end[1], r.end[2],
            r.width, r.thickness,
        );
    }
    Spawn {
        t: map.spawns.t,
        ct: map.spawns.ct,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_de_douglas() {
        let json = include_str!("../../assets/maps/de_douglas.json");
        let mut world = SimWorld::new();
        let spawn = load(&mut world, json);
        // T and CT spawn on opposite sides of z=0 (mirror-symmetric map).
        assert!(spawn.t[2] < 0.0 && spawn.ct[2] > 0.0);
    }
}

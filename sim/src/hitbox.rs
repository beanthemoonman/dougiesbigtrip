//! Per-bone hitboxes — port of src/game/hitbox.ts.
//!
//! Pure scalar math, no alloc after init. Matches the box-built player world-model
//! bone layout exactly so server and client see the same hit zones.
//! Phase E.3: moved into sim/ for shared combat authority.

use std::sync::LazyLock;

use crate::damage::Hitbox;

/// Visual model standing height (matches src/player/constants.ts:1.72).
pub const MODEL_HEIGHT: f64 = 1.72;

#[derive(Clone, Copy)]
struct Bone {
    zone: Hitbox,
    min: [f64; 3],
    max: [f64; 3],
}

fn build_bones() -> Vec<Bone> {
    // Raw Blender-space tuples: (zone, [cx, cy, cz], [sx, sy, sz]).
    // Copied 1:1 from build_characters.py. Symmetric limb pairs listed once per side.
    type Row = (Hitbox, [f64; 3], [f64; 3]);
    let mut rows: Vec<Row> = vec![
        (Hitbox::Stomach, [0.0, -0.02, 0.99], [0.34, 0.2, 0.16]), // pelvis
        (Hitbox::Stomach, [0.0, -0.02, 1.16], [0.36, 0.21, 0.2]), // abdomen
        (Hitbox::Chest,   [0.0, -0.02, 1.37], [0.42, 0.23, 0.24]), // chest
        (Hitbox::Chest,   [0.0,  0.09, 1.33], [0.4,  0.1,  0.34]), // vest
        (Hitbox::Head,    [0.0, -0.02, 1.53], [0.11, 0.11, 0.08]), // neck
        (Hitbox::Head,    [0.0, -0.01, 1.64], [0.19, 0.21, 0.22]), // head
        (Hitbox::Head,    [0.0, -0.01, 1.71], [0.22, 0.24, 0.13]), // helmet
    ];
    const LEG_X: f64 = 0.13; // LEG_X from build_characters.py
    for sx in [-1.0_f64, 1.0_f64] {
        let x = LEG_X * sx;
        rows.push((Hitbox::Leg, [x, 0.05, 0.045], [0.12, 0.28, 0.09])); // foot
        rows.push((Hitbox::Leg, [x, -0.02, 0.3],  [0.13, 0.15, 0.45])); // shin
        rows.push((Hitbox::Leg, [x, -0.02, 0.72], [0.15, 0.18, 0.42])); // thigh
        rows.push((Hitbox::Chest, [0.27 * sx, -0.02, 1.44], [0.16, 0.2, 0.16])); // shoulder
        rows.push((Hitbox::Arm, [0.27 * sx, -0.02, 1.24], [0.13, 0.14, 0.3]));  // upper arm
        rows.push((Hitbox::Arm, [0.265 * sx, -0.02, 0.99], [0.11, 0.12, 0.28])); // lower arm
        rows.push((Hitbox::Arm, [0.255 * sx, -0.02, 0.82], [0.1, 0.11, 0.12])); // hand
    }

    rows.into_iter()
        .map(|(zone, [cx, cy, cz], [sx, sy, sz])| {
            // Blender (x,y,z) → three.js (x, z, -y). Extents stay axis-aligned.
            let tcx = cx;
            let tcy = cz;
            let tcz = -cy;
            let hx = sx / 2.0;
            let hy = sz / 2.0;
            let hz = sy / 2.0;
            Bone {
                zone,
                min: [tcx - hx, tcy - hy, tcz - hz],
                max: [tcx + hx, tcy + hy, tcz + hz],
            }
        })
        .collect()
}

static BONES: LazyLock<Vec<Bone>> = LazyLock::new(build_bones);

/// Height-band fallback for edge clips that graze the collider but miss every bone.
/// `scale_y` squashes for crouch duck (1 = standing).
pub fn hitbox_at(feet_y: f64, hit_y: f64, scale_y: f64) -> Hitbox {
    let frac = (hit_y - feet_y) / (MODEL_HEIGHT * scale_y);
    if frac >= 0.88 {
        Hitbox::Head
    } else if frac >= 0.66 {
        Hitbox::Chest
    } else if frac >= 0.45 {
        Hitbox::Stomach
    } else {
        Hitbox::Leg
    }
}

const EPS: f64 = 1e-9;

#[inline]
fn axis_clip(o: f64, d: f64, mn: f64, mx: f64, tmin: &mut f64, tmax: &mut f64) -> bool {
    if d.abs() < EPS {
        return o >= mn && o <= mx;
    }
    let inv = 1.0 / d;
    let mut t1 = (mn - o) * inv;
    let mut t2 = (mx - o) * inv;
    if t1 > t2 {
        (t1, t2) = (t2, t1);
    }
    if t1 > *tmin {
        *tmin = t1;
    }
    if t2 < *tmax {
        *tmax = t2;
    }
    *tmin <= *tmax
}

fn slab(
    ox: f64, oy: f64, oz: f64,
    dx: f64, dy: f64, dz: f64,
    min: &[f64; 3], max: &[f64; 3],
) -> Option<f64> {
    let mut tmin = 0.0_f64;
    let mut tmax = f64::INFINITY;
    if !axis_clip(ox, dx, min[0], max[0], &mut tmin, &mut tmax) { return None; }
    if !axis_clip(oy, dy, min[1], max[1], &mut tmin, &mut tmax) { return None; }
    if !axis_clip(oz, dz, min[2], max[2], &mut tmin, &mut tmax) { return None; }
    Some(tmin)
}

/// Precise hit zone for a world-space ray against a bot at feet `(px, py, pz)` with
/// body yaw `yaw`. Transforms the ray into body-local space and slab-tests every bone
/// box, returning the zone of the nearest one entered, or None.
pub fn hitbox_ray(
    ox: f64, oy: f64, oz: f64,
    dx: f64, dy: f64, dz: f64,
    px: f64, py: f64, pz: f64,
    yaw: f64,
    scale_y: f64,
) -> Option<Hitbox> {
    let rx = ox - px;
    let ry = oy - py;
    let rz = oz - pz;
    let c = (-yaw).cos();
    let s = (-yaw).sin();
    let lox = rx * c + rz * s;
    let loy = ry / scale_y;
    let loz = -rx * s + rz * c;
    let ldx = dx * c + dz * s;
    let ldy = dy / scale_y;
    let ldz = -dx * s + dz * c;

    let mut best_t = f64::INFINITY;
    let mut best: Option<Hitbox> = None;
    for b in BONES.iter() {
        if let Some(t) = slab(lox, loy, loz, ldx, ldy, ldz, &b.min, &b.max) {
            if t < best_t {
                best_t = t;
                best = Some(b.zone);
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bones_loaded() {
        assert!(BONES.len() == 21);
    }

    #[test]
    fn headshot_from_above() {
        // Straight down from above feet, looking at head top.
        let zone = hitbox_ray(
            0.0, 2.5, 0.02,
            0.0, -1.0, 0.0,
            0.0, 0.0, 0.0,
            0.0, 1.0,
        );
        assert_eq!(zone, Some(Hitbox::Head));
    }

    #[test]
    fn chest_shot_straight_on() {
        // At chest center height 1.37, 3m away, looking at torso.
        let zone = hitbox_ray(
            0.0, 1.37, -3.0,
            0.0, 0.0, 1.0,
            0.0, 0.0, 0.0,
            0.0, 1.0,
        );
        assert_eq!(zone, Some(Hitbox::Chest));
    }

    #[test]
    fn leg_shot_low() {
        let zone = hitbox_ray(
            0.1, 0.5, -3.0,
            0.0, 0.0, 1.0,
            0.0, 0.0, 0.0,
            0.0, 1.0,
        );
        assert_eq!(zone, Some(Hitbox::Leg));
    }

    #[test]
    fn miss_above_head() {
        let zone = hitbox_ray(
            0.0, 3.0, -3.0,
            0.0, 0.0, 1.0,
            0.0, 0.0, 0.0,
            0.0, 1.0,
        );
        assert_eq!(zone, None);
    }

    #[test]
    fn hitbox_at_bands() {
        assert_eq!(hitbox_at(0.0, 1.65, 1.0), Hitbox::Head);   // 1.65/1.72 ≈ 0.96
        assert_eq!(hitbox_at(0.0, 1.30, 1.0), Hitbox::Chest);  // 1.30/1.72 ≈ 0.76
        assert_eq!(hitbox_at(0.0, 1.00, 1.0), Hitbox::Stomach); // 1.00/1.72 ≈ 0.58
        assert_eq!(hitbox_at(0.0, 0.50, 1.0), Hitbox::Leg);    // 0.50/1.72 ≈ 0.29
    }
}

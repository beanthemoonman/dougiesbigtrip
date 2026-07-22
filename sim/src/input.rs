/// Buttons bitmask and wish-direction-from-buttons — mirrors src/core/input.ts.
/// Pure math, no DOM/I/O. This is the sim-side input layer.

pub struct Buttons;

impl Buttons {
    pub const FORWARD: u16 = 1 << 0;
    pub const BACK: u16 = 1 << 1;
    pub const LEFT: u16 = 1 << 2;
    pub const RIGHT: u16 = 1 << 3;
    pub const JUMP: u16 = 1 << 4;
    pub const DUCK: u16 = 1 << 5;
    pub const ATTACK: u16 = 1 << 6;
    pub const RELOAD: u16 = 1 << 7;
    pub const WALK: u16 = 1 << 8;
}

/// World-space, normalised, horizontal wish direction from held buttons and yaw.
/// Returns (x, z); y is always 0 — movement code owns vertical velocity.
pub fn wish_dir_from_buttons(buttons: u16, yaw: f64) -> (f64, f64) {
    let mut forward: i32 = 0;
    let mut right: i32 = 0;
    if buttons & Buttons::FORWARD != 0 {
        forward += 1;
    }
    if buttons & Buttons::BACK != 0 {
        forward -= 1;
    }
    if buttons & Buttons::RIGHT != 0 {
        right += 1;
    }
    if buttons & Buttons::LEFT != 0 {
        right -= 1;
    }

    if forward == 0 && right == 0 {
        return (0.0, 0.0);
    }

    let sin_yaw = yaw.sin();
    let cos_yaw = yaw.cos();
    // Forward in world space is (-sin(yaw), -cos(yaw)) for a camera whose yaw=0 looks down -Z.
    let x = (forward as f64) * (-sin_yaw) + (right as f64) * cos_yaw;
    let z = (forward as f64) * (-cos_yaw) + (right as f64) * (-sin_yaw);

    let len = (x * x + z * z).sqrt();
    if len > 0.0 {
        (x / len, z / len)
    } else {
        (0.0, 0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_buttons_returns_zero() {
        let (x, z) = wish_dir_from_buttons(0, 0.0);
        assert_eq!(x, 0.0);
        assert_eq!(z, 0.0);
    }

    #[test]
    fn forward_only_is_unit_length() {
        let (x, z) = wish_dir_from_buttons(Buttons::FORWARD, 0.0);
        let len = (x * x + z * z).sqrt();
        assert!((len - 1.0).abs() < 1e-10);
    }

    #[test]
    fn opposite_buttons_cancel() {
        let buttons = Buttons::FORWARD | Buttons::BACK;
        let (x, z) = wish_dir_from_buttons(buttons, 0.0);
        assert_eq!(x, 0.0);
        assert_eq!(z, 0.0);
    }
}

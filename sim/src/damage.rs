//! Damage model — port of src/game/damage.ts.
//!
//! Final damage = base × range-falloff × hitbox-multiplier, then split across
//! armour and health by the weapon's armour penetration.
//! Pure functions, no alloc. Phase E.3.

/// Per-bone zone for hit detection and damage multipliers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hitbox {
    Head,
    Chest,
    Stomach,
    Arm,
    Leg,
}

impl Hitbox {
    /// Multiplier per docs/weapon-feel.md §6.
    pub fn mult(self) -> f64 {
        match self {
            Hitbox::Head => 4.0,
            Hitbox::Chest => 1.0,
            Hitbox::Stomach => 1.25,
            Hitbox::Arm => 1.0,
            Hitbox::Leg => 0.75,
        }
    }
}

/// Minimal weapon stats that `compute_damage` needs.
/// Bots use the rifle profile (see `WEAPON_RIFLE`).
pub struct WeaponStats {
    pub damage: f64,
    pub armor_pen: f64,
    pub falloff_coef: f64,
}

/// Rifle stats matching src/weapons/defs.ts:WEAPONS.rifle.
pub const WEAPON_RIFLE: WeaponStats = WeaponStats {
    damage: 36.0,
    armor_pen: 0.775,
    falloff_coef: 0.98,
};

/// Pistol stats matching src/weapons/defs.ts:WEAPONS.pistol.
pub const WEAPON_PISTOL: WeaponStats = WeaponStats {
    damage: 35.0,
    armor_pen: 0.5,
    falloff_coef: 0.75,
};

/// Damage dealt to health and damage absorbed by armour.
#[derive(Debug, Clone, Copy)]
pub struct DamageResult {
    pub health: f64,
    pub armor: f64,
}

/// Docs/weapon-feel.md §6: damage × pow(falloffCoef, dist_m / 5).
pub fn range_falloff(weapon: &WeaponStats, distance_m: f64) -> f64 {
    weapon.falloff_coef.powf(distance_m / 5.0)
}

/// Compute final damage after range falloff, hitbox multiplier, and armour.
/// `target_armor` is a u8 (HP units) and may be fully or partially consumed.
pub fn compute_damage(
    weapon: &WeaponStats,
    distance_m: f64,
    hitbox: Hitbox,
    target_armor: u8,
) -> DamageResult {
    let incoming = weapon.damage * range_falloff(weapon, distance_m) * hitbox.mult();
    let ta = target_armor as f64;
    if ta <= 0.0 {
        return DamageResult { health: incoming, armor: 0.0 };
    }
    let through_armor = incoming * weapon.armor_pen;
    let want_absorb = incoming - through_armor;
    let absorbed = want_absorb.min(ta);
    let overflow = want_absorb - absorbed;
    DamageResult {
        health: through_armor + overflow,
        armor: absorbed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipliers() {
        assert_eq!(Hitbox::Head.mult(), 4.0);
        assert_eq!(Hitbox::Chest.mult(), 1.0);
        assert_eq!(Hitbox::Stomach.mult(), 1.25);
        assert_eq!(Hitbox::Arm.mult(), 1.0);
        assert_eq!(Hitbox::Leg.mult(), 0.75);
    }

    #[test]
    fn point_blank_chest_no_armor() {
        let d = compute_damage(&WEAPON_RIFLE, 0.0, Hitbox::Chest, 0);
        assert!((d.health - 36.0).abs() < 0.01);
        assert_eq!(d.armor, 0.0);
    }

    #[test]
    fn point_blank_headshot_no_armor() {
        let d = compute_damage(&WEAPON_RIFLE, 0.0, Hitbox::Head, 0);
        assert!((d.health - 144.0).abs() < 0.01); // 36 * 4
    }

    #[test]
    fn falloff_at_20m() {
        // falloff = 0.98 ^ (20/5) = 0.98^4 ≈ 0.922368
        let d = compute_damage(&WEAPON_RIFLE, 20.0, Hitbox::Chest, 0);
        let expected = 36.0 * 0.98_f64.powf(4.0);
        assert!((d.health - expected).abs() < 0.1);
    }

    #[test]
    fn armor_absorbs() {
        // Rifle: 77.5% pierces, 22.5% absorbed
        let d = compute_damage(&WEAPON_RIFLE, 0.0, Hitbox::Chest, 100);
        let incoming = 36.0;
        let through = incoming * 0.775; // 27.9
        let absorbed = incoming - through; // 8.1
        assert!((d.health - through).abs() < 0.01);
        assert!((d.armor - absorbed).abs() < 0.01);
    }

    #[test]
    fn armor_exhausted() {
        // Only 5 armor — can absorb at most 5 of the 8.1, rest overflows to health
        let d = compute_damage(&WEAPON_RIFLE, 0.0, Hitbox::Chest, 5);
        let incoming = 36.0;
        let through = incoming * 0.775; // 27.9
        let want_absorb = incoming - through; // 8.1
        assert!((d.armor - 5.0).abs() < 0.01);
        assert!((d.health - (through + (want_absorb - 5.0))).abs() < 0.01);
    }
}

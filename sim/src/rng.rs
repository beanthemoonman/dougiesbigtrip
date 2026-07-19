/// Seeded RNG — the ONLY source of randomness allowed in the sim.
/// mulberry32: fast, tiny, good enough for a spread disc; not cryptographic.
/// Injected everywhere so simulate(trace, {seed}) twice is identical.
///
/// ponytail: mulberry32, not PCG/xoshiro. Swap only if the spread pattern ever
/// shows visible structure on a wall — it won't at this scale.

pub struct Rng {
    a: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self { a: seed }
    }

    /// Next float in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        let mut a: u32 = self.a as u32;
        a = a.wrapping_add(0x6d2b79f5);
        let mut t: u32 = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = (t ^ (t >> 7)).wrapping_mul(61 | t);
        t ^= t >> 14;
        self.a = self.a.wrapping_add(0x6d2b79f5);
        (t as f64) / 4_294_967_296.0
    }

    /// Next float in [min, max).
    pub fn next_range(&mut self, min: f64, max: f64) -> f64 {
        min + self.next_f64() * (max - min)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_rng_deterministic() {
        let mut a = Rng::new(12345);
        let mut b = Rng::new(12345);
        for _ in 0..100 {
            assert_eq!(a.next_f64(), b.next_f64());
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = Rng::new(1);
        let mut b = Rng::new(2);
        assert_ne!(a.next_f64(), b.next_f64());
    }
}

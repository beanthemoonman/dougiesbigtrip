import { describe, it, expect } from 'vitest';
import { WEAPONS } from '../weapons/defs';
import { computeDamage, rangeFalloff, HITBOX_MULT } from './damage';

describe('damage model', () => {
  it('point-blank chest, no armour = base damage', () => {
    const r = computeDamage(WEAPONS.rifle, 0, 'chest', 0);
    expect(r.health).toBeCloseTo(WEAPONS.rifle.damage, 5);
    expect(r.armor).toBe(0);
  });

  it('headshot is 4× chest at the same range', () => {
    const head = computeDamage(WEAPONS.rifle, 10, 'head', 0).health;
    const chest = computeDamage(WEAPONS.rifle, 10, 'chest', 0).health;
    expect(head).toBeCloseTo(chest * HITBOX_MULT.head, 5);
  });

  it('falloff decays with distance and never grows', () => {
    expect(rangeFalloff(WEAPONS.rifle, 0)).toBe(1);
    expect(rangeFalloff(WEAPONS.rifle, 40)).toBeLessThan(1);
    expect(rangeFalloff(WEAPONS.pistol, 40)).toBeLessThan(rangeFalloff(WEAPONS.rifle, 40));
  });

  it('armour absorbs part of the hit and bleeds armorPen through to health', () => {
    const r = computeDamage(WEAPONS.rifle, 0, 'chest', 100);
    const incoming = WEAPONS.rifle.damage;
    expect(r.health).toBeCloseTo(incoming * WEAPONS.rifle.armorPen, 5);
    expect(r.armor).toBeCloseTo(incoming * (1 - WEAPONS.rifle.armorPen), 5);
    // total damage dealt (health + armour absorbed) is conserved
    expect(r.health + r.armor).toBeCloseTo(incoming, 5);
  });

  it('when armour runs out mid-hit, the remainder falls through to health', () => {
    const r = computeDamage(WEAPONS.rifle, 0, 'head', 1); // big hit, tiny armour
    expect(r.armor).toBe(1); // all available armour consumed
    const incoming = WEAPONS.rifle.damage * HITBOX_MULT.head;
    expect(r.health).toBeCloseTo(incoming - 1, 5); // everything else to health
  });
});

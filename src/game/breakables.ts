/**
 * Breakable props (crates, barrels). Phase 4.5 "must not become clip/collision
 * hazards": when a prop breaks we remove BOTH its mesh and its static collider,
 * so nothing is left as an invisible box to bump into or stand on. Anything
 * resting on it breaks too (cascade), so you can't shoot the bottom crate of a
 * stack and leave the top one floating mid-air — the exit-test requirement.
 *
 * This module is the pure part: hp accounting + the support cascade. The three.js
 * mesh removal and Rapier collider disabling live in main.ts, keyed off the
 * indices returned here.
 *
 * ponytail: props don't fall, they vanish. Real physics-dropped debris needs
 * dynamic bodies (physics/world.ts, a later phase); vanish satisfies "break and
 * can't be stood on" with no dynamic-body plumbing.
 */
export interface Breakable {
  hp: number;
  broken: boolean;
  /** Index of the prop this one rests on, or null if it sits on the floor. */
  restsOn: number | null;
}

/**
 * Apply `dmg` to prop `i`. If its hp drops to 0 it breaks, and every prop
 * (transitively) resting on it breaks with it. Returns the indices that broke
 * this call, in break order; empty if the prop survived or was already gone.
 * Mutates `props[*].hp`/`broken`.
 */
export function damageProp(props: readonly (Breakable | null)[], i: number, dmg: number): number[] {
  const first = props[i];
  if (!first || first.broken) return [];
  first.hp -= dmg;
  if (first.hp > 0) return [];

  const broke: number[] = [];
  const queue = [i]; // BFS the support graph; children break unconditionally
  for (let q = 0; q < queue.length; q++) {
    const j = queue[q];
    if (j === undefined) continue;
    const p = props[j];
    if (!p || p.broken) continue;
    p.broken = true;
    broke.push(j);
    for (let k = 0; k < props.length; k++) {
      if (props[k]?.restsOn === j) queue.push(k);
    }
  }
  return broke;
}

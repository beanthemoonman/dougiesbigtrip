/**
 * T0 — key rebinding (Phase 19.3).
 *
 * The map is module-level mutable state, so each test restores what it took.
 */
import { describe, it, expect } from 'vitest';
import { Buttons, rebindAction, getBinding } from './input';

describe('rebindAction', () => {
  it('replaces every code bound to the action', () => {
    // Forward ships bound to both KeyW and ArrowUp.
    expect(getBinding(Buttons.FORWARD)).toEqual(['ArrowUp', 'KeyW']);
    rebindAction(Buttons.FORWARD, 'KeyI');
    expect(getBinding(Buttons.FORWARD)).toEqual(['KeyI']);
    rebindAction(Buttons.FORWARD, 'KeyW');
  });

  it('reports the action a stolen key was taken from, and unbinds it', () => {
    const stolen = rebindAction(Buttons.JUMP, 'KeyR'); // KeyR is Reload
    expect(stolen).toBe(Buttons.RELOAD);
    expect(getBinding(Buttons.RELOAD)).toEqual([]);
    rebindAction(Buttons.RELOAD, 'KeyR');
    rebindAction(Buttons.JUMP, 'Space');
  });

  it('reports nothing when the key was free or already the action’s own', () => {
    expect(rebindAction(Buttons.RELOAD, 'KeyR')).toBe(0); // re-bind to itself
    expect(rebindAction(Buttons.RELOAD, 'F13')).toBe(0); // unbound key
    rebindAction(Buttons.RELOAD, 'KeyR');
  });
});

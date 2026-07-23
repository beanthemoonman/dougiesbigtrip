/**
 * Screen state machine — four states, no router library, no history API.
 * Pointer lock is released when any screen is visible and restored on
 * entering in-game.
 *
 * Phase 19.1 — entry-point for the entry/settings/admin/in-game shell.
 */

export type ScreenId = 'entry' | 'settings' | 'admin' | 'in-game';

export interface ScreenManager {
  current: ScreenId;
  previous: ScreenId;
  show(id: ScreenId): void;
  /** Return to in-game (release screen overlays, re-lock pointer). */
  enterGame(canvas: HTMLElement): void;
  isActive(id: ScreenId): boolean;
  onBeforeShow(cb: (id: ScreenId) => void): void;
  onBeforeHide(cb: (id: ScreenId) => void): void;
}

export function createScreenManager(_canvas: HTMLElement): ScreenManager {
  let _current: ScreenId = 'in-game';
  let _previous: ScreenId = 'in-game';
  let _onBeforeShow: ((id: ScreenId) => void)[] = [];
  let _onBeforeHide: ((id: ScreenId) => void)[] = [];

  return {
    get current(): ScreenId {
      return _current;
    },

    get previous(): ScreenId {
      return _previous;
    },

    show(id: ScreenId): void {
      for (const cb of _onBeforeHide) cb(_current);
      _previous = _current;
      _current = id;
      for (const cb of _onBeforeShow) cb(id);
      document.exitPointerLock();
    },

    enterGame(canvas: HTMLElement): void {
      for (const cb of _onBeforeHide) cb(_current);
      _current = 'in-game';
      for (const cb of _onBeforeShow) cb('in-game');
      canvas.requestPointerLock();
    },

    isActive(id: ScreenId): boolean {
      return _current === id;
    },

    onBeforeShow(cb: (id: ScreenId) => void): void {
      _onBeforeShow.push(cb);
    },

    onBeforeHide(cb: (id: ScreenId) => void): void {
      _onBeforeHide.push(cb);
    },
  };
}

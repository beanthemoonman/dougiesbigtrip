/**
 * Keyboard/mouse -> wishdir bitmask + look delta, and pointer lock lifecycle.
 * Movement code (Phase 1) reads `InputState.buttons` and `wishdir`/`yaw`/`pitch`
 * every tick; this module only produces those values, it does not interpret them.
 */

export const Buttons = {
  FORWARD: 1 << 0,
  BACK: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  JUMP: 1 << 4,
  DUCK: 1 << 5,
  ATTACK: 1 << 6,
  RELOAD: 1 << 7,
  WALK: 1 << 8,
} as const;

const KEY_TO_BUTTON: Record<string, number> = {
  KeyW: Buttons.FORWARD,
  ArrowUp: Buttons.FORWARD,
  KeyS: Buttons.BACK,
  ArrowDown: Buttons.BACK,
  KeyA: Buttons.LEFT,
  ArrowLeft: Buttons.LEFT,
  KeyD: Buttons.RIGHT,
  ArrowRight: Buttons.RIGHT,
  Space: Buttons.JUMP,
  ControlLeft: Buttons.DUCK,
  ControlRight: Buttons.DUCK,
  KeyR: Buttons.RELOAD,
  ShiftLeft: Buttons.WALK,
  ShiftRight: Buttons.WALK,
};

const PITCH_LIMIT = Math.PI / 2 - 0.01;

export interface InputState {
  /** Bitmask of currently held movement buttons, see `Buttons`. */
  buttons: number;
  /** Yaw in radians, wraps freely. */
  yaw: number;
  /** Pitch in radians, clamped to +-~89.4 degrees. */
  pitch: number;
  /** Mouse sensitivity, radians per pixel. */
  sensitivity: number;
  pointerLocked: boolean;
  /** Weapon slot requested since last read (1 = rifle, 2 = pistol), or 0.
   * A latched edge, not a held state — main.ts consumes it and resets to 0. */
  weaponSlot: number;
  /** Held while Tab is pressed; toggles the scoreboard overlay. */
  scoreboard: boolean;
  /** Latched edge: set to 1 when M is pressed (team-menu request). Caller clears after handling. */
  teamMenuToggle: number;
}

export interface InputManager {
  state: InputState;
}

export function createInputManager(target: HTMLElement): InputManager {
  const state: InputState = {
    buttons: 0,
    yaw: 0,
    pitch: 0,
    sensitivity: 0.0022,
    pointerLocked: false,
    weaponSlot: 0,
    scoreboard: false,
    teamMenuToggle: 0,
  };

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (document.pointerLockElement === target) state.scoreboard = true;
      return;
    }
    if (e.code === 'Digit1') state.weaponSlot = 1;
    else if (e.code === 'Digit2') state.weaponSlot = 2;
    else if (e.code === 'KeyM' && document.pointerLockElement === target) state.teamMenuToggle = 1;
    const bit = KEY_TO_BUTTON[e.code];
    if (bit !== undefined) state.buttons |= bit;
    // When pointer-locked the game owns the keyboard. Swallow every keydown so
    // no browser shortcut fires — Ctrl+W (close tab), Ctrl+T (new tab),
    // Ctrl+D (bookmark), Ctrl+N (new window), Ctrl+H (history), etc. The
    // per-key check was too narrow; browsers handle many more shortcuts than
    // we have game binds.
    if (document.pointerLockElement === target) {
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Tab') { state.scoreboard = false; return; }
    const bit = KEY_TO_BUTTON[e.code];
    if (bit !== undefined) state.buttons &= ~bit;
  }

  function onMouseMove(e: MouseEvent): void {
    if (document.pointerLockElement !== target) return;
    state.yaw -= e.movementX * state.sensitivity;
    state.pitch -= e.movementY * state.sensitivity;
    if (state.pitch > PITCH_LIMIT) state.pitch = PITCH_LIMIT;
    if (state.pitch < -PITCH_LIMIT) state.pitch = -PITCH_LIMIT;
  }

  function onPointerLockChange(): void {
    const locked = document.pointerLockElement === target;
    state.pointerLocked = locked;
    if (!locked) {
      state.buttons = 0;
      state.scoreboard = false;
      state.teamMenuToggle = 0;
    }
  }

  // Only once locked, so the click that *engages* pointer lock doesn't also
  // fire a shot into the floor.
  function onMouseDown(e: MouseEvent): void {
    if (document.pointerLockElement !== target) return;
    if (e.button === 0) state.buttons |= Buttons.ATTACK;
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) state.buttons &= ~Buttons.ATTACK;
  }

  function onClick(): void {
    if (document.pointerLockElement !== target) target.requestPointerLock();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  target.addEventListener('click', onClick);

  return { state };
}

/**
 * World-space, normalised, horizontal wish direction from held buttons and yaw.
 * Returns [x, z]; y is always 0 — movement code owns vertical velocity.
 */
export function wishDirFromButtons(buttons: number, yaw: number): [number, number] {
  let forward = 0;
  let right = 0;
  if (buttons & Buttons.FORWARD) forward += 1;
  if (buttons & Buttons.BACK) forward -= 1;
  if (buttons & Buttons.RIGHT) right += 1;
  if (buttons & Buttons.LEFT) right -= 1;

  if (forward === 0 && right === 0) return [0, 0];

  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  // Forward in world space is (-sin(yaw), -cos(yaw)) for a camera whose yaw=0 looks down -Z.
  let x = forward * -sinYaw + right * cosYaw;
  let z = forward * -cosYaw + right * -sinYaw;

  const len = Math.hypot(x, z);
  if (len > 0) {
    x /= len;
    z /= len;
  }
  return [x, z];
}

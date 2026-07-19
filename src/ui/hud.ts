/**
 * HUD — plain DOM overlay (no React for a crosshair, per CLAUDE.md).
 *
 * The only non-trivial part is the crosshair: its gap is driven by the *same*
 * inaccuracy value the bullet's spread disc uses (weapons/spread.ts), projected
 * onto the screen. That coupling is the point — the crosshair is a readout of
 * the accuracy model, not a decoration tuned to look about right.
 */
import type { WeaponDef } from '../weapons/defs';

/** Below this the four lines merge into a dot and stop reading as a gap. */
export const MIN_GAP_PX = 3;

/**
 * Screen-space radius (px) of a `spreadRad` cone, i.e. how far off-centre a
 * bullet at the edge of the spread disc can land.
 *
 * The projection: half the viewport height subtends half the vertical FOV, so a
 * ray at angle θ off-centre lands at `(h/2) · tan(θ) / tan(vFov/2)` px.
 */
export function crosshairGapPx(spreadRad: number, vFovRad: number, viewportHeightPx: number): number {
  const px = ((viewportHeightPx / 2) * Math.tan(spreadRad)) / Math.tan(vFovRad / 2);
  return Math.max(MIN_GAP_PX, px);
}

export interface HudState {
  health: number;
  armor: number;
  weapon: WeaponDef;
  ammo: number;
  reloading: boolean;
  /** Current inaccuracy in radians — from weapons/spread.ts `computeSpread`. */
  spreadRad: number;
  /** 1-based round number. */
  round: number;
  /** Score, T : CT. */
  score: { t: number; ct: number };
  /** Centre banner text (freezetime / round result). Empty = hidden. */
  banner: string;
}

export interface Hud {
  update(state: HudState, vFovRad: number, viewportHeightPx: number): void;
}

const CSS = `
.hud { position: fixed; inset: 0; pointer-events: none; font: 600 28px/1 system-ui, sans-serif;
  color: #dfe3e6; text-shadow: 0 2px 3px rgba(0,0,0,.9); user-select: none; }
.hud-left { position: absolute; left: 28px; bottom: 22px; display: flex; gap: 26px; }
.hud-right { position: absolute; right: 28px; bottom: 22px; }
.hud-label { font-size: 15px; font-weight: 400; opacity: .65; margin-right: 6px; }
.hud-reloading { opacity: .55; }
.hud-cross { position: absolute; left: 50%; top: 50%; }
.hud-cross i { position: absolute; background: #4de04d; box-shadow: 0 0 2px rgba(0,0,0,.8); }
.hud-cross .v { width: 2px; height: var(--len); left: -1px; }
.hud-cross .h { height: 2px; width: var(--len); top: -1px; }
.hud-cross .up { bottom: var(--gap); }
.hud-cross .down { top: var(--gap); }
.hud-cross .left { right: var(--gap); }
.hud-cross .right { left: var(--gap); }
.hud-top { position: absolute; left: 50%; top: 16px; transform: translateX(-50%);
  text-align: center; }
.hud-score { font-size: 22px; letter-spacing: 1px; }
.hud-score b { color: #4de04d; }
.hud-round { font-size: 13px; font-weight: 400; opacity: .6; margin-top: 3px; }
.hud-banner { position: absolute; left: 50%; top: 64px; transform: translateX(-50%);
  font-size: 34px; letter-spacing: 2px; white-space: nowrap; }
.hud-banner:empty { display: none; }
`;

/** Builds the overlay under `root`. Call `update` once per rendered frame. */
export function createHud(root: HTMLElement): Hud {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <div class="hud-left">
      <span><span class="hud-label">HP</span><span data-hud="health"></span></span>
      <span><span class="hud-label">AP</span><span data-hud="armor"></span></span>
    </div>
    <div class="hud-right" data-hud="ammoBox">
      <span data-hud="ammo"></span><span class="hud-label" data-hud="weapon"></span>
    </div>
    <div class="hud-cross" style="--len: 7px; --gap: ${MIN_GAP_PX}px">
      <i class="v up"></i><i class="v down"></i><i class="h left"></i><i class="h right"></i>
    </div>
    <div class="hud-top">
      <div class="hud-score"><span data-hud="scoreT"></span> : <span data-hud="scoreCt"></span></div>
      <div class="hud-round">ROUND <span data-hud="round"></span></div>
    </div>
    <div class="hud-banner" data-hud="banner"></div>`;
  root.appendChild(el);

  const find = (selector: string): HTMLElement => {
    const node = el.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`hud: missing element ${selector}`);
    return node;
  };
  const health = find('[data-hud="health"]');
  const armor = find('[data-hud="armor"]');
  const ammo = find('[data-hud="ammo"]');
  const ammoBox = find('[data-hud="ammoBox"]');
  const weapon = find('[data-hud="weapon"]');
  const cross = find('.hud-cross');
  const scoreT = find('[data-hud="scoreT"]');
  const scoreCt = find('[data-hud="scoreCt"]');
  const round = find('[data-hud="round"]');
  const banner = find('[data-hud="banner"]');

  // ponytail: write every frame, no dirty-checking. These are ~5 textContent
  // assignments against unchanged strings — the DOM ignores them and it never
  // showed up next to a 400-draw-call scene. Diff it if a profile says so.
  return {
    update(state, vFovRad, viewportHeightPx): void {
      health.textContent = String(Math.max(0, Math.round(state.health)));
      armor.textContent = String(Math.max(0, Math.round(state.armor)));
      ammo.textContent = `${state.ammo} / ${state.weapon.mag}`;
      weapon.textContent = state.weapon.name;
      ammoBox.classList.toggle('hud-reloading', state.reloading);
      cross.style.setProperty('--gap', `${crosshairGapPx(state.spreadRad, vFovRad, viewportHeightPx).toFixed(1)}px`);
      scoreT.textContent = String(state.score.t);
      scoreCt.textContent = String(state.score.ct);
      round.textContent = String(state.round);
      banner.textContent = state.banner;
    },
  };
}

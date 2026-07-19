// Full-screen loading overlay with a real progress bar. Progress is honest:
// step(label) is called as each discrete async boot stage *completes*, so the
// bar reflects work actually done, not a timer. done() fades it out.
//
// ponytail: step-granular, not byte-granular. Wiring a shared three.LoadingManager
// through every loader (lightmap/props/weapons) plus the raw physics/nav fetches
// would buy sub-step smoothness nobody watching a ~1 s boot will notice. If a
// slow asset ever dominates, give that one step a sub-progress callback then.

export interface LoadingScreen {
  /** Mark a boot stage finished and advance the bar. `label` names what's next. */
  step(label: string): void;
  /** Fade out and remove. */
  done(): void;
}

export function createLoadingScreen(parent: HTMLElement, totalSteps: number): LoadingScreen {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:18px;background:#0b0e12;color:#c7d0da;' +
    "font:600 14px/1.4 system-ui,sans-serif;letter-spacing:.5px;transition:opacity .4s;";

  const title = document.createElement('div');
  title.textContent = 'COUNTER DOUGLAS GLOBAL OFFENSIVE';
  title.style.cssText = 'font-size:18px;letter-spacing:2px;color:#e6edf3;';

  const track = document.createElement('div');
  track.style.cssText = 'width:min(340px,60vw);height:6px;border-radius:3px;background:#1c232c;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:#5a9bd4;transition:width .2s ease-out;';
  track.appendChild(fill);

  const label = document.createElement('div');
  label.textContent = 'Loading…';
  label.style.cssText = 'opacity:.7;font-weight:400;';

  root.append(title, track, label);
  parent.appendChild(root);

  let done = 0;
  return {
    step(next: string): void {
      done = Math.min(done + 1, totalSteps);
      fill.style.width = `${(done / totalSteps) * 100}%`;
      label.textContent = next;
    },
    done(): void {
      fill.style.width = '100%';
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 400);
    },
  };
}

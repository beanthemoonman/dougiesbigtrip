/**
 * Entry point = the menu shell. Boots the renderer, input, auth, and the
 * entry/settings/admin screens — and nothing else. The game world only exists
 * on a game boot (?bots=&rounds= from Singleplayer, ?connect= from
 * Multi-player), where game/session.ts is dynamic-imported and started; a
 * fresh URL is the main-menu state and never builds the world. "Exit to Menu"
 * reloads to a clean URL, which is the whole teardown story.
 */

import { resumeAudio, setMasterVolume } from './core/audio';
import { initAuth, type AuthState } from './core/auth';
import { createInputManager } from './core/input';
import { DEFAULT_SERVER_ADDRESS, DEFAULT_SETTINGS } from './core/settings';
import { LIMITS } from './game/round';
import { createRenderContext } from './render/renderer';
import { createScreenManager } from './ui/screens';
import { createEntryScreen, type EntryScreen } from './ui/entry';
import { createSettingsScreen, type SettingsScreen } from './ui/settings_screen';
import { createAdminScreen, type AdminScreen } from './ui/admin';

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
  if (!canvas) throw new Error('missing #viewport canvas');

  const renderCtx = createRenderContext(canvas);
  const input = createInputManager(canvas);
  // AudioContext starts suspended until a user gesture — the same click that
  // engages pointer lock unlocks audio (core/audio.ts).
  canvas.addEventListener('click', resumeAudio);

  // Phase 17.3: fire-and-forget auth init — the rest of startup does not depend
  // on it.  When it resolves, the entry screen's user menu updates.
  let auth: AuthState | null = null;
  void initAuth().then((a) => {
    auth = a;
    entryScreen.setAuth(a);
  });

  // Settings (sensitivity / world FOV / volume). The config object is the source
  // of truth; the settings screen mutates it and pushes each value live.
  const settings = { ...DEFAULT_SETTINGS };
  function applySettings(): void {
    input.state.sensitivity = settings.sensitivity;
    renderCtx.setWorldFov(settings.worldFovDeg);
    setMasterVolume(settings.volume);
  }
  applySettings();

  // Phase 19 screen state machine — governs entry/settings/admin/in-game.
  // Boots in 'entry': the main menu is the state you open the site into, not
  // an overlay painted over a game that never started.
  const screens = createScreenManager();

  // Phase 19.2 entry screen. SP/MP both launch via a page reload with URL
  // params — the URL is the source of truth for what boots.
  // connectViaReload is defined below; we pass it via a mutable ref.
  const mpConnect: { fn: ((url: string, name: string) => void) | null } = { fn: null };
  const entryScreen: EntryScreen = createEntryScreen({
    onSettings: () => screens.show('settings'),
    onAdmin: () => screens.show('admin'),
    sp: {
      botCountMin: LIMITS.botCount[0],
      botCountMax: LIMITS.botCount[1],
      roundsMin: LIMITS.roundsToWin[0],
      roundsMax: LIMITS.roundsToWin[1],
      onStart(bots, rounds): void {
        const u = new URL(location.href);
        u.searchParams.set('bots', String(bots));
        u.searchParams.set('rounds', String(rounds));
        u.searchParams.delete('connect');
        location.href = u.toString();
      },
    },
    mp: {
      defaultAddress: DEFAULT_SERVER_ADDRESS,
      defaultPort: '9876',
      onConnect(url: string, name: string): void {
        mpConnect.fn?.(url, name);
      },
    },
  });

  // Phase 19.3 settings screen (three tabs).
  const settingsScreen: SettingsScreen = createSettingsScreen({
    settings,
    onChange: applySettings,
    onBack(): void {
      // Back to in-game must re-lock the pointer (show() alone won't).
      if (screens.previous === 'in-game') screens.enterGame(canvas);
      else screens.show(screens.previous);
    },
  });

  // Phase 20.2 admin screen (created early so auth can gate it).
  const adminScreen: AdminScreen = createAdminScreen({
    apiBase: location.origin,
    token: () => auth?.token(),
    onBack: () => screens.show('entry'),
  });

  // The Multi-player Connect button reloads the page with ?connect= so the game
  // boots straight into networked mode against that server — the URL is the
  // source of truth for "am I connected", not an optimistic label. But probe the
  // address first with a throwaway socket: only reload once it actually opens,
  // so an unreachable server shows "connection failed" here instead of booting
  // into a broken networked session.
  function connectViaReload(url: string, name: string): void {
    let done = false;
    let probe: WebSocket;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      probe.close();
      if (!ok) return;
      const params = new URLSearchParams(location.search);
      params.set('connect', url);
      params.set('name', name);
      location.search = params.toString();
    };
    try {
      probe = new WebSocket(url);
    } catch {
      return;
    }
    const timer = setTimeout(() => finish(false), 4000);
    probe.onopen = () => finish(true);
    probe.onerror = () => finish(false);
    probe.onclose = () => finish(false);
  }
  mpConnect.fn = connectViaReload;

  // Phase 16.4: only ws:// and wss:// URLs are valid ?connect= targets. Null
  // means "no usable ?connect=" — a rejected scheme is never dialled.
  const bootUrl = new URLSearchParams(location.search).get('connect');
  let validatedBootUrl: string | null = null;
  if (bootUrl) {
    try {
      const u = new URL(bootUrl);
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
        console.warn(`ignoring ?connect= with non-ws scheme: ${u.protocol}`);
      } else {
        validatedBootUrl = bootUrl;
      }
    } catch { /* malformed ?connect= — fall back to the menu */ }
  }

  // Phase 19: screens govern visibility — exactly one shell overlay per screen;
  // in-game shows none. (The pause overlay is session-owned; game/session.ts
  // registers its own hook.)
  screens.onBeforeShow((id) => {
    entryScreen.hide();
    settingsScreen.hide();
    adminScreen.hide();
    if (id === 'entry') entryScreen.show();
    else if (id === 'settings') settingsScreen.show();
    else if (id === 'admin') adminScreen.show();
  });

  // P/Escape backs out of the settings screen to wherever it was opened from
  // (entry / pause). The in-game pause branches live in game/session.ts.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyP' && e.code !== 'Escape') return;
    if (screens.isActive('settings')) {
      e.preventDefault();
      if (screens.previous === 'in-game') screens.enterGame(canvas);
      else screens.show(screens.previous);
    }
  });

  // --- The fork: menu state or game state, decided by the URL. ---
  const params = new URLSearchParams(location.search);
  const isFreshBoot = !validatedBootUrl && !params.has('bots') && !params.has('rounds');
  if (isFreshBoot) {
    // Main menu: no physics, no map, no loop. The world is built by the
    // reload that Singleplayer/Multi-player trigger.
    screens.show('entry');
    return;
  }

  // Game boot: pull in the world + loop (a separate chunk — the menu never
  // downloads it) and hand it the shell.
  const { startGameSession } = await import('./game/session');
  await startGameSession({
    canvas,
    renderCtx,
    input,
    screens,
    auth: () => auth,
    validatedBootUrl,
  });
}

void main();

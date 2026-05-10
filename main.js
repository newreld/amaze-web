// AMAZE — bootstrap.  Sizes the canvas, wires the menu, runs the GameScene.

import { Difficulty, LevelStyles } from './maze.js';
import { GameScene }               from './game.js';

const canvas        = document.getElementById('game');
const menu          = document.getElementById('menu');
const installEl     = document.getElementById('install-hint');
const topbar        = document.getElementById('game-topbar');
const acornCounter  = document.getElementById('acorn-counter');
const winModal      = document.getElementById('win-modal');
const winAcorns     = document.getElementById('win-acorns');
const winTagline    = document.getElementById('win-tagline');
const settingsOverlay  = document.getElementById('settings-overlay');
const toggleCollectibles = document.getElementById('toggle-collectibles');

let scene = null;

// ----- Settings -----------------------------------------------------------
// Persisted in localStorage so toggles survive reloads/SW updates.

const settings = {
  // Default ON — collectibles + star ratings on by default for new users.
  collectibles: localStorage.getItem('amaze.collectibles') !== 'false',
};

function saveSettings() {
  localStorage.setItem('amaze.collectibles', String(settings.collectibles));
}

toggleCollectibles.checked = settings.collectibles;
toggleCollectibles.addEventListener('change', () => {
  settings.collectibles = toggleCollectibles.checked;
  saveSettings();
  if (scene) scene.setShowCollectibles(settings.collectibles);
  updateAcornCounter();
});

function openSettings()  { settingsOverlay.classList.remove('hidden'); }
function closeSettings() { settingsOverlay.classList.add('hidden'); }

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-menu-settings').addEventListener('click', openSettings);
document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
// Tap the dim backdrop (anywhere outside the frame) to close as well.
settingsOverlay.addEventListener('click', (ev) => {
  if (ev.target === settingsOverlay) closeSettings();
});

// ----- HTML acorn counter (driven by GameScene callbacks) -----------------
function updateAcornCounter() {
  const cs = scene?.collectibles ?? [];
  if (!settings.collectibles || cs.length === 0) {
    acornCounter.classList.add('hidden');
    return;
  }
  acornCounter.classList.remove('hidden');
  acornCounter.innerHTML = cs
    .map(c => `<span class="acorn${c.picked ? '' : ' dim'}">🌰</span>`)
    .join('');
}

// Body background is the warm sun gradient defined in style.css — same
// across menu, game, and modals.  We no longer mutate it from JS as the
// theme cycles, so this used to be `applyTheme(MENU_THEME)` and is now a
// no-op (kept here as a stub in case we want per-theme tints later).

// ----- Canvas DPR sizing ---------------------------------------------------
// Read the canvas's ACTUAL rendered size (set by CSS via 100vw/100dvh) and
// match the backing-store size to it × devicePixelRatio.  This is the only
// way to stay correct on iOS Safari, where window.innerHeight can lie when
// the URL bar shows/hides — getBoundingClientRect always tells the truth.
function resizeCanvas() {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w    = rect.width;
  const h    = rect.height;
  if (w === 0 || h === 0) return;
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
resizeCanvas();

// ResizeObserver fires for every layout change to the canvas — rotation,
// URL-bar collapse, software keyboard, split-view resizing on iPadOS.
// Falling back to `resize` covers older browsers without the observer.
const ro = ('ResizeObserver' in window) ? new ResizeObserver(handleResize) : null;
if (ro) ro.observe(canvas);
else window.addEventListener('resize', handleResize);

function handleResize() {
  const prevW = canvas.width, prevH = canvas.height;
  resizeCanvas();
  if (canvas.width === prevW && canvas.height === prevH) return;
  // Rebuild the live scene for the new size.  Cheap (re-runs Prim's, but
  // the maze is small) and avoids stale cell-size math.
  if (scene) {
    const diff = scene.diff;
    const idx  = scene.styleIdx;
    scene.destroy();
    scene = null;
    startGame(diff, idx);
  }
}

// ----- Scene transitions ---------------------------------------------------
function backToMenu() {
  if (!scene) return;
  scene.destroy();
  scene = null;
  topbar.classList.add('hidden');
  acornCounter.classList.add('hidden');
  winModal.classList.add('hidden');
  menu.classList.remove('hidden');
}

function startGame(difficulty, styleIndex = 0) {
  menu.classList.add('hidden');
  topbar.classList.remove('hidden');
  scene = new GameScene(canvas, difficulty, {
    styleIndex,
    showCollectibles:     settings.collectibles,
    onCollectiblesUpdate: updateAcornCounter,
    onWin:                showWinModal,
  });
  updateAcornCounter();
}

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.difficulty;
    startGame(Difficulty[id]);
  });
});

document.getElementById('btn-menu').addEventListener('click', backToMenu);
document.getElementById('btn-restart').addEventListener('click', () => {
  if (!scene) return;
  winModal.classList.add('hidden');
  scene.restart();
  updateAcornCounter();
});

// ----- Win modal ----------------------------------------------------------
const WIN_TAGLINES = {
  3: 'You navigated the woods like a pro.',
  2: 'Almost a forest legend!',
  1: 'Solid path-finding.',
  0: 'You made it through. Try the acorns next time!',
  off: 'Trail blazed.  On to the next forest!',
};

function showWinModal() {
  if (!scene) return;
  const cs       = scene.collectibles;
  const earned   = cs.filter(c => c.picked).length;
  const total    = cs.length;
  if (total > 0) {
    winAcorns.style.display = '';
    winAcorns.innerHTML = cs
      .map(c => `<span${c.picked ? '' : ' class="dim"'}>🌰</span>`)
      .join('');
    winTagline.textContent = WIN_TAGLINES[earned] ?? WIN_TAGLINES[0];
  } else {
    winAcorns.style.display = 'none';
    winTagline.textContent = WIN_TAGLINES.off;
  }
  winModal.classList.remove('hidden');
}

document.getElementById('btn-win-home').addEventListener('click', () => {
  winModal.classList.add('hidden');
  backToMenu();
});

document.getElementById('btn-win-again').addEventListener('click', () => {
  if (!scene) return;
  winModal.classList.add('hidden');
  scene.nextMaze();           // cycles theme + new maze
  updateAcornCounter();
});

// ----- Service worker (offline cache) -------------------------------------
// SKIP on localhost — the cache-first SW intercepts file changes during dev
// iteration and is more pain than it's worth.  Anywhere else (GitHub Pages,
// custom domain), register normally so the PWA install path & offline work.
const isLocalDev = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocalDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('SW registration failed:', err));
  });
} else if ('serviceWorker' in navigator && isLocalDev) {
  // Belt-and-suspenders: if a previous page-load already registered the SW,
  // tear it down so cached assets stop interfering.
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {});
  caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
}

// ----- Install hint (iOS Safari only) -------------------------------------
// iOS doesn't fire `beforeinstallprompt`, so we detect Mobile Safari and
// show a one-shot hint.  Suppressed once the user dismisses or once it's
// clearly running standalone.
const isIOS       = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  navigator.standalone === true;

if (isIOS && !isStandalone && !localStorage.getItem('amaze.installHintDismissed')) {
  installEl.classList.remove('hidden');
  document.getElementById('dismiss-hint').addEventListener('click', () => {
    installEl.classList.add('hidden');
    localStorage.setItem('amaze.installHintDismissed', '1');
  });
}

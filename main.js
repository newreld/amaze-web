// AMAZE — bootstrap.  Sizes the canvas, wires the menu, runs the GameScene.

import { Difficulty, LevelStyles } from './maze.js';
import { GameScene }               from './game.js';

const canvas    = document.getElementById('game');
const menu      = document.getElementById('menu');
const installEl = document.getElementById('install-hint');

let scene = null;

/** Sync the page background + theme-color meta with whichever palette is
 *  currently in view.  Keeps the strip behind the iOS status bar in step
 *  with the rest of the UI when scenes change. */
function applyTheme(style) {
  const bg = style.backgroundColor;
  document.documentElement.style.backgroundColor = bg;
  document.body.style.backgroundColor          = bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

const MENU_THEME = LevelStyles[0];   // Enchanted Forest, used by MenuScene
applyTheme(MENU_THEME);

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
function startGame(difficulty, styleIndex = 0) {
  menu.classList.add('hidden');
  scene = new GameScene(canvas, difficulty, {
    styleIndex,
    onBackToMenu: () => {
      scene.destroy();
      scene = null;
      menu.classList.remove('hidden');
      applyTheme(MENU_THEME);   // restore menu palette behind status bar
    },
  });
}

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.difficulty;
    startGame(Difficulty[id]);
  });
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

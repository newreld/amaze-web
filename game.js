// AMAZE — game scene: sprite-based maze rendering, drag input, trail, win.
// Mirrors GameScene.swift.

import { Maze, LevelStyles } from './maze.js';

// ---- tunables (mirror Swift constants) ------------------------------------
// "Reference" values tuned for iPad-sized cells (~56 px).  Actual per-frame
// values are derived from cellSize in _buildLayout so smaller mobile cells
// get proportionally thinner walls and a smaller cursor head.
const REF_WALL_WIDTH    = 14;
const REF_HEAD_RADIUS   = 14;
const REF_CELL_SIZE     = 56;     // wallW/headR hit their cap at this cellSize
const TRAIL_DURATION_MS = 2500;
const SUBSAMPLE_DIST    = 5;
const MAX_FOOTSTEPS     = 800;    // bumped — denser dotted trail = more dots

// Picked once per maze for the start-cell marker.  Forest-themed so it
// matches the painterly bark/leaf vibe.
const START_EMOJIS = [
  '🐢', '🐇', '🦊', '🐻', '🦝', '🦔', '🐿️', '🦌',
  '🐹', '🐭', '🦉', '🐦', '🐸', '🦋', '🐛', '🦡',
];

// Reserved header strip at the top of the viewport for the menu button (and
// any future UI).  The maze is laid out below this band so its top row
// can't slide under the button.
const HEADER_HEIGHT     = 72;

// Padding around the maze inside the viewport.  Scales with viewport so the
// hard maze (13×19) doesn't get squeezed on phones / tall iPads.
function viewportPadding(cw, ch) {
  return Math.max(12, Math.min(40, Math.min(cw, ch) * 0.04));
}

// iOS safe-area-inset-top — the strip behind the OS clock/notch.  Set as a
// CSS variable in style.css so we can read it in JS via getComputedStyle.
function safeAreaTop() {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--safe-top').trim();
  return parseFloat(v) || 0;
}
function safeAreaBottom() {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--safe-bottom').trim();
  return parseFloat(v) || 0;
}

// ---- direction helper (local copy) ---------------------------------------
function dirNameFromOffset(dc, dr) {
  if (dc === 0 && dr ===  1) return 'top';
  if (dc === 0 && dr === -1) return 'bottom';
  if (dc ===  1 && dr === 0) return 'right';
  if (dc === -1 && dr === 0) return 'left';
  return null;
}

// ---- branch sprite catalog ------------------------------------------------
const TRUNK_NAMES = ['branch_trunk_1', 'branch_trunk_2'];
const DROOD_NAMES = ['branch_drood_1', 'branch_drood_2'];

// Lazy-loaded HTMLImageElements keyed by name.
const imageCache = new Map();
function loadImage(name) {
  if (imageCache.has(name)) return imageCache.get(name);
  const img = new Image();
  img.src = `assets/${name}.png`;
  const promise = new Promise((res, rej) => {
    img.onload  = () => res(img);
    img.onerror = rej;
  });
  imageCache.set(name, promise);
  return promise;
}

/**
 * Pre-tinted offscreen canvas of `image` blended toward `tintCss`.  Mirrors
 * SpriteKit's colorBlendFactor formula:
 *     final = (1 - factor) * texture + factor * tintColor   (alpha preserved)
 *
 * Using `source-atop` + globalAlpha gets exactly that blend in 2D Canvas.
 */
function tintedSprite(image, tintCss, blendFactor) {
  const c = document.createElement('canvas');
  c.width  = image.naturalWidth;
  c.height = image.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha   = blendFactor;
  ctx.fillStyle     = tintCss;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---- main GameScene class -------------------------------------------------

export class GameScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{columns:number, rows:number, id:string}} difficulty
   * @param {{onBackToMenu?: () => void, styleIndex?: number}} [opts]
   */
  constructor(canvas, difficulty, opts = {}) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.diff      = difficulty;
    this.styleIdx  = opts.styleIndex ?? 0;
    this.onBack    = opts.onBackToMenu ?? (() => {});

    this.timed     = [];          // {x,y,t} subsampled drag points (for trail)
    this.foots     = [];          // {x,y} permanent footstep dots
    this.lastFoot  = null;
    this.cursor    = { visible: false, x: 0, y: 0 };

    this.currentCell  = null;
    this.lastResolved = { x: 0, y: 0 };
    this.isDrawing    = false;

    this._winFlash = null;
    this._alive    = true;        // gates the rAF loop on destroy()
    this._rafId    = 0;

    this._buildLayout();
    this._installInputHandlers();

    this._applyGlobalTheme();
    Promise.all([...TRUNK_NAMES, ...DROOD_NAMES].map(loadImage))
      .then(() => this._buildMaze())
      .then(() => { this._rafId = requestAnimationFrame(this._tick); });
  }

  /** Sync the document-level background + theme-color meta with the current
   *  theme so the iOS status-bar area (which shows the body, not the
   *  canvas) recolors when the maze cycles to a new palette.  Without this,
   *  the strip behind the OS clock stays the menu's first-theme cream. */
  _applyGlobalTheme() {
    const bg = this.style.backgroundColor;
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor          = bg;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
  }

  destroy() {
    this._alive = false;
    cancelAnimationFrame(this._rafId);
    this._removeInputHandlers?.();
  }

  get style() { return LevelStyles[this.styleIdx % LevelStyles.length]; }

  // ----- Layout / sizing -----

  _buildLayout() {
    const cw = this.canvas.width  / devicePixelRatio;
    const ch = this.canvas.height / devicePixelRatio;

    // Difficulty grids are authored portrait (rows > columns).  In a
    // landscape viewport, transpose so the wide axis becomes "columns"
    // and the maze actually fills the screen instead of leaving big
    // horizontal gutters.
    const isLandscape = cw > ch;
    const baseCols = this.diff.columns;
    const baseRows = this.diff.rows;
    const cols = isLandscape ? baseRows : baseCols;
    const rows = isLandscape ? baseCols : baseRows;
    this._gridCols = cols;
    this._gridRows = rows;

    // The iOS status bar (clock / battery) sits in the safe-area-top
    // strip.  We need the menu button to start BELOW that strip, and we
    // also have to reserve enough room for the maze underneath.
    const safeTop    = safeAreaTop();
    const safeBottom = safeAreaBottom();
    this._headerTop  = safeTop;                     // y where header starts
    this._headerBot  = safeTop + HEADER_HEIGHT;     // y where maze can start

    const pad    = viewportPadding(cw, ch);
    const availW = cw - pad * 2;
    // Available height excludes the reserved header strip + safe areas so
    // the maze sits between the menu button and the home-indicator zone.
    const availH = ch - this._headerBot - pad - safeBottom;
    this.cellSize = Math.min(availW / cols, availH / rows);
    const mw = this.cellSize * cols;
    const mh = this.cellSize * rows;
    this.origin = {
      x: (cw - mw) / 2,
      y: this._headerBot + (availH - mh) / 2,
    };
    this.size   = { w: cw, h: ch };

    // Scale wall thickness and cursor head with cellSize, capped at the
    // iPad-tuned reference values so big cells stay slender and small
    // mobile cells don't get drowned in 14 px walls.  Floor of 3/4 keeps
    // sprites/markers visible at the smallest viewports.
    const scale       = Math.min(1, this.cellSize / REF_CELL_SIZE);
    this._wallW       = Math.max(3, REF_WALL_WIDTH  * scale);
    this._headR       = Math.max(4, REF_HEAD_RADIUS * scale);

    // Footsteps form a dense, opaque dotted trail.  Both the dot radius
    // and the spacing between dots scale with the cursor radius so the
    // dotted texture reads similarly across difficulties / viewports.
    this._footR       = Math.max(1.5, this._headR * 0.18);
    this._footSpacing = Math.max(6,   this._headR * 0.65);
  }

  // ----- Maze (logic + rendering layer) -----

  /** Pick a random pair of OPPOSITE corners to use as start/end so each
   *  level gives the longest possible solution path.  Also pick a random
   *  animal emoji to mark the start. */
  _pickEndpoints() {
    const cols = this._gridCols, rows = this._gridRows;
    const corners = [
      { col: 0,        row: 0        },  // 0: BL
      { col: cols - 1, row: 0        },  // 1: BR
      { col: 0,        row: rows - 1 },  // 2: TL
      { col: cols - 1, row: rows - 1 },  // 3: TR
    ];
    const startIdx = (Math.random() * 4) | 0;
    // Opposite corners pair (0,3) and (1,2) — index XOR-3 gives the opposite.
    const endIdx   = 3 - startIdx;
    this.startCell = corners[startIdx];
    this.endCell   = corners[endIdx];
    this.startEmoji = START_EMOJIS[(Math.random() * START_EMOJIS.length) | 0];
  }

  async _buildMaze() {
    this._pickEndpoints();
    const columns = this._gridCols;
    const rows    = this._gridRows;
    this.maze = new Maze(columns, rows);

    // One offscreen canvas with all walls baked in (analog of SpriteKit's
    // single sprite-from-bitmap).  Game loop just blits it each frame.
    const off = document.createElement('canvas');
    off.width  = this.size.w * devicePixelRatio;
    off.height = this.size.h * devicePixelRatio;
    const oc = off.getContext('2d');
    oc.scale(devicePixelRatio, devicePixelRatio);

    // Step 1: enumerate every wall as integer-corner pairs.
    const walls = [];
    for (let col = 0; col < columns; col++) {
      for (let row = 0; row < rows; row++) {
        if (row < rows - 1 && !this.maze.hasPassage(col, row, 'top')) {
          walls.push([[col, row + 1], [col + 1, row + 1]]);
        }
        if (col < columns - 1 && !this.maze.hasPassage(col, row, 'right')) {
          walls.push([[col + 1, row + 1], [col + 1, row]]);
        }
      }
    }
    for (let col = 0; col < columns; col++) {
      walls.push([[col, rows], [col + 1, rows]]);
      walls.push([[col, 0],    [col + 1, 0]]);
    }
    for (let row = 0; row < rows; row++) {
      walls.push([[0,        row], [0,        row + 1]]);
      walls.push([[columns,  row], [columns,  row + 1]]);
    }

    // Step 2: count walls per corner — endpoints with count 1 are exposed.
    const cornerKey = c => c[0] * 10000 + c[1];
    const counts = new Map();
    for (const [a, b] of walls) {
      counts.set(cornerKey(a), (counts.get(cornerKey(a)) || 0) + 1);
      counts.set(cornerKey(b), (counts.get(cornerKey(b)) || 0) + 1);
    }

    // Step 3: pre-tint sprite catalog for the current theme.
    const tint = this.style.wallTint;
    const trunks = await Promise.all(TRUNK_NAMES.map(async n =>
      tintedSprite(await loadImage(n), tint, 0.35)));
    const droods = await Promise.all(DROOD_NAMES.map(async n =>
      tintedSprite(await loadImage(n), tint, 0.35)));
    const pick = arr => arr[(Math.random() * arr.length) | 0];

    // Step 4: place each wall sprite onto the offscreen canvas.
    for (const [a, b] of walls) {
      const aExposed = counts.get(cornerKey(a)) === 1;
      const bExposed = counts.get(cornerKey(b)) === 1;
      const isEnd    = aExposed || bExposed;

      let sprite, leafyAtB;
      if (isEnd) {
        sprite   = pick(droods);
        leafyAtB = (aExposed && bExposed) ? Math.random() < 0.5 : bExposed;
      } else {
        sprite   = pick(trunks);
        leafyAtB = Math.random() < 0.5;   // visually irrelevant for trunks
      }
      const aw = this._cornerPoint(a);
      const bw = this._cornerPoint(b);
      this._drawWallSprite(oc, aw, bw, sprite, leafyAtB);
    }

    this.mazeCanvas = off;
  }

  // Maze coords have row=0 at the BOTTOM (matches SpriteKit Y-up).  Canvas
  // Y goes down, so flip when converting to canvas pixels.
  _cornerPoint([col, row]) {
    return {
      x: this.origin.x + col * this.cellSize,
      y: this.origin.y + (this._gridRows - row) * this.cellSize,
    };
  }

  _drawWallSprite(ctx, a, b, sprite, leafyAtB) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;

    const angle   = Math.atan2(dy, dx) - Math.PI / 2;
    const overlap = this._wallW * 1.4;
    const targetH = len + overlap;
    const targetW = this._wallW * 1.8;
    const flipX   = Math.random() < 0.5 ? -1 : 1;
    // Canvas2D has Y-down and `drawImage` puts source y=0 (texture top, the
    // leafy end) at the sprite's local -Y.  After the rotation aligning
    // local +Y with a→b, the leafy end therefore lands at endpoint a by
    // default — the OPPOSITE of SpriteKit's Y-up behaviour.  Invert to keep
    // the same `leafyAtB` semantics: the leafy growth lands at b iff true.
    const flipY   = leafyAtB ? -1 : 1;

    ctx.save();
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(angle);
    ctx.scale(flipX, flipY);
    ctx.drawImage(sprite, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }

  // ----- Game loop -----

  _tick = (now) => {
    if (!this._alive) return;
    this._expirePoints(now);
    this._draw(now);
    this._rafId = requestAnimationFrame(this._tick);
  };

  _expirePoints(now) {
    const cutoff = now - TRAIL_DURATION_MS;
    let removed = 0;
    for (const tp of this.timed) {
      if (tp.t >= cutoff) break;
      this._maybeAddFootstep(tp);
      removed++;
    }
    if (removed) this.timed.splice(0, removed);
  }

  _maybeAddFootstep(p) {
    if (this.foots.length >= MAX_FOOTSTEPS) return;
    if (this.lastFoot &&
        Math.hypot(p.x - this.lastFoot.x, p.y - this.lastFoot.y) < this._footSpacing) return;
    this.lastFoot = { x: p.x, y: p.y };
    this.foots.push(this.lastFoot);
  }

  // ----- Rendering -----

  _draw(now) {
    const { ctx } = this;
    const { w, h } = this.size;

    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Background fills always — even during the win flash, so the page
    // doesn't show through to a different color.
    ctx.fillStyle = this.style.backgroundColor;
    ctx.fillRect(0, 0, w, h);

    // During the win flash, fade the maze + footsteps + markers + trail
    // + cursor as a group, leaving the background and the 🎉 emoji alone.
    // The fade completes well before the emoji finishes, so the user sees
    // a clean celebration on top of an empty canvas.
    let mazeAlpha = 1;
    if (this._winFlash) {
      const e = now - this._winFlash.start;
      mazeAlpha = Math.max(0, 1 - e / 600);
    }

    if (mazeAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = mazeAlpha;

      if (this.mazeCanvas) {
        ctx.drawImage(this.mazeCanvas, 0, 0, w, h);
      }

      // Footsteps — dense, opaque dotted trail.
      ctx.fillStyle = this.style.footstepColor;
      for (const f of this.foots) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, this._footR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Markers — start/end cells randomized per maze (see _pickEndpoints)
      this._drawMarker(this.startCell.col, this.startCell.row, /*isStart*/ true);
      this._drawMarker(this.endCell.col,   this.endCell.row,   /*isStart*/ false);

      // Trail — segments thickening toward the head, fading at the tail.
      const n = this.timed.length;
      if (n >= 2) {
        ctx.strokeStyle = this.style.trailColor;
        ctx.lineCap = 'round';
        const denom = Math.max(n - 1, 1);
        for (let i = 0; i < n - 1; i++) {
          const t = (i + 1) / denom;
          ctx.lineWidth = Math.max(0.5, t * this._headR * 2);
          ctx.beginPath();
          ctx.moveTo(this.timed[i].x,     this.timed[i].y);
          ctx.lineTo(this.timed[i + 1].x, this.timed[i + 1].y);
          ctx.stroke();
        }
      }

      // Cursor head
      if (this.cursor.visible) {
        ctx.fillStyle   = this.style.trailColor;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(this.cursor.x, this.cursor.y, this._headR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }

    // Menu button — always full opacity so the user can bail out anytime,
    // even mid-celebration.
    ctx.fillStyle    = this.style.wallColor;
    ctx.font         = '600 22px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';
    ctx.fillText('← Menu', 32, this._headerTop + HEADER_HEIGHT / 2);

    // Win flash — 🎉 emoji rides on top of the now-faded maze.
    if (this._winFlash) {
      const elapsed = now - this._winFlash.start;
      const total   = 2200;
      if (elapsed >= total) {
        this._winFlash = null;
        this._restartAfterWin();
      } else {
        const fadeIn  = Math.min(elapsed / 200, 1);
        const fadeOut = elapsed > total - 300
                        ? Math.max(0, 1 - (elapsed - (total - 300)) / 300)
                        : 1;
        const scale   = 0.5 + 0.5 * Math.min(elapsed / 200, 1);
        ctx.save();
        ctx.globalAlpha = fadeIn * fadeOut;
        ctx.translate(w / 2, h / 2);
        ctx.scale(scale, scale);
        ctx.font         = '80px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎉', 0, 0);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _drawMarker(col, row, isStart) {
    const { ctx } = this;
    const center  = this._cellCenter(col, row);
    const r       = this.cellSize * 0.40;        // marker disc radius

    // Solid filled disc — no outline.  A soft wood-tinted token on the
    // parchment so the marker reads as part of the scene rather than as
    // something stroked on top.
    ctx.beginPath();
    ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    ctx.fillStyle = this._withAlpha(this.style.wallColor, 0.18);
    ctx.fill();

    // Inner emoji — sized to fill the disc generously and centred properly.
    // Apple Color Emoji renders with the visual glyph sitting ABOVE the em
    // box centre, so a `middle` baseline parks it too high; nudging DOWN
    // by ~7% of font size lands the visual centre on the disc centre.
    const emoji    = isStart ? this.startEmoji : '🏁';
    const fontSize = Math.max(20, r * 1.55);
    ctx.font         = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    // Reset fillStyle so any monochrome emoji fallback stays readable.
    ctx.fillStyle    = this.style.wallColor;
    ctx.fillText(emoji, center.x, center.y + fontSize * 0.07);
  }

  _withAlpha(rgbStr, a) {
    if (rgbStr.startsWith('rgba')) {
      return rgbStr.replace(/[\d.]+\)$/, `${a})`);
    }
    return rgbStr.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  }

  // ----- Coordinates -----

  _cellCenter(col, row) {
    return {
      x: this.origin.x + (col + 0.5) * this.cellSize,
      y: this.origin.y + (this._gridRows - row - 0.5) * this.cellSize,
    };
  }

  _cellAt(p) {
    const relX = p.x - this.origin.x;
    const relY = (this.origin.y + this._gridRows * this.cellSize) - p.y;
    if (relX < 0 || relY < 0) return null;
    const col = Math.floor(relX / this.cellSize);
    const row = Math.floor(relY / this.cellSize);
    if (col < 0 || col >= this._gridCols || row < 0 || row >= this._gridRows) return null;
    return { col, row };
  }

  _cellsEqual(a, b) { return a && b && a.col === b.col && a.row === b.row; }
  _isAdjacent(a, b) { return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1; }
  _direction(a, b)  { return dirNameFromOffset(b.col - a.col, b.row - a.row); }

  _cellBounds(c) {
    return {
      x: this.origin.x + c.col * this.cellSize,
      y: this.origin.y + (this._gridRows - c.row - 1) * this.cellSize,
      w: this.cellSize, h: this.cellSize,
    };
  }

  /**
   * Clamp `p` inside cell `c`'s bounds, with a per-side margin that pushes
   * the cursor away from CLOSED walls only.  Sides that are passages keep
   * a zero margin so motion across them stays smooth.  Without this the
   * cursor center clamps exactly onto the wall line — the head visually
   * overlaps the wall and "stuck on a corner" leaves no breathing room.
   */
  _clampToCell(p, c) {
    const b = this._cellBounds(c);
    // Margin slightly larger than the head radius so there's a visible gap
    // between the cursor and any wall it's pressed against.  Scales with
    // headR so tight mobile cells don't lose all their inner movement room.
    const m = this._headR + Math.max(2, this._headR * 0.3);

    // Maze 'top' direction = +row = upper edge in canvas (smaller y).
    // 'bottom' = -row = lower edge (larger y).
    const wallNorth = !this.maze.hasPassage(c.col, c.row, 'top');
    const wallSouth = !this.maze.hasPassage(c.col, c.row, 'bottom');
    const wallWest  = !this.maze.hasPassage(c.col, c.row, 'left');
    const wallEast  = !this.maze.hasPassage(c.col, c.row, 'right');

    const minX = b.x         + (wallWest  ? m : 0);
    const maxX = b.x + b.w   - (wallEast  ? m : 0);
    const minY = b.y         + (wallNorth ? m : 0);
    const maxY = b.y + b.h   - (wallSouth ? m : 0);

    // Guard against degenerate bounds in absurdly tiny cells (max < min):
    // fall back to the cell centre so the cursor can't escape.
    if (maxX < minX || maxY < minY) {
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }
    return {
      x: Math.max(minX, Math.min(maxX, p.x)),
      y: Math.max(minY, Math.min(maxY, p.y)),
    };
  }

  // ----- Wall clamping (mirrors Swift `resolve`) -----

  _canMove(target, current) {
    const c = this._cellAt(target);
    if (!c) return null;
    if (this._cellsEqual(c, current)) return { pos: target, cell: current };
    if (!this._isAdjacent(current, c)) return null;
    const dir = this._direction(current, c);
    if (!dir) return null;
    if (!this.maze.hasPassage(current.col, current.row, dir)) return null;
    return { pos: target, cell: c };
  }

  _resolve(target, current) {
    // Clamp the chosen pos inside its cell's safe zone on EVERY return so
    // the cursor can never park within HEAD_RADIUS of a closed wall — not
    // just on the corner-stuck fallback.  Otherwise dragging straight at
    // a wall leaves the cursor center 1 px from the wall line, with the
    // head visually overlapping the bark.
    const safe = (r) => ({ pos: this._clampToCell(r.pos, r.cell), cell: r.cell });

    let r;
    if ((r = this._canMove(target, current))) return safe(r);
    r = this._canMove({ x: target.x, y: this.lastResolved.y }, current); if (r) return safe(r);
    r = this._canMove({ x: this.lastResolved.x, y: target.y }, current); if (r) return safe(r);

    const next = this._cellAt(target);
    if (next && !this._cellsEqual(next, current)) {
      const dc = Math.sign(next.col - current.col);
      const dr = Math.sign(next.row - current.row);
      for (const step of [[dc, 0], [0, dr]]) {
        if (step[0] === 0 && step[1] === 0) continue;
        const nb  = { col: current.col + step[0], row: current.row + step[1] };
        const dir = this._direction(current, nb);
        if (dir && this.maze.hasPassage(current.col, current.row, dir)) {
          return { pos: this._clampToCell(target, nb), cell: nb };
        }
      }
    }
    return { pos: this._clampToCell(target, current), cell: current };
  }

  // ----- Pointer input -----

  _installInputHandlers() {
    const c = this.canvas;
    const toScene = (ev) => {
      const r = c.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) * (c.width  / r.width)  / devicePixelRatio,
        y: (ev.clientY - r.top)  * (c.height / r.height) / devicePixelRatio,
      };
    };

    const down = (ev) => {
      ev.preventDefault();
      c.setPointerCapture(ev.pointerId);
      const p = toScene(ev);
      // Menu button hit-test — entire reserved header strip (plus the
      // safe-area band above it) is tappable on the left side.
      if (p.x < 160 && p.y < this._headerBot) {
        this.onBack();
        return;
      }
      const cell = this._cellAt(p);
      if (!cell) return;
      if (this.currentCell && this._cellsEqual(cell, this.currentCell)) {
        this.isDrawing = true;
        this.lastResolved = p;
      } else if (this._cellsEqual(cell, this.startCell)) {
        this.currentCell  = cell;
        this.isDrawing    = true;
        this.lastResolved = p;
        this._record(p, performance.now());
      }
    };

    const move = (ev) => {
      if (!this.isDrawing || !this.currentCell) return;
      ev.preventDefault();
      const p = toScene(ev);
      const r = this._resolve(p, this.currentCell);
      this.lastResolved = r.pos;
      this.currentCell  = r.cell;
      this._record(r.pos, performance.now());
      if (this._cellsEqual(r.cell, this.endCell)) {
        const ec = this._cellCenter(this.endCell.col, this.endCell.row);
        if (Math.hypot(r.pos.x - ec.x, r.pos.y - ec.y) < this.cellSize * 0.3) {
          this._handleWin();
        }
      }
    };

    const stop = () => { this.isDrawing = false; };

    c.addEventListener('pointerdown',   down);
    c.addEventListener('pointermove',   move);
    c.addEventListener('pointerup',     stop);
    c.addEventListener('pointercancel', stop);

    this._removeInputHandlers = () => {
      c.removeEventListener('pointerdown',   down);
      c.removeEventListener('pointermove',   move);
      c.removeEventListener('pointerup',     stop);
      c.removeEventListener('pointercancel', stop);
    };
  }

  _record(p, time) {
    const last = this.timed[this.timed.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < SUBSAMPLE_DIST) return;
    this.timed.push({ x: p.x, y: p.y, t: time });
    this.cursor = { visible: true, x: p.x, y: p.y };
  }

  // ----- Win -----

  _handleWin() {
    this.isDrawing = false;
    this.timed = [];
    this._winFlash = { start: performance.now() };
  }

  _restartAfterWin() {
    this.styleIdx += 1;
    this.foots = [];
    this.lastFoot = null;
    this.currentCell = null;
    this.cursor = { visible: false, x: 0, y: 0 };
    this._applyGlobalTheme();
    this._buildMaze();
  }
}

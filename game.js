// AMAZE — game scene: sprite-based maze rendering, drag input, trail, win.
// Mirrors GameScene.swift.

import { Maze, LevelStyles, Direction } from './maze.js';

// ---- tunables (mirror Swift constants) ------------------------------------
// "Reference" values tuned for iPad-sized cells (~56 px).  Actual per-frame
// values are derived from cellSize in _buildLayout so smaller mobile cells
// get proportionally thinner walls and a smaller cursor head.
// REF_WALL_WIDTH bumped to 18 so the painted bark reads with more
// presence at every difficulty (was 14 — felt thin on hard mazes).
const REF_WALL_WIDTH    = 18;
const REF_HEAD_RADIUS   = 14;
const REF_CELL_SIZE     = 56;     // wallW/headR hit their cap at this cellSize
const TRAIL_DURATION_MS = 2500;
const SUBSAMPLE_DIST    = 5;
const MAX_FOOTSTEPS     = 800;    // bumped — denser dotted trail = more dots
// FIFO-evicted; long fast drags would otherwise grow without bound.
const MAX_PARTICLES     = 240;

// Picked once per maze for the start-cell marker.  Forest-themed so it
// matches the painterly bark/leaf vibe.
const START_EMOJIS = [
  '🐢', '🐇', '🦊', '🐻', '🦝', '🦔', '🐿️', '🦌',
  '🐹', '🐭', '🦉', '🐦', '🐸', '🦋', '🐛', '🦡',
];

// What the cursor picks up.  Acorn matches the forest theme; one item
// per collectible across all 6 themes for visual consistency.
const COLLECTIBLE_EMOJI = '🌰';

// Reserved header strip at the top of the viewport for the menu button (and
// any future UI).  The maze is laid out below this band so its top row
// can't slide under the button.
const HEADER_HEIGHT     = 72;
// Extra breathing room between the bottom of the HTML top bar and the
// first maze row.  Keeps walls from sitting flush against the chrome.
const HEADER_BOTTOM_GAP = 16;

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
   * @param {{
   *   onCollectiblesUpdate?: () => void,
   *   onThemeChange?:        (style: object) => void,
   *   onWin?:                () => void,
   *   styleIndex?:           number,
   *   showCollectibles?:     boolean,
   * }} [opts]
   */
  constructor(canvas, difficulty, opts = {}) {
    this.canvas         = canvas;
    this.ctx            = canvas.getContext('2d');
    this.diff           = difficulty;
    this.styleIdx       = opts.styleIndex ?? 0;
    this._onColUpd      = opts.onCollectiblesUpdate ?? (() => {});
    this._onThemeChange = opts.onThemeChange         ?? (() => {});
    this._onWin         = opts.onWin                 ?? (() => {});
    this.showCollectibles = opts.showCollectibles ?? true;

    this.timed         = [];      // {x,y,t} subsampled drag points (for trail)
    this.foots         = [];      // {x,y} permanent footstep dots
    this.lastFoot      = null;
    this.cursor        = { visible: false, x: 0, y: 0 };
    this.collectibles  = [];      // {col, row, picked, pickedAt}
    this.particles     = [];      // {x,y,vx,vy,life,maxLife,r}
    this._lastTick     = 0;       // ms timestamp from previous frame, for dt

    this.currentCell  = null;
    this.lastResolved = { x: 0, y: 0 };
    this.isDrawing    = false;

    this._winFlash = null;
    this._alive    = true;        // gates the rAF loop on destroy()
    this._rafId    = 0;

    this._buildLayout();
    this._installInputHandlers();

    // Apply the initial theme bg before the first frame so the page
    // doesn't briefly show the menu palette behind a different maze.
    this._onThemeChange(this.style);

    Promise.all([...TRUNK_NAMES, ...DROOD_NAMES].map(loadImage))
      .then(() => this._buildMaze())
      .then(() => { this._rafId = requestAnimationFrame(this._tick); });
  }

  destroy() {
    this._alive = false;
    cancelAnimationFrame(this._rafId);
    this._removeInputHandlers?.();
    // Clear the canvas so the previous maze doesn't sit visible behind
    // the (transparent) menu overlay when the player goes back.
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
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
    this._headerTop  = safeTop;                                     // y where header starts
    this._headerBot  = safeTop + HEADER_HEIGHT + HEADER_BOTTOM_GAP; // y where maze can start

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

  /** Drop 3 collectible acorns at random dead-end cells (cells with only
   *  one passage), excluding start and end.  Dead-ends naturally sit OFF
   *  the solution path, so the player has to detour into a wrong-looking
   *  branch to grab them.  All three = 3-star rating in the win cinema.
   *
   *  No-op if `showCollectibles` is disabled — the array stays empty so
   *  HUD, win-cinema rating, and pickup detection all naturally skip. */
  _placeCollectibles() {
    if (!this.showCollectibles) {
      this.collectibles = [];
      return;
    }
    const TARGET = 3;
    const candidates = [];
    for (let col = 0; col < this._gridCols; col++) {
      for (let row = 0; row < this._gridRows; row++) {
        if (this.maze.passages[col][row].size !== 1) continue;
        if (col === this.startCell.col && row === this.startCell.row) continue;
        if (col === this.endCell.col   && row === this.endCell.row)   continue;
        candidates.push({ col, row });
      }
    }
    // Tiny mazes might not have 3 dead-ends — fall back to random non-
    // endpoint cells so the count is always TARGET.
    if (candidates.length < TARGET) {
      for (let col = 0; col < this._gridCols; col++) {
        for (let row = 0; row < this._gridRows; row++) {
          if (col === this.startCell.col && row === this.startCell.row) continue;
          if (col === this.endCell.col   && row === this.endCell.row)   continue;
          if (candidates.some(c => c.col === col && c.row === row)) continue;
          candidates.push({ col, row });
        }
      }
    }
    // Fisher-Yates shuffle, take first TARGET.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    this.collectibles = candidates.slice(0, TARGET).map(c => ({
      col: c.col, row: c.row, picked: false, pickedAt: 0,
    }));
    this._onColUpd();
  }

  async _buildMaze() {
    this._pickEndpoints();
    const columns = this._gridCols;
    const rows    = this._gridRows;
    this.maze = new Maze(columns, rows);
    // Collectibles need this.maze for dead-end detection — place them
    // AFTER the maze graph exists, not before.
    this._placeCollectibles();

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
    // dt in seconds since the last frame, capped at 50 ms to avoid big
    // jumps when the tab was backgrounded.
    const dt = this._lastTick ? Math.min(0.05, (now - this._lastTick) / 1000) : 0;
    this._lastTick = now;
    this._expirePoints(now);
    this._updateParticles(dt);
    this._draw(now);
    this._rafId = requestAnimationFrame(this._tick);
  };

  _updateParticles(dt) {
    if (dt === 0 || this.particles.length === 0) return;
    for (const p of this.particles) {
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vy  += 70 * dt;        // gentle gravity so they settle downward
      p.life -= dt;
    }
    // Drop any that have aged out.  Cheap because particles only grow
    // during active drag and decay rapidly.
    this.particles = this.particles.filter(p => p.life > 0);
  }

  _emitParticle(x, y) {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles.shift();   // FIFO eviction
    }
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 70;
    const life  = 0.6 + Math.random() * 0.5;
    this.particles.push({
      x: x + (Math.random() - 0.5) * 4,
      y: y + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 35,   // slight upward bias
      life,
      maxLife: life,
      r: 0.6 + Math.random() * 1.0,
    });
  }

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

    // Canvas stays transparent — the body's warm sun-gradient is the
    // game-screen background, shared with the menu and modals.  Just
    // clear the previous frame's pixels and paint maze elements on top.
    ctx.clearRect(0, 0, w, h);

    // The HTML win modal's translucent backdrop dims the canvas after
    // the cinema completes, so the canvas stays at full opacity
    // throughout the play + walk + 🎉-burst sequence.
    const mazeAlpha = 1;

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

      // Markers — during the win cinema the start animal becomes the
      // walking animal (drawn separately below), so hide the static
      // start marker.  End flag stays put as the destination.
      if (!this._winFlash) {
        this._drawMarker(this.startCell.col, this.startCell.row, /*isStart*/ true, now);
      }
      this._drawMarker(this.endCell.col, this.endCell.row, /*isStart*/ false, now);

      // Collectibles — hidden during the cinema (already picked or
      // missed; the rating row is the post-walk reveal).
      if (!this._winFlash) {
        this._drawCollectibles(now);
      }

      // Trail — segments thickening toward the head, fading at the tail.
      // Max thickness clearly thinner than the cursor head so the head
      // reads as a distinct marker on top of the line, not the line's
      // bulge.
      const n = this.timed.length;
      if (n >= 2) {
        ctx.strokeStyle = this.style.trailColor;
        ctx.lineCap = 'round';
        const denom = Math.max(n - 1, 1);
        for (let i = 0; i < n - 1; i++) {
          const t = (i + 1) / denom;
          ctx.lineWidth = Math.max(0.5, t * this._headR * 1.2);
          ctx.beginPath();
          ctx.moveTo(this.timed[i].x,     this.timed[i].y);
          ctx.lineTo(this.timed[i + 1].x, this.timed[i + 1].y);
          ctx.stroke();
        }
      }

      // Particles — small drifting motes spawned at the cursor.  Drawn
      // between the trail and the cursor so they read as "rising off"
      // the freshly-laid path.  Fade with their remaining life.
      if (this.particles.length > 0) {
        ctx.fillStyle = this.style.trailColor;
        for (const pt of this.particles) {
          ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Cursor head — hidden during the win cinema (the player isn't
      // drawing anymore; the walking animal takes over as the focus).
      if (this.cursor.visible && !this._winFlash) {
        ctx.fillStyle   = this.style.trailColor;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(this.cursor.x, this.cursor.y, this._headR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Walking animal during the win cinema — eased traversal of the
      // BFS solution path with a small step-rhythm bob.  Drawn last so
      // it sits on top of the maze + trail + footsteps.
      if (this._winFlash) {
        const wf  = this._winFlash;
        const e   = now - wf.start;
        const raw = Math.min(1, e / wf.walkDur);
        // ease-in-out cubic — eases out of start, eases into goal
        const t   = raw < 0.5
                  ? 4 * raw * raw * raw
                  : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        if (wf.points.length > 0) {
          const pos = this._pointAtArcLength(wf.points, wf.lengths, t * wf.totalLen);
          const stepBob = Math.sin(now * 0.015) * 2;
          this._drawTokenAt(pos, this.startEmoji, { bob: stepBob });
        }
      }

      ctx.restore();
    }

    // (Menu button + acorn HUD are HTML elements now — see #game-topbar
    // in index.html and the CSS layer.  Canvas only renders the play
    // surface, the win cinema, and the static markers/collectibles.)

    // Win flash — once the walking-animal animation completes, hand off
    // to the HTML win modal (which animates the acorn rating in).  No
    // canvas celebration in between; the modal IS the celebration.
    if (this._winFlash) {
      const wf      = this._winFlash;
      const elapsed = now - wf.start;
      if (elapsed >= wf.end) {
        this._winFlash = null;
        this._onWin();
      }
    }

    ctx.restore();
  }

  _drawMarker(col, row, isStart, now) {
    const center = this._cellCenter(col, row);
    // Idle vertical bob (±2 px over ~2.6 s) for the start animal until
    // the player records their first trail point.  End flag is static.
    let bob = 0;
    if (isStart && this.timed.length === 0) {
      bob = Math.sin(now * 0.0024) * 2;
    }
    this._drawTokenAt(center, isStart ? this.startEmoji : '🏁', { bob });
  }

  /** Renders a "marker token" — soft wood-tinted disc + centred emoji —
   *  at an arbitrary canvas position.  Used both for the static start/
   *  end markers and for the walking animal during the win cinema. */
  _drawTokenAt(pos, emoji, { bob = 0 } = {}) {
    const { ctx } = this;
    const r        = this.cellSize * 0.40;
    const fontSize = Math.max(20, r * 1.55);

    ctx.save();
    ctx.translate(pos.x, pos.y + bob);

    // Solid filled disc — no outline.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = this._withAlpha(this.style.wallColor, 0.18);
    ctx.fill();

    // Inner emoji — measureText keeps each glyph's visual midpoint on the
    // disc centre regardless of the emoji's internal em-box asymmetry.
    ctx.font         = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle    = this.style.wallColor;
    const m       = ctx.measureText(emoji);
    const yOffset = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(emoji, 0, yOffset);

    ctx.restore();
  }

  /** Render the maze's 3 collectibles.  Unpicked items pulse softly; a
   *  recently-picked item briefly scales up + fades for a satisfying pop. */
  _drawCollectibles(now) {
    const ctx = this.ctx;
    const r        = this.cellSize * 0.22;
    const fontSize = Math.max(14, r * 1.5);

    ctx.font         = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(COLLECTIBLE_EMOJI);
    const baseYOffset = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;

    for (const c of this.collectibles) {
      const center = this._cellCenter(c.col, c.row);

      if (c.picked) {
        // Pickup animation — scale up + fade out over 500 ms, then gone.
        const elapsed = now - c.pickedAt;
        if (elapsed > 500) continue;
        const t = elapsed / 500;
        const scale = 1 + t * 1.4;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.translate(center.x, center.y);
        ctx.scale(scale, scale);
        ctx.fillStyle = this.style.wallColor;
        ctx.fillText(COLLECTIBLE_EMOJI, 0, baseYOffset);
        ctx.restore();
      } else {
        // Soft pulsing glow + emoji.  Phase offset by cell coords so all
        // three don't pulse in lockstep.
        const pulse = 1 + Math.sin(now * 0.004 + c.col * 0.7 + c.row * 0.3) * 0.10;
        ctx.beginPath();
        ctx.arc(center.x, center.y, r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = this._withAlpha(this.style.trailColor, 0.20);
        ctx.fill();

        ctx.fillStyle = this.style.wallColor;
        ctx.fillText(COLLECTIBLE_EMOJI, center.x, center.y + baseYOffset);
      }
    }
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
      // (Top-bar buttons are HTML elements with their own click handlers
      // and z-index above the canvas, so taps on them never reach this
      // pointerdown listener.  Canvas just handles cell hits.)
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

      // Pick up any acorn whose cell the cursor just entered.
      for (const c of this.collectibles) {
        if (!c.picked &&
            r.cell.col === c.col && r.cell.row === c.row) {
          c.picked   = true;
          c.pickedAt = performance.now();
          this._onColUpd();
        }
      }

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
    // Each accepted sample spawns a couple of particles at the cursor.
    // They drift outward and fade — combined with the SUBSAMPLE_DIST
    // cadence this gives the trail a faintly alive sparkle.
    this._emitParticle(p.x, p.y);
    this._emitParticle(p.x, p.y);
  }

  // ----- Public API for HTML chrome -----

  /** Regenerate the maze with the SAME difficulty + same theme, resetting
   *  trail/footsteps/particles/win-state.  Triggered by the top-bar ↻. */
  restart() {
    this.foots         = [];
    this.lastFoot      = null;
    this.particles     = [];
    this.timed         = [];
    this.currentCell   = null;
    this.cursor        = { visible: false, x: 0, y: 0 };
    this._winFlash     = null;
    this.isDrawing     = false;
    this._buildMaze();
  }

  /** Cycle to the next theme and build a new maze.  Triggered by the
   *  win-modal "Again ▶" button. */
  nextMaze() {
    this.styleIdx += 1;
    this.foots         = [];
    this.lastFoot      = null;
    this.particles     = [];
    this.timed         = [];
    this.currentCell   = null;
    this.cursor        = { visible: false, x: 0, y: 0 };
    this._winFlash     = null;
    this.isDrawing     = false;
    this._onThemeChange(this.style);   // body gradient cycles with the theme
    this._buildMaze();
  }

  /** Toggle collectibles on/off mid-game.  Turning ON places acorns into
   *  the current maze if it has none yet; turning OFF clears them.
   *  Notifies the HTML HUD via the onCollectiblesUpdate callback. */
  setShowCollectibles(show) {
    this.showCollectibles = show;
    if (show && this.maze && this.collectibles.length === 0) {
      this._placeCollectibles();           // also fires _onColUpd
    } else if (!show) {
      this.collectibles = [];
      this._onColUpd();
    }
  }

  // ----- Win -----

  _handleWin() {
    this.isDrawing = false;
    this.timed = [];

    // Solve the maze once and cache an arc-length-parameterised polyline
    // so the win cinema can walk the start animal along it cleanly.
    const cellPath = this._bfsSolution();
    const points   = cellPath.length > 0
      ? cellPath.map(c => this._cellCenter(c.col, c.row))
      // Defensive fallback (mazes are always connected, so this path is
      // unreachable in practice) — still produces a valid 2-point line.
      : [this._cellCenter(this.startCell.col, this.startCell.row),
         this._cellCenter(this.endCell.col,   this.endCell.row)];

    // Final hop: lift the animal ABOVE the flag at the end so both
    // tokens are visible.  Adds one extra path segment that goes
    // straight up from the goal cell by ~one cell.
    if (points.length >= 1) {
      const last = points[points.length - 1];
      points.push({ x: last.x, y: last.y - this.cellSize * 0.90 });
    }

    const lengths = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x,
                          points[i].y - points[i - 1].y);
      lengths.push(total);
    }

    // Walk pace: 50 ms per cell with a small floor so trivial paths
    // aren't instant.  No upper cap — longer paths get proportionally
    // longer animations, so the walk speed is consistent regardless of
    // difficulty instead of squeezing every length into the same time.
    const walkDur = Math.max(800, points.length * 50);

    this._winFlash = {
      start: performance.now(),
      points, lengths,
      totalLen: total,
      walkDur,
      // No canvas celebration — once the animal arrives we hand off
      // straight to the HTML win modal, which animates the acorns in.
      end: walkDur,
    };
  }

  /** Breadth-first search for the (unique) path from start to end through
   *  the maze graph.  Returns an array of {col,row} from start to end
   *  inclusive.  Empty array if the cells are somehow not connected
   *  (shouldn't happen — mazes are spanning trees). */
  _bfsSolution() {
    const sk = `${this.startCell.col},${this.startCell.row}`;
    const queue   = [{ col: this.startCell.col, row: this.startCell.row }];
    const parent  = new Map();
    const visited = new Set([sk]);

    while (queue.length > 0) {
      const cur = queue.shift();
      const ck  = `${cur.col},${cur.row}`;
      if (cur.col === this.endCell.col && cur.row === this.endCell.row) {
        const path = [cur];
        let k = ck;
        while (parent.has(k)) {
          k = parent.get(k);
          const [c, r] = k.split(',').map(Number);
          path.unshift({ col: c, row: r });
        }
        return path;
      }
      for (const dirName of ['top', 'right', 'bottom', 'left']) {
        if (!this.maze.hasPassage(cur.col, cur.row, dirName)) continue;
        const off = Direction[dirName];
        const nc  = cur.col + off.dc;
        const nr  = cur.row + off.dr;
        const nk  = `${nc},${nr}`;
        if (visited.has(nk)) continue;
        visited.add(nk);
        parent.set(nk, ck);
        queue.push({ col: nc, row: nr });
      }
    }
    return [];
  }

  /** Linearly interpolate a position at arc-length `s` along the polyline
   *  defined by `points` and the cumulative `lengths`. */
  _pointAtArcLength(points, lengths, s) {
    if (points.length <= 1) return points[0] ?? { x: 0, y: 0 };
    if (s <= 0)             return points[0];
    const total = lengths[lengths.length - 1];
    if (s >= total)         return points[points.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
      if (s <= lengths[i + 1]) {
        const segLen = lengths[i + 1] - lengths[i];
        const t = segLen > 0 ? (s - lengths[i]) / segLen : 0;
        return {
          x: points[i].x + (points[i + 1].x - points[i].x) * t,
          y: points[i].y + (points[i + 1].y - points[i].y) * t,
        };
      }
    }
    return points[points.length - 1];
  }

}

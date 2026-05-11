// AMAZE — maze generation, difficulty, and theme data.
// Pure logic, no DOM/Canvas — mirrors the Swift originals.

// ----- Difficulty -----------------------------------------------------------

export const Difficulty = Object.freeze({
  easy:   { id: 'easy',   columns:  7, rows: 11 },
  medium: { id: 'medium', columns: 11, rows: 17 },
  hard:   { id: 'hard',   columns: 15, rows: 23 },
});

// ----- Maze (Prim's algorithm) ---------------------------------------------

// Direction encoding matches the Swift version:
//   top    = +row,  bottom = -row
//   right  = +col,  left   = -col
export const Direction = Object.freeze({
  top:    { dc:  0, dr:  1 },
  right:  { dc:  1, dr:  0 },
  bottom: { dc:  0, dr: -1 },
  left:   { dc: -1, dr:  0 },
});

const ALL_DIRS = ['top', 'right', 'bottom', 'left'];

function oppositeName(name) {
  return { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[name];
}

export class Maze {
  constructor(columns, rows) {
    this.columns = columns;
    this.rows    = rows;
    // passages[col][row] = Set of direction names that are open from this cell
    this.passages = Array.from({ length: columns }, () =>
      Array.from({ length: rows }, () => new Set()));
    this._generate();
  }

  hasPassage(col, row, dirName) {
    return this.passages[col][row].has(dirName);
  }

  passagesAt(col, row) {
    return this.passages[col][row];
  }

  // Recursive-backtracker (depth-first) maze generation.  Produces "rivery"
  // mazes with long winding corridors and few-but-long dead-end branches —
  // the opposite of Prim's, which sprouts lots of short stubs everywhere.
  // Result: solution paths that traverse most of the grid, and wrong turns
  // that feel like real alternative routes (not "obvious dead end after
  // 2 cells").
  _generate() {
    const { columns, rows } = this;
    const visited = Array.from({ length: columns }, () =>
      Array(rows).fill(false));

    /** @type {{col:number,row:number}[]} */
    const stack = [{ col: 0, row: 0 }];
    visited[0][0] = true;

    while (stack.length > 0) {
      const top = stack[stack.length - 1];

      // Gather unvisited neighbours
      const candidates = [];
      for (const name of ALL_DIRS) {
        const { dc, dr } = Direction[name];
        const nc = top.col + dc;
        const nr = top.row + dr;
        if (nc < 0 || nc >= columns || nr < 0 || nr >= rows) continue;
        if (visited[nc][nr]) continue;
        candidates.push({ col: nc, row: nr, dirName: name });
      }

      if (candidates.length === 0) {
        stack.pop();         // dead-end — backtrack
        continue;
      }

      // Carve through a random unvisited neighbour and recurse there.
      const next = candidates[(Math.random() * candidates.length) | 0];
      this.passages[top.col][top.row].add(next.dirName);
      this.passages[next.col][next.row].add(oppositeName(next.dirName));
      visited[next.col][next.row] = true;
      stack.push({ col: next.col, row: next.row });
    }
  }
}

// ----- LevelStyle -----------------------------------------------------------
// Colours mirror LevelStyle.swift — one-to-one except expressed as CSS rgb
// strings.  `wallTint` is the lightened bark-tint colour used for sprite
// blending; `wallColor` is reserved for UI accents (markers, menu text).

const rgb  = (r, g, b)        => `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
const rgba = (r, g, b, a)     => `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a})`;

// Body bg is two stacked gradients:
//   1. Linear pass: bgGradientTop → backgroundColor → bgGradientBottom
//      (top → middle → bottom of viewport).  Stops sit within ~10–12%
//      lightness of each other — variation is carried by HUE, not
//      brightness.  Middle is the brightest, top/bottom dip slightly
//      to give a horizon-like depth.
//   2. Radial overlay: bgGradientGlow fading to transparent in one
//      corner.  Its job is to wash the corner with a different HUE,
//      not to brighten it.  Glow luminance stays within ~5–10% of the
//      linear's top stop, so it never reads as a stark spotlight —
//      just an organic hue accent over the linear pass.
export const LevelStyles = [
  // 1. Enchanted Forest — sunny afternoon (peach → cream → tan, gold wash)
  {
    name: 'Enchanted Forest',
    backgroundColor:   rgb(0.97, 0.88, 0.65),  // cream-gold (mid)
    bgGradientTop:     rgb(0.92, 0.80, 0.58),  // warm peach-amber
    bgGradientBottom:  rgb(0.90, 0.75, 0.50),  // warm tan
    bgGradientGlow:    rgb(0.99, 0.86, 0.58),  // sunny gold accent
    wallColor:         rgb(0.36, 0.23, 0.10),
    wallTint:          rgb(0.68, 0.55, 0.40),
    trailColor:        rgb(0.24, 0.55, 0.24),
    footstepColor:     rgba(0.24, 0.55, 0.24, 0.75),
  },
  // 2. Ancient Map — sepia parchment (rosy sand → tan → olive, amber wash)
  {
    name: 'Ancient Map',
    backgroundColor:   rgb(0.92, 0.81, 0.62),  // tan parchment (mid)
    bgGradientTop:     rgb(0.86, 0.75, 0.58),  // rosy sand
    bgGradientBottom:  rgb(0.80, 0.70, 0.50),  // olive parchment
    bgGradientGlow:    rgb(0.96, 0.84, 0.60),  // warm amber
    wallColor:         rgb(0.24, 0.14, 0.04),
    wallTint:          rgb(0.24, 0.14, 0.04),
    trailColor:        rgb(0.78, 0.53, 0.04),
    footstepColor:     rgba(0.78, 0.53, 0.04, 0.75),
  },
  // 3. Moonlit Grove — night forest (indigo → blue-green → teal, moonlight wash)
  {
    name: 'Moonlit Grove',
    backgroundColor:   rgb(0.14, 0.22, 0.28),  // night blue-green (mid)
    bgGradientTop:     rgb(0.10, 0.13, 0.22),  // deep indigo
    bgGradientBottom:  rgb(0.07, 0.17, 0.22),  // dark teal
    bgGradientGlow:    rgb(0.20, 0.30, 0.38),  // cool moonlight wash
    wallColor:         rgb(0.54, 0.72, 0.54),
    wallTint:          rgb(0.54, 0.72, 0.54),
    trailColor:        rgb(0.72, 1.00, 0.50),
    footstepColor:     rgba(0.72, 1.00, 0.50, 0.75),
  },
  // 4. Autumn Trail — sunset (rose-pink → peach → amber-tan, coral wash)
  {
    name: 'Autumn Trail',
    backgroundColor:   rgb(0.97, 0.78, 0.58),  // peach (mid)
    bgGradientTop:     rgb(0.93, 0.70, 0.60),  // dusty rose-pink
    bgGradientBottom:  rgb(0.88, 0.65, 0.42),  // warm amber-tan
    bgGradientGlow:    rgb(1.00, 0.80, 0.58),  // bright coral-peach
    wallColor:         rgb(0.42, 0.18, 0.03),
    wallTint:          rgb(0.74, 0.48, 0.30),
    trailColor:        rgb(0.91, 0.38, 0.13),
    footstepColor:     rgba(0.91, 0.38, 0.13, 0.75),
  },
  // 5. Fairy Garden — pastel (peach-pink → lilac → lavender, warm pink wash)
  {
    name: 'Fairy Garden',
    backgroundColor:   rgb(0.90, 0.83, 0.93),  // lilac (mid)
    bgGradientTop:     rgb(0.93, 0.80, 0.85),  // soft peach-pink
    bgGradientBottom:  rgb(0.78, 0.70, 0.88),  // dusty lavender
    bgGradientGlow:    rgb(1.00, 0.85, 0.85),  // warm peach-pink wash
    wallColor:         rgb(0.42, 0.25, 0.50),
    wallTint:          rgb(0.65, 0.45, 0.70),
    trailColor:        rgb(0.88, 0.38, 0.69),
    footstepColor:     rgba(0.88, 0.38, 0.69, 0.75),
  },
  // 6. Stone & Moss — green (pale sage → soft moss → deeper sage, chartreuse wash)
  {
    name: 'Stone & Moss',
    backgroundColor:   rgb(0.84, 0.87, 0.68),  // soft moss (mid)
    bgGradientTop:     rgb(0.78, 0.82, 0.62),  // pale sage
    bgGradientBottom:  rgb(0.70, 0.76, 0.55),  // deeper sage
    bgGradientGlow:    rgb(0.90, 0.92, 0.68),  // warm chartreuse highlight
    wallColor:         rgb(0.32, 0.40, 0.22),
    wallTint:          rgb(0.55, 0.66, 0.42),
    trailColor:        rgb(0.00, 0.63, 0.38),
    footstepColor:     rgba(0.00, 0.63, 0.38, 0.75),
  },
];

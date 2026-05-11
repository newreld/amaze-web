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

// Each theme now defines its bg gradient explicitly (sun + base + dark)
// rather than computing it from a single bg colour, so palettes stay
// vibrant and colourful at both ends instead of fading into grey.  For
// dark themes the sun is intentionally close in brightness to the base
// — a soft moonlight glow rather than a stark highlight.
export const LevelStyles = [
  // 1. Enchanted Forest — warm sunny afternoon
  {
    name: 'Enchanted Forest',
    backgroundColor: rgb(0.96, 0.87, 0.66),    // warm cream
    bgGradientSun:   rgb(1.00, 0.86, 0.43),    // bright gold
    bgGradientDark:  rgb(0.85, 0.68, 0.37),    // warm tan
    wallColor:       rgb(0.36, 0.23, 0.10),
    wallTint:        rgb(0.68, 0.55, 0.40),
    trailColor:      rgb(0.24, 0.55, 0.24),
    footstepColor:   rgba(0.24, 0.55, 0.24, 0.75),
  },
  // 2. Ancient Map — sepia parchment dusk
  {
    name: 'Ancient Map',
    backgroundColor: rgb(0.83, 0.71, 0.51),    // tan paper
    bgGradientSun:   rgb(0.93, 0.78, 0.55),    // amber
    bgGradientDark:  rgb(0.55, 0.36, 0.18),    // leather brown
    wallColor:       rgb(0.24, 0.14, 0.04),
    wallTint:        rgb(0.24, 0.14, 0.04),
    trailColor:      rgb(0.78, 0.53, 0.04),
    footstepColor:   rgba(0.78, 0.53, 0.04, 0.75),
  },
  // 3. Moonlit Grove — deep night forest (low contrast sun)
  {
    name: 'Moonlit Grove',
    backgroundColor: rgb(0.08, 0.15, 0.22),    // night blue-green
    bgGradientSun:   rgb(0.22, 0.34, 0.42),    // soft moonlight
    bgGradientDark:  rgb(0.03, 0.08, 0.13),    // pitch night
    wallColor:       rgb(0.54, 0.72, 0.54),
    wallTint:        rgb(0.54, 0.72, 0.54),
    trailColor:      rgb(0.72, 1.00, 0.50),
    footstepColor:   rgba(0.72, 1.00, 0.50, 0.75),
  },
  // 4. Autumn Trail — orange sunset
  {
    name: 'Autumn Trail',
    backgroundColor: rgb(0.97, 0.78, 0.55),    // peach
    bgGradientSun:   rgb(1.00, 0.65, 0.32),    // bright orange
    bgGradientDark:  rgb(0.70, 0.36, 0.16),    // rust
    wallColor:       rgb(0.42, 0.18, 0.03),
    wallTint:        rgb(0.74, 0.48, 0.30),
    trailColor:      rgb(0.91, 0.38, 0.13),
    footstepColor:   rgba(0.91, 0.38, 0.13, 0.75),
  },
  // 5. Fairy Garden — pastel pink + lavender
  {
    name: 'Fairy Garden',
    backgroundColor: rgb(0.89, 0.78, 0.92),    // soft lilac
    bgGradientSun:   rgb(1.00, 0.82, 0.90),    // soft pink
    bgGradientDark:  rgb(0.65, 0.51, 0.79),    // lavender
    wallColor:       rgb(0.42, 0.25, 0.50),
    wallTint:        rgb(0.65, 0.45, 0.70),
    trailColor:      rgb(0.88, 0.38, 0.69),
    footstepColor:   rgba(0.88, 0.38, 0.69, 0.75),
  },
  // 6. Stone & Moss — vibrant moss green
  {
    name: 'Stone & Moss',
    backgroundColor: rgb(0.78, 0.84, 0.66),    // pale moss
    bgGradientSun:   rgb(0.94, 0.96, 0.78),    // bright moss highlight
    bgGradientDark:  rgb(0.42, 0.55, 0.30),    // deep moss
    wallColor:       rgb(0.32, 0.40, 0.22),
    wallTint:        rgb(0.55, 0.66, 0.42),
    trailColor:      rgb(0.00, 0.63, 0.38),
    footstepColor:   rgba(0.00, 0.63, 0.38, 0.75),
  },
];

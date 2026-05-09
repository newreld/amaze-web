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

function dirNameFromOffset(dc, dr) {
  if (dc === 0 && dr ===  1) return 'top';
  if (dc === 0 && dr === -1) return 'bottom';
  if (dc ===  1 && dr === 0) return 'right';
  if (dc === -1 && dr === 0) return 'left';
  return null;
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

  // Prim's growing-tree algorithm: pick a random edge from the frontier,
  // open the wall between visited & unvisited cells, repeat.
  _generate() {
    const { columns, rows } = this;
    const visited = Array.from({ length: columns }, () =>
      Array(rows).fill(false));

    /** @type {{col:number,row:number,fromCol:number,fromRow:number}[]} */
    const frontier = [];

    const enqueue = (col, row) => {
      for (const name of ALL_DIRS) {
        const { dc, dr } = Direction[name];
        const nc = col + dc, nr = row + dr;
        if (nc < 0 || nc >= columns || nr < 0 || nr >= rows) continue;
        if (visited[nc][nr]) continue;
        frontier.push({ col: nc, row: nr, fromCol: col, fromRow: row });
      }
    };

    visited[0][0] = true;
    enqueue(0, 0);

    while (frontier.length > 0) {
      const i = (Math.random() * frontier.length) | 0;
      const e = frontier[i];
      frontier[i] = frontier[frontier.length - 1];
      frontier.pop();
      if (visited[e.col][e.row]) continue;

      const dc = e.col - e.fromCol;
      const dr = e.row - e.fromRow;
      const dirName = dirNameFromOffset(dc, dr);
      if (dirName) {
        this.passages[e.fromCol][e.fromRow].add(dirName);
        this.passages[e.col][e.row].add(oppositeName(dirName));
      }
      visited[e.col][e.row] = true;
      enqueue(e.col, e.row);
    }
  }
}

// ----- LevelStyle -----------------------------------------------------------
// Colours mirror LevelStyle.swift — one-to-one except expressed as CSS rgb
// strings.  `wallTint` is the lightened bark-tint colour used for sprite
// blending; `wallColor` is reserved for UI accents (markers, menu text).

const rgb  = (r, g, b)        => `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
const rgba = (r, g, b, a)     => `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a})`;

export const LevelStyles = [
  // 1. Enchanted Forest
  {
    name: 'Enchanted Forest',
    backgroundColor: rgb(0.94, 0.90, 0.80),
    wallColor:       rgb(0.36, 0.23, 0.10),
    wallTint:        rgb(0.68, 0.55, 0.40),
    trailColor:      rgb(0.24, 0.55, 0.24),
    footstepColor:   rgba(0.24, 0.55, 0.24, 0.75),
  },
  // 2. Ancient Map
  {
    name: 'Ancient Map',
    backgroundColor: rgb(0.83, 0.71, 0.51),
    wallColor:       rgb(0.24, 0.14, 0.04),
    wallTint:        rgb(0.24, 0.14, 0.04),
    trailColor:      rgb(0.78, 0.53, 0.04),
    footstepColor:   rgba(0.78, 0.53, 0.04, 0.75),
  },
  // 3. Moonlit Grove
  {
    name: 'Moonlit Grove',
    backgroundColor: rgb(0.06, 0.12, 0.06),
    wallColor:       rgb(0.54, 0.72, 0.54),
    wallTint:        rgb(0.54, 0.72, 0.54),
    trailColor:      rgb(0.72, 1.00, 0.50),
    footstepColor:   rgba(0.72, 1.00, 0.50, 0.75),
  },
  // 4. Autumn Trail
  {
    name: 'Autumn Trail',
    backgroundColor: rgb(0.98, 0.92, 0.82),
    wallColor:       rgb(0.42, 0.18, 0.03),
    wallTint:        rgb(0.74, 0.48, 0.30),
    trailColor:      rgb(0.91, 0.38, 0.13),
    footstepColor:   rgba(0.91, 0.38, 0.13, 0.75),
  },
  // 5. Fairy Garden
  {
    name: 'Fairy Garden',
    backgroundColor: rgb(0.91, 0.96, 0.91),
    wallColor:       rgb(0.18, 0.42, 0.18),
    wallTint:        rgb(0.50, 0.68, 0.50),
    trailColor:      rgb(0.88, 0.38, 0.69),
    footstepColor:   rgba(0.88, 0.38, 0.69, 0.75),
  },
  // 6. Stone & Moss
  {
    name: 'Stone & Moss',
    backgroundColor: rgb(0.94, 0.93, 0.91),
    wallColor:       rgb(0.31, 0.28, 0.25),
    wallTint:        rgb(0.62, 0.59, 0.55),
    trailColor:      rgb(0.00, 0.63, 0.38),
    footstepColor:   rgba(0.00, 0.63, 0.38, 0.75),
  },
];

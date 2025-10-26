// ui/canvas.js (WASM DTO renderer)
let canvas, ctx;
let tileSize = 40;

// Basic palette
const colors = {
  floor: '#fafafa',
  wall: '#707070',
  hole: '#060606',
  exit: '#54d39b',          // single style for now (no plate power info in DTO)
  grid: '#d7d7d7',
  player: '#4c3ce7',
  box: '#f39c12',
  heavyBox: '#b76b1e',
  triBox: '#00a7a7',
  fragile: '#86796d'
};

// Hook the redraw callback the host sets (index.html does setRedraw(() => draw(dto)))
let onRedraw = null;
export function setRedraw(fn) { onRedraw = fn; }

export function initCanvas(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
}

/** Draw using the WASM DrawDto */
export function draw(dto) {
  if (!canvas || !dto) return;

  const w = dto.w|0, h = dto.h|0;
  // Fit canvas width to CSS width, height from rows
  const targetW = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1));
  canvas.width = targetW;
  tileSize = Math.max(1, Math.floor(canvas.width / Math.max(1, w)));
  canvas.height = tileSize * Math.max(1, h);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // --- Tiles ---
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = dto.tiles[y * w + x] | 0;
      let fill =
        idx === 1 ? colors.wall :
        idx === 2 ? colors.hole :
        idx === 3 ? colors.exit :
        colors.floor;
      ctx.fillStyle = fill;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);

      // grid line
      ctx.strokeStyle = colors.grid;
      ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  // --- Entities (except player) ---
  // mapping: keep in sync with Exports / dtoToLevel in index.html
  const ET = { BoxBasic:1, BoxHeavy:2, TriBox:3, FragileWall:4 };

  for (const e of dto.entities || []) {
    if (e == null) continue;
    const ex = e.x * tileSize + 4;
    const ey = e.y * tileSize + 4;
    const s  = tileSize - 8;

    if (e.type === ET.TriBox) {
      drawTri(ex - 4, ey - 4, tileSize, e.rot ?? 0, colors.triBox);
    } else if (e.type === ET.FragileWall) {
      // draw like a square with crack overlay (to distinguish from base wall tile)
      ctx.fillStyle = colors.fragile;
      ctx.fillRect(ex, ey, s, s);
      drawFragileOverlay(e.x, e.y);
    } else {
      ctx.fillStyle = (e.type === ET.BoxHeavy) ? colors.heavyBox : colors.box;
      ctx.fillRect(ex, ey, s, s);
    }
  }

  // --- Player ---
  if (dto.player && Number.isInteger(dto.player.x) && Number.isInteger(dto.player.y)) {
    const px = dto.player.x * tileSize + tileSize / 2;
    const py = dto.player.y * tileSize + tileSize / 2;

    // If attached, hint the entryDir with a half-disk / wedge
    if (dto.player.attached && typeof dto.player.entryDir === 'number' && dto.player.entryDir >= 0) {
      const r = tileSize * 0.32;
      const a = dirToAngle(dto.player.entryDir);
      // Draw wedge opposite entry (you "came from" that direction)
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.fillStyle = colors.player;
      // 180° wedge
      ctx.arc(px, py, r, a + Math.PI * 0.15, a + Math.PI * 0.85, false);
      ctx.closePath();
      ctx.fill();
      // thin outline
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    } else {
      // free mode: circle
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.arc(px, py, tileSize * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// No-op animate so existing imports work (we’re not animating WASM effects here)
export function animate(_effects) { /* intentionally empty; all motion comes from engine steps */ }

// ------- helpers -------

function dirToAngle(entryDir) {
  // entryDir: 0=N,1=E,2=S,3=W  -> return angle to point arrow (0: east) style
  switch (entryDir|0) {
    case 0: return -Math.PI/2;      // N
    case 1: return 0;               // E
    case 2: return Math.PI/2;       // S
    case 3: return Math.PI;         // W
    default: return 0;
  }
}

function drawFragileOverlay(x, y) {
  const cellX = x * tileSize, cellY = y * tileSize;
  ctx.save();
  ctx.translate(cellX, cellY);
  ctx.strokeStyle = 'rgba(30, 30, 30, 0.9)';
  ctx.lineWidth = Math.max(2, Math.floor(tileSize * 0.08));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const inset = tileSize * 0.18;
  const crack = [
    { x: inset, y: tileSize * 0.35 },
    { x: inset + tileSize * 0.08, y: tileSize * 0.48 },
    { x: inset + tileSize * 0.22, y: tileSize * 0.28 },
    { x: inset + tileSize * 0.38, y: tileSize * 0.54 },
    { x: inset + tileSize * 0.55, y: tileSize * 0.26 },
    { x: inset + tileSize * 0.74, y: tileSize * 0.58 },
    { x: tileSize - inset, y: tileSize * 0.33 }
  ];
  ctx.beginPath();
  ctx.moveTo(crack[0].x, crack[0].y);
  for (let i = 1; i < crack.length; i++) ctx.lineTo(crack[i].x, crack[i].y);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = Math.max(1, Math.floor(tileSize * 0.035));
  ctx.beginPath();
  ctx.moveTo(crack[0].x, crack[0].y - Math.max(1, Math.floor(tileSize * 0.02)));
  for (let i = 1; i < crack.length; i++) {
    const p = crack[i];
    ctx.lineTo(p.x, p.y - Math.max(1, Math.floor(tileSize * 0.02)));
  }
  ctx.stroke();
  ctx.restore();
}

function drawTri(px, py, size, rot, color) {
  // right triangle inset nicely in the cell
  const inset = Math.max(4, Math.floor(size * 0.12));
  const xL = px + inset, xR = px + size - inset;
  const yT = py + inset, yB = py + size - inset;

  ctx.fillStyle = color || colors.triBox;
  ctx.beginPath();
  // rot: 0..3 = NE, SE, SW, NW (pick a convention)
  switch ((rot|0) % 4) {
    case 0: // NE
      ctx.moveTo(xR, yT); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB);
      break;
    case 1: // SE
      ctx.moveTo(xR, yB); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB);
      break;
    case 2: // SW
      ctx.moveTo(xL, yB); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB);
      break;
    default: // NW
      ctx.moveTo(xL, yT); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB);
      break;
  }
  ctx.closePath();
  ctx.fill();

  // outline
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, Math.floor(size * 0.05));
  ctx.stroke();
}

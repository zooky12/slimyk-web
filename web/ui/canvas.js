// ui/canvas.js (WASM DTO renderer)
let canvas, ctx;
let tileSize = 40;

// Basic palette
const colors = {
  floor: '#fafafa',
  wall: '#707070',
  hole: '#060606',
  exit: '#54d39b',          // Exit (green)
  exitPale: '#9fe8c6',      // optional pale exit when locked
  grid: '#d7d7d7',
  player: '#4c3ce7',
  box: '#f39c12',
  heavyBox: '#b76b1e',
  tippingBox: '#8b5a2b',
  triBox: '#00a7a7',
  fragile: '#86796d',
  spikes: '#c0392b',
  iceBase: '#bfe8ff',       // light blue base
  iceAccent: '#8fd4ff',     // slightly darker accent
  cyan: '#46d7ff',
  buttonGreen: '#54d39b',
  buttonRed: '#e74c3c'
};

// Optional catalog mapping (id -> name) so we can map colors by name
let tileIdToName = null;
let entityIdToName = null;
export function setCatalog(tiles = []) {
  tileIdToName = new Map();
  for (const t of tiles || []) {
    if (t && Number.isInteger(t.id) && typeof t.name === 'string') {
      tileIdToName.set(t.id|0, String(t.name));
    }
  }
}
export function setEntityCatalog(ents = []) {
  entityIdToName = new Map();
  for (const e of ents || []) {
    if (e && Number.isInteger(e.id) && typeof e.name === 'string') {
      entityIdToName.set(e.id|0, String(e.name));
    }
  }
}

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
      // Engine Y=0 is bottom; flip vertically when drawing
      const ey = (h - 1 - y);
      const idx = dto.tiles[y * w + x] | 0;
      const name = (tileIdToName && tileIdToName.get(idx)) || '';
      drawTile(name, x, ey);
    }
  }

  // --- Entities (except player) ---
  for (const e of dto.entities || []) {
    if (e == null) continue;
    const name = entityIdToName && entityIdToName.get(e.type);
    const px = e.x * tileSize;
    const py = (h - 1 - e.y) * tileSize;
    if (name === 'BoxTriangle' || name === 'TriBox') {
      drawTri(px, py, tileSize, e.rot ?? 0, colors.triBox);
    } else if (name === 'BoxTipping') {
      drawBox(px, py, tileSize, colors.tippingBox);
      drawTippingOverlay(px, py, tileSize);
    } else if (name === 'BoxUnattachable') {
      drawBox(px, py, tileSize, '#9aa0b0'); // lighter wall-like color
    } else if (name === 'BoxBasic' || !name) {
      drawBox(px, py, tileSize, colors.box);
    } else {
      // unknown entity: default box
      drawBox(px, py, tileSize, colors.box);
    }
  }

  // --- Player ---
  if (dto.player && Number.isInteger(dto.player.x) && Number.isInteger(dto.player.y)) {
    const cellX = dto.player.x * tileSize;
    const cellY = (h - 1 - dto.player.y) * tileSize;
    const cx = cellX + tileSize / 2;
    const cy = cellY + tileSize / 2;

    if (dto.player.attached && typeof dto.player.entryDir === 'number' && dto.player.entryDir >= 0) {
      // Triangle wedge: base on a cell edge, apex at center (aligns with entryDir)
      const d = (dto.player.entryDir | 0); // 0=N,1=E,2=S,3=W -> rotate -90
      const m = Math.max(1, Math.floor(tileSize * 0.10));
      const left = cellX + m, right = cellX + tileSize - m;
      const top = cellY + m, bottom = cellY + tileSize - m;
      const apexX = cx, apexY = cy;
      let bx1, by1, bx2, by2; // base endpoints
      if (d === 0) { // top edge
        bx1 = left; by1 = top; bx2 = right; by2 = top;
      } else if (d === 1) { // right edge
        bx1 = right; by1 = top; bx2 = right; by2 = bottom;
      } else if (d === 2) { // bottom edge
        bx1 = left; by1 = bottom; bx2 = right; by2 = bottom;
      } else { // left edge
        bx1 = left; by1 = top; bx2 = left; by2 = bottom;
      }
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(bx1, by1);
      ctx.lineTo(bx2, by2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    } else {
      // free mode: circle
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.32, 0, Math.PI * 2);
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

  // Adjust orientation (fix 180° flip): add 2 modulo 4
  const r = ((rot|0) + 2) % 4;

  ctx.fillStyle = color || colors.triBox;
  ctx.beginPath();
  // rot: 0..3 = NE, SE, SW, NW (pick a convention)
  switch (r) {
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

function drawBox(px, py, size, color) {
  const inset = 4;
  ctx.fillStyle = color || colors.box;
  ctx.fillRect(px + inset, py + inset, size - inset*2, size - inset*2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeRect(px + inset, py + inset, size - inset*2, size - inset*2);
}

function drawTippingOverlay(px, py, size) {
  // simple diagonal stripe to suggest tipping behavior
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(2, Math.floor(size * 0.06));
  const inset = 8;
  ctx.beginPath();
  ctx.moveTo(px + inset, py + size - inset);
  ctx.lineTo(px + size - inset, py + inset);
  ctx.stroke();
}

// ---- Tile dictionary rendering ----
function drawTileByFill(x, y, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
  ctx.strokeStyle = colors.grid;
  ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
}

function drawSpikes(x, y, baseFill, spikeFill) {
  drawTileByFill(x, y, baseFill);
  const s = tileSize;
  const px = x * s, py = y * s;
  const tri = (cx, cy, sz)=>{
    const h = sz;
    ctx.fillStyle = spikeFill;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h/2);
    ctx.lineTo(cx - h/2, cy + h/2);
    ctx.lineTo(cx + h/2, cy + h/2);
    ctx.closePath();
    ctx.fill();
  };
  const m = Math.max(2, Math.floor(s*0.12));
  const c = Math.floor(s/2);
  tri(px + m + Math.floor(s*0.15), py + m + Math.floor(s*0.15), m);
  tri(px + s - m - Math.floor(s*0.15), py + m + Math.floor(s*0.15), m);
  tri(px + c, py + c, m);
  tri(px + m + Math.floor(s*0.15), py + s - m - Math.floor(s*0.15), m);
  tri(px + s - m - Math.floor(s*0.15), py + s - m - Math.floor(s*0.15), m);
}

function drawGrill(x, y, baseFill, barFill) {
  // Hash '#': two vertical bars + two horizontal bars (with margins)
  drawTileByFill(x, y, baseFill);
  const s = tileSize;
  const px = x * s, py = y * s;
  const w = Math.max(2, Math.floor(s * 0.08)); // bar width
  const m = Math.max(2, Math.floor(s * 0.18)); // margin from edges
  const span = s - 2 * m;
  ctx.fillStyle = barFill;
  // vertical bars (left/right)
  ctx.fillRect(px + m,         py + m, w, span);
  ctx.fillRect(px + s - m - w, py + m, w, span);
  // horizontal bars (top/bottom)
  ctx.fillRect(px + m, py + m,         span, w);
  ctx.fillRect(px + m, py + s - m - w, span, w);
}

function drawSlimPath(x, y, baseFill, dotFill) {
  // Four small squares on the corners
  drawTileByFill(x, y, baseFill);
  const s = tileSize;
  const px = x * s, py = y * s;
  const d = Math.max(2, Math.floor(s * 0.14)); // square size
  const m = Math.max(2, Math.floor(s * 0.10)); // margin from corner
  ctx.fillStyle = dotFill;
  // top-left, top-right, bottom-right, bottom-left
  ctx.fillRect(px + m,            py + m,            d, d);
  ctx.fillRect(px + s - m - d,    py + m,            d, d);
  ctx.fillRect(px + s - m - d,    py + s - m - d,    d, d);
  ctx.fillRect(px + m,            py + s - m - d,    d, d);
}

function drawButtonRing(x, y, baseFill, ringColor) {
  drawTileByFill(x, y, baseFill);
  const s = tileSize;
  const cx = x * s + s/2, cy = y * s + s/2;
  const r = Math.max(3, s*0.28);
  const w = Math.max(2, s*0.10);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = w;
  ctx.stroke();
}

function drawTile(nameRaw, x, y) {
  const n = String(nameRaw || '').toLowerCase();
  if (!n) {
    drawTileByFill(x, y, colors.floor);
    return;
  }
  // Base simple mappings first
  if (n === 'floor') return drawTileByFill(x, y, colors.floor);
  if (n === 'wall')  return drawTileByFill(x, y, colors.wall);
  if (n === 'hole')  return drawTileByFill(x, y, colors.hole);
  if (n === 'exit')  return drawTileByFill(x, y, colors.exit);
  if (n === 'iceexit') return drawTileByFill(x, y, colors.cyan);

  // Breakable wall tile (wall base + darker diagonal)
  if (n.includes('fragile') || n.includes('break')) {
    drawTileByFill(x, y, colors.wall);
    // darker diagonal overlay
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(2, Math.floor(tileSize * 0.06));
    const px = x * tileSize, py = y * tileSize, inset = 6;
    ctx.beginPath();
    ctx.moveTo(px + inset, py + tileSize - inset);
    ctx.lineTo(px + tileSize - inset, py + inset);
    ctx.stroke();
    return;
  }

  // Spikes
  if (n === 'spike') return drawSpikes(x, y, colors.floor, colors.wall);
  if (n === 'spikehole') return drawSpikes(x, y, colors.hole, colors.wall);
  if (n === 'icespike') return drawSpikes(x, y, colors.iceBase, colors.wall);

  // Grill
  if (n === 'grill') return drawGrill(x, y, colors.hole, colors.floor);
  if (n === 'icegrill') return drawGrill(x, y, colors.hole, colors.iceAccent);

  // SlimPath
  if (n === 'slimpath') return drawSlimPath(x, y, colors.floor, colors.wall);
  if (n === 'slimpathhole') return drawSlimPath(x, y, colors.hole, colors.wall);
  if (n === 'iceslimpath') return drawSlimPath(x, y, colors.iceBase, colors.wall);

  // Ice base
  if (n === 'ice') return drawTileByFill(x, y, colors.iceBase);

  // Buttons (ring)
  if (n === 'buttonallowexit') return drawButtonRing(x, y, colors.floor, colors.buttonGreen);
  if (n === 'buttontoggle')    return drawButtonRing(x, y, colors.floor, colors.buttonRed);

  // Default heuristic
  if (n.includes('hole')) return drawTileByFill(x, y, colors.hole);
  if (n.includes('wall') && !n.includes('fragile')) return drawTileByFill(x, y, colors.wall);
  return drawTileByFill(x, y, colors.floor);
}



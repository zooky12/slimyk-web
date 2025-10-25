// ui/canvas.js
//import { computeExitActive } from '../core/goals.js';
//import { EntityTypes } from '../core/entities.js';
//import { firstEntityAt } from '../core/state.js';

let canvas;
let ctx;
let tileSize = 40;
// canvas.js
let _cv, _ctx, _cell = 32, _gridW = 0, _gridH = 0;

export function canvasInit(canvasEl) {
  _cv = canvasEl;
  _ctx = _cv.getContext('2d', { alpha: false });
}

export function canvasResizeToGrid(w, h, cell = 32) {
  _gridW = w; _gridH = h; _cell = cell;
  _cv.width = Math.max(1, w * _cell);
  _cv.height = Math.max(1, h * _cell);
}

const toScreenY = (gy, H) => (H - 1 - gy); // flip Y (engine origin bottom-left)

export function canvasDrawState(s) {
  if (!s || !s.w || !s.h) return;
  if (s.w !== _gridW || s.h !== _gridH) canvasResizeToGrid(s.w, s.h, _cell);

  _ctx.fillStyle = '#111';
  _ctx.fillRect(0, 0, _cv.width, _cv.height);

  // tiles
  for (let gy = 0; gy < s.h; gy++) {
    const sy = toScreenY(gy, s.h);
    for (let gx = 0; gx < s.w; gx++) {
      const t = s.tiles[gy * s.w + gx] ?? 0;
      // simple palette (extend later)
      _ctx.fillStyle = (t===1) ? '#2b2b2b' : (t===2) ? '#4fa3d9' : (t===3) ? '#5fbf5f' : '#d9d9d9';
      _ctx.fillRect(gx*_cell, sy*_cell, _cell-1, _cell-1);
    }
  }

  // entities
  const ents = Array.isArray(s.entities) ? s.entities : [];
  _ctx.fillStyle = '#c68b2d';
  for (const e of ents) {
    const sy = toScreenY(e.y, s.h);
    _ctx.fillRect(e.x*_cell+2, sy*_cell+2, _cell-4, _cell-4);
    // if you have sprites later, drawImage here using e.type/e.rot
  }

  // player
  const p = s.player ?? { x:0, y:0 };
  const py = toScreenY(p.y, s.h);
  _ctx.fillStyle = '#e43b44';
  _ctx.fillRect(p.x*_cell+3, py*_cell+3, _cell-6, _cell-6);
}


const colors = {
  floor: '#fafafa',
  wall: '#707070',
  hole: '#060606',
  exitActive: '#3cb371',
  exitInactive: '#bfecc4',
  player: '#4c3ce7',
  box: '#f39c12',
  heavyBox: '#b76b1e',
  triBox: '#00a7a7',
  fragile: '#666666',
  grid: '#d7d7d7'
};

const tileBaseColors = {
  floor: colors.floor,
  wall: colors.wall,
  hole: colors.hole,
  spikes: '#f2f2f2',
  holeSpikes: colors.hole,
  pressurePlate: '#f5ecda',
  grile: '#0b101d',
  slimPathFloor: '#eef0f8',
  slimPathHole: colors.hole,
  fragileWall: '#86796d'
};

const overlayTiles = new Set([
  'spikes',
  'holeSpikes',
  'grile',
  'pressurePlate',
  'slimPathFloor',
  'slimPathHole',
  'fragileWall'
]);

export function initCanvas(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
}

function drawInboxOverlay(x, y, entryDir) {
  const px = x * tileSize;
  const py = y * tileSize;
  const inset = 4;
  const w = tileSize - inset * 2;
  const h = tileSize - inset * 2;

  ctx.save();
  ctx.fillStyle = colors.player;

  const dx = entryDir?.dx || 0;
  const dy = entryDir?.dy || 0;

  if (dx === 1 && dy === 0) {
    ctx.fillRect(px + inset, py + inset, Math.floor(w / 2), h);
  } else if (dx === -1 && dy === 0) {
    ctx.fillRect(px + inset + Math.floor(w / 2), py + inset, Math.ceil(w / 2), h);
  } else if (dx === 0 && dy === 1) {
    ctx.fillRect(px + inset, py + inset, w, Math.floor(h / 2));
  } else if (dx === 0 && dy === -1) {
    ctx.fillRect(px + inset, py + inset + Math.floor(h / 2), w, Math.ceil(h / 2));
  } else {
    const r = Math.floor(Math.min(w, h) * 0.28);
    ctx.beginPath();
    ctx.arc(px + inset + w / 2, py + inset + h / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#333';
  ctx.strokeRect(px + inset, py + inset, w, h);
  ctx.restore();
}

// Triangle helpers
function longDirsForOrient(orient) {
  switch (orient) {
    case 'NE': return [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
    case 'NW': return [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
    case 'SE': return [{ dx: 0, dy: -1 }, { dx: -1, dy: 0 }];
    case 'SW': return [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }];
    default:   return [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  }
}
function dirEq(a,b){ return !!a && !!b && a.dx===b.dx && a.dy===b.dy; }

function drawTriPlayerOverlay(x, y, orient, entryDir) {
  const px = x * tileSize;
  const py = y * tileSize;
  const inset = Math.max(4, Math.floor(tileSize * 0.12));
  const xL = px + inset, xR = px + tileSize - inset;
  const yT = py + inset, yB = py + tileSize - inset;

  // Build triangle clip
  ctx.save();
  ctx.beginPath();
  if (orient === 'NE') { ctx.moveTo(xR, yT); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
  else if (orient === 'NW') { ctx.moveTo(xL, yT); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
  else if (orient === 'SE') { ctx.moveTo(xR, yB); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
  else /* SW */ { ctx.moveTo(xL, yB); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
  ctx.closePath();
  ctx.clip();

  const longDirs = longDirsForOrient(orient);
  const enteredFromShort = longDirs.some(ld => dirEq(ld, entryDir));
  ctx.strokeStyle = colors.player;
  ctx.fillStyle = colors.player;

  if (!enteredFromShort) {
    // Along hypotenuse: thick diagonal stroke inside triangle
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(6, Math.floor(tileSize * 0.28));
    let x1, y1, x2, y2;
    if (orient === 'NE' || orient === 'SW') { x1 = xL; y1 = yT; x2 = xR; y2 = yB; }
    else { x1 = xR; y1 = yT; x2 = xL; y2 = yB; }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else {
    // Hug the short side indicated by entryDir
    const thickness = Math.max(6, Math.floor(tileSize * 0.28));
    if (entryDir.dy === 1) ctx.fillRect(xL, yT, xR - xL, thickness); // North
    if (entryDir.dy === -1) ctx.fillRect(xL, yB - thickness, xR - xL, thickness); // South
    if (entryDir.dx === -1) ctx.fillRect(xR - thickness, yT, thickness, yB - yT); // East
    if (entryDir.dx === 1) ctx.fillRect(xL, yT, thickness, yB - yT); // West
  }

  ctx.restore();
}

function drawTileOverlay(type, x, y) {
  const px = x * tileSize;
  const py = y * tileSize;

  ctx.save();
  ctx.translate(px, py);

  if (type === 'spikes' || type === 'holeSpikes') {
    const count = 5;
    const spacing = tileSize / (count + 1);
    const triW = Math.max(4, Math.floor(tileSize * 0.14));
    const triH = Math.max(6, Math.floor(tileSize * 0.18));
    const topY = tileSize * 0.28;
    ctx.fillStyle = 'rgba(40, 44, 66, 0.92)';
    for (let i = 1; i <= count; i++) {
      const cx = spacing * i;
      ctx.beginPath();
      ctx.moveTo(cx, topY);
      ctx.lineTo(cx - triW / 2, topY + triH);
      ctx.lineTo(cx + triW / 2, topY + triH);
      ctx.closePath();
      ctx.fill();
    }
  } else if (type === 'grile') {
    ctx.strokeStyle = 'rgba(235, 240, 255, 0.82)';
    ctx.lineWidth = Math.max(2, Math.floor(tileSize * 0.12));
    ctx.lineCap = 'round';
    const inset = tileSize * 0.22;
    const x1 = inset;
    const x2 = tileSize - inset;
    const y1 = inset;
    const y2 = tileSize - inset;
    ctx.beginPath();
    ctx.moveTo(x1 + (x2 - x1) / 3, y1);
    ctx.lineTo(x1 + (x2 - x1) / 3, y2);
    ctx.moveTo(x1 + (x2 - x1) * 2 / 3, y1);
    ctx.lineTo(x1 + (x2 - x1) * 2 / 3, y2);
    ctx.moveTo(x1, y1 + (y2 - y1) / 3);
    ctx.lineTo(x2, y1 + (y2 - y1) / 3);
    ctx.moveTo(x1, y1 + (y2 - y1) * 2 / 3);
    ctx.lineTo(x2, y1 + (y2 - y1) * 2 / 3);
    ctx.stroke();
  } else if (type === 'pressurePlate') {
    const inset = tileSize * 0.24;
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = Math.max(3, Math.floor(tileSize * 0.14));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(inset, inset);
    ctx.lineTo(tileSize - inset, tileSize - inset);
    ctx.moveTo(tileSize - inset, inset);
    ctx.lineTo(inset, tileSize - inset);
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = Math.max(1, Math.floor(tileSize * 0.05));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.arc(tileSize / 2, tileSize / 2, tileSize * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'slimPathFloor' || type === 'slimPathHole') {
    const squareSize = Math.max(3, Math.floor(tileSize * 0.18));
    const offset = Math.max(2, Math.floor(tileSize * 0.1));
    const corners = [
      [offset, offset],
      [tileSize - offset - squareSize, offset],
      [offset, tileSize - offset - squareSize],
      [tileSize - offset - squareSize, tileSize - offset - squareSize]
    ];
    ctx.fillStyle = colors.wall;
    for (const [dx, dy] of corners) {
      ctx.fillRect(dx, dy, squareSize, squareSize);
    }
  } else if (type === 'fragileWall') {
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
  }

  ctx.restore();
}

export function draw(state) {
  if (!canvas) return;

  const rows = state.size.rows;
  const cols = state.size.cols;
  // Adjust canvas to grid aspect: width from CSS, height derived from rows/cols
  const targetW = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1));
  canvas.width = targetW;
  tileSize = Math.max(1, Math.floor(canvas.width / Math.max(1, cols)));
  canvas.height = tileSize * Math.max(1, rows);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const exitActive = computeExitActive(state);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const t = state.base[y][x] || 'floor';

      let bg = colors.floor;
      if (t === 'exit') {
        bg = exitActive ? colors.exitActive : colors.exitInactive;
      } else if (Object.prototype.hasOwnProperty.call(tileBaseColors, t)) {
        bg = tileBaseColors[t];
      } else if (t === 'hole') {
        bg = colors.hole;
      } else if (t === 'wall') {
        bg = colors.wall;
      }

      ctx.fillStyle = bg;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      ctx.strokeStyle = colors.grid;
      ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);

      if (overlayTiles.has(t)) drawTileOverlay(t, x, y);
    }
  }

  const player = state.entities.find(e => e.type === EntityTypes.player);

  // Build suppression set from active animations so we don't double-draw
  const suppressed = new Set();
  for (const tw of _anims.tweens) {
    if (tw.kind === 'moveBox') suppressed.add(`${tw.entityType}@${tw.to.x},${tw.to.y}`);
    if (tw.kind === 'movePlayer' || tw.kind === 'launchPlayer') _anims.suppressPlayer = true;
    if (tw.kind === 'fallShrink' && tw.entityType === 'player') _anims.suppressPlayer = true;
    if (tw.kind === 'fallShrink' && tw.entityType !== 'player') {
      // hide player if they are in the same tile as a falling box
      const p = player;
      if (p && p.x === tw.pos.x && p.y === tw.pos.y) _anims.suppressPlayer = true;
    }
  }

  for (const entity of state.entities) {
    if (entity.type === EntityTypes.player) continue;
    if (suppressed.has(`${entity.type}@${entity.x},${entity.y}`)) continue;
    const color = entity.type === EntityTypes.box
      ? colors.box
      : (entity.type === EntityTypes.heavyBox ? colors.heavyBox : (entity.type === EntityTypes.triBox ? colors.triBox : colors.fragile));
    const ex = entity.x * tileSize + 4;
    const ey = entity.y * tileSize + 4;
    const ew = tileSize - 8;
    const eh = tileSize - 8;
    if (entity.type === EntityTypes.triBox) {
      // Draw right triangle with right angle located at the corner given by its short sides.
      // orient denotes the short sides; e.g., 'SE' => short legs on South and East => right angle at bottom-right.
      const orient = (entity.state && entity.state.orient) || 'NE';
      const px = entity.x * tileSize;
      const py = entity.y * tileSize;
      const inset = Math.max(4, Math.floor(tileSize * 0.12));
      const xL = px + inset, xR = px + tileSize - inset;
      const yT = py + inset, yB = py + tileSize - inset;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (orient === 'NE') {
        // short legs on North and East => right angle at top-right (TR)
        ctx.moveTo(xR, yT); // TR
        ctx.lineTo(xL, yT); // TL
        ctx.lineTo(xR, yB); // BR
      } else if (orient === 'NW') {
        // short legs on North and West => right angle at top-left (TL)
        ctx.moveTo(xL, yT); // TL
        ctx.lineTo(xR, yT); // TR
        ctx.lineTo(xL, yB); // BL
      } else if (orient === 'SE') {
        // short legs on South and East => right angle at bottom-right (BR)
        ctx.moveTo(xR, yB); // BR
        ctx.lineTo(xR, yT); // TR
        ctx.lineTo(xL, yB); // BL
      } else { // 'SW'
        // short legs on South and West => right angle at bottom-left (BL)
        ctx.moveTo(xL, yB); // BL
        ctx.lineTo(xL, yT); // TL
        ctx.lineTo(xR, yB); // BR
      }
      ctx.closePath();
      ctx.fill();
      // Outline
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1, Math.floor(tileSize * 0.05));
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(ex, ey, ew, eh);
    }

    // Fragile wall entity: draw crack overlay to differentiate from normal walls
    if (entity.type === EntityTypes.fragileWall) {
      ctx.save();
      ctx.translate(entity.x * tileSize, entity.y * tileSize);
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
  }

  if (!player) return;

  if (!_anims.suppressPlayer) {
    if (player.state?.mode === 'inbox') {
      // Choose overlay by box type under player
      const under = firstEntityAt(state, player.x, player.y, (e) => e.type === EntityTypes.box || e.type === EntityTypes.heavyBox || e.type === EntityTypes.triBox);
      if (under && under.type === EntityTypes.triBox) {
        const orient = (under.state && under.state.orient) || 'NE';
        drawTriPlayerOverlay(player.x, player.y, orient, player.state.entryDir);
      } else if (under && under.type === EntityTypes.heavyBox && (player.state.entryDir?.dx === 0 && player.state.entryDir?.dy === 0)) {
        // Heavy neutral: full blue square overlay
        const px = player.x * tileSize + 4;
        const py = player.y * tileSize + 4;
        const s = tileSize - 8;
        ctx.fillStyle = colors.player;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(px, py, s, s);
      } else {
        drawInboxOverlay(player.x, player.y, player.state.entryDir);
      }
    } else {
      ctx.save();
      ctx.translate(_anims.bumpOffset.x, _anims.bumpOffset.y);
      ctx.fillStyle = colors.player;
      const cx = player.x * tileSize + tileSize / 2;
      const cy = player.y * tileSize + tileSize / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, tileSize * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Draw animated overlays (moving boxes and player)
  for (const tw of _anims.tweens) {
    const t = Math.max(0, Math.min(1, tw.t));
    if (tw.kind === 'moveBox') {
      const x = (tw.from.x + (tw.to.x - tw.from.x) * t) * tileSize + 4;
      const y = (tw.from.y + (tw.to.y - tw.from.y) * t) * tileSize + 4;
      const s = tileSize - 8;
      ctx.fillStyle = tw.color;
      if (tw.entityType === EntityTypes.triBox) {
        // Draw triangle at tweened position using provided orient if any
        const orient = tw.orient || 'NE';
        const px2 = x - 4; // reverse +4 inset
        const py2 = y - 4;
        const inset = Math.max(4, Math.floor(tileSize * 0.12));
        const xL = px2 + inset, xR = px2 + tileSize - inset;
        const yT = py2 + inset, yB = py2 + tileSize - inset;
        ctx.beginPath();
        if (orient === 'NE') { ctx.moveTo(xR, yT); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
        else if (orient === 'NW') { ctx.moveTo(xL, yT); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
        else if (orient === 'SE') { ctx.moveTo(xR, yB); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
        else { ctx.moveTo(xL, yB); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x, y, s, s);
      }
      } else if (tw.kind === 'movePlayer' || tw.kind === 'launchPlayer') {
      const x = (tw.from.x + (tw.to.x - tw.from.x) * t) * tileSize + tileSize / 2 + (tw.kind === 'movePlayer' ? _anims.bumpOffset.x : 0);
      const y = (tw.from.y + (tw.to.y - tw.from.y) * t) * tileSize + tileSize / 2 + (tw.kind === 'movePlayer' ? _anims.bumpOffset.y : 0);
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.arc(x, y, tileSize * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else if (tw.kind === 'fallShrink') {
      // Shrink and darken into hole; use exact icon for entity type
      const cellX = tw.pos.x * tileSize;
      const cellY = tw.pos.y * tileSize;
      const cx = cellX + tileSize / 2;
      const cy = cellY + tileSize / 2;
      const k = 1 - t; // scale
      const darkA = 0.35 + 0.45 * t; // more dark over time
      ctx.save();
      if (tw.entityType === 'player') {
        // Player circle
        ctx.globalAlpha = Math.max(0.05, 1 - 0.7 * t);
        ctx.fillStyle = colors.player;
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize * 0.32 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = darkA;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize * 0.32 * k, 0, Math.PI * 2);
        ctx.fill();
      } else if (tw.entityType === EntityTypes.triBox) {
        // Triangle, draw full-size then scale around center
        const inset = Math.max(4, Math.floor(tileSize * 0.12));
        const xL = cellX + inset, xR = cellX + tileSize - inset;
        const yT = cellY + inset, yB = cellY + tileSize - inset;
        const orient = tw.orient || 'NE';
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
        ctx.globalAlpha = Math.max(0.05, 1 - 0.7 * t);
        ctx.fillStyle = colors.triBox;
        ctx.beginPath();
        if (orient === 'NE') { ctx.moveTo(xR, yT); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
        else if (orient === 'NW') { ctx.moveTo(xL, yT); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
        else if (orient === 'SE') { ctx.moveTo(xR, yB); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
        else { ctx.moveTo(xL, yB); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = darkA;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        if (orient === 'NE') { ctx.moveTo(xR, yT); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
        else if (orient === 'NW') { ctx.moveTo(xL, yT); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
        else if (orient === 'SE') { ctx.moveTo(xR, yB); ctx.lineTo(xR, yT); ctx.lineTo(xL, yB); }
        else { ctx.moveTo(xL, yB); ctx.lineTo(xL, yT); ctx.lineTo(xR, yB); }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        // Box/heavy as square, drawn via scale transform so it shrinks to center
        const inset = 4;
        const bx = cellX + inset;
        const by = cellY + inset;
        const s = tileSize - inset * 2;
        const color = tw.entityType === EntityTypes.heavyBox ? colors.heavyBox : colors.box;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
        ctx.globalAlpha = Math.max(0.05, 1 - 0.7 * t);
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, s, s);
        ctx.globalAlpha = darkA;
        ctx.fillStyle = '#000';
        ctx.fillRect(bx, by, s, s);
        ctx.restore();
      }
      ctx.restore();
    }
  }
  // Particles on top
  drawParticles();
}

// Animation system
const _anims = {
  tweens: [], // { kind, from, to, t, dt, duration, entityType?, color?, orient? }
  running: false,
  suppressPlayer: false,
  bumpOffset: { x: 0, y: 0 },
  redraw: null,
  particles: [] // { x,y, vx,vy, life, color, size }
};

export function setRedraw(fn) { _anims.redraw = fn; }

function easeOutCubic(u){ return 1 - Math.pow(1-u, 3); }
function easeInOutQuad(u){ return u<0.5 ? 2*u*u : 1 - Math.pow(-2*u+2,2)/2; }

function ensureLoop(){
  if (_anims.running) return;
  _anims.running = true;
  let last = performance.now();
  function frame(now){
    const dt = Math.min(32, now - last); // cap dt
    last = now;
    _anims.suppressPlayer = false;
    // advance tweens
    _anims.tweens = _anims.tweens.filter(tw => {
      tw.elapsed = (tw.elapsed || 0) + dt;
      const u = Math.max(0, Math.min(1, tw.elapsed / tw.duration));
      tw.t = tw.ease ? tw.ease(u) : u;
      return u < 1;
    });

    // bump offset decay
    if (_anims.bumpDecay) {
      _anims.bumpDecay -= dt;
      const f = Math.max(0, _anims.bumpDecay / _anims.bumpDuration);
      _anims.bumpOffset.x = _anims.bumpBase.x * f;
      _anims.bumpOffset.y = _anims.bumpBase.y * f;
      if (_anims.bumpDecay <= 0) { _anims.bumpOffset.x = 0; _anims.bumpOffset.y = 0; _anims.bumpDecay = 0; }
    }

    // advance particles
    if (_anims.particles && _anims.particles.length) {
      for (const p of _anims.particles) {
        p.life -= dt;
        p.x += p.vx * (dt / 1000);
        p.y += p.vy * (dt / 1000);
        p.vy += (p.ay || 0) * (dt / 1000);
      }
      _anims.particles = _anims.particles.filter(p => p.life > 0);
    }

    if (_anims.redraw) _anims.redraw();
    if (_anims.tweens.length || _anims.bumpDecay > 0) {
      requestAnimationFrame(frame);
    } else {
      // keep loop running briefly if particles exist
      if (_anims.particles && _anims.particles.length) {
        requestAnimationFrame(frame);
      } else {
        _anims.running = false;
      }
    }
  }
  requestAnimationFrame(frame);
}

export function animate(effects) {
  const toAdd = [];
  let hasPlayerLaunch = false;
  let playerLaunchFrom = null, playerLaunchTo = null;
  // Build tweens from effects
  for (const ef of effects || []) {
    if (ef.type === 'entityMoved') {
      if (ef.entityType === EntityTypes.player) {
        // Player step move (skip if a launch effect also exists)
        if (!hasPlayerLaunch) {
          toAdd.push({ kind: 'movePlayer', from: ef.from, to: ef.to, duration: 90, ease: easeOutCubic });
        }
      } else if (ef.entityType === EntityTypes.box || ef.entityType === EntityTypes.heavyBox || ef.entityType === EntityTypes.triBox) {
        const color = ef.entityType === EntityTypes.box ? colors.box : (ef.entityType === EntityTypes.heavyBox ? colors.heavyBox : colors.triBox);
        toAdd.push({ kind: 'moveBox', entityType: ef.entityType, color, orient: ef.orient, from: ef.from, to: ef.to, duration: 90, ease: easeOutCubic });
      }
    } else if (ef.type === 'playerLaunched') {
      hasPlayerLaunch = true; playerLaunchFrom = ef.from; playerLaunchTo = ef.to;
      const duration = 100; // cap to 0.1s max
      toAdd.push({ kind: 'launchPlayer', from: ef.from, to: ef.to, duration, ease: easeInOutQuad });
    } else if (ef.type === 'bump') {
      // 1-tap bump shake of player sprite
      const amp = Math.max(2, Math.floor(tileSize * 0.08));
      _anims.bumpBase = { x: (ef.dir?.dx||0) * amp, y: (ef.dir?.dy||0) * amp };
      _anims.bumpDuration = 80; _anims.bumpDecay = 80;
    } else if (ef.type === 'boxFell') {
      // quick fall ring burst + shrink/darken, preserve box icon and orientation
      spawnParticlesBurst(ef.pos, 16, 220, 100, ['#e8e1d1','#ffffff','#b3b3b3']);
      toAdd.push({ kind: 'fallShrink', entityType: ef.boxType || 'box', orient: ef.orient, pos: ef.pos, duration: 500, ease: easeInOutQuad });
    } else if (ef.type === 'heavyNeutral') {
      // pulse particles to show neutral toggle
      const cols = ef.neutral ? ['#4c3ce7'] : ['#7faaff'];
      spawnParticlesBurst(ef.pos, 10, 240, 90, cols);
    } else if (ef.type === 'levelWin') {
      spawnParticlesBurst(ef.pos || {x:0,y:0}, 28, 280, 100, ['#62f2c1','#7faaff','#ffd166','#ff6b6b']);
    } else if (ef.type === 'playerFell') {
      spawnParticlesBurst(ef.pos, 20, 240, 100, ['#ffffff','#c1c1c1']);
      toAdd.push({ kind: 'fallShrink', entityType: 'player', pos: ef.pos, duration: 100, ease: easeInOutQuad });
    }
  }

  // If playerLaunch present, remove any pending movePlayer for same segment
  if (hasPlayerLaunch) {
    // filter out any movePlayer we just added that matches this segment
    for (let i = toAdd.length - 1; i >= 0; i--) {
      const tw = toAdd[i];
      if (tw.kind === 'movePlayer' && tw.from && tw.to && playerLaunchFrom && playerLaunchTo) {
        if (tw.from.x === playerLaunchFrom.x && tw.from.y === playerLaunchFrom.y && tw.to.x === playerLaunchTo.x && tw.to.y === playerLaunchTo.y) {
          toAdd.splice(i, 1);
        }
      }
    }
  }

  _anims.tweens.push(...toAdd);
  if (toAdd.length || (_anims.particles && _anims.particles.length)) ensureLoop();
}

function spawnParticlesBurst(cell, count, speed, life, colorsList) {
  const baseX = cell.x * tileSize + tileSize / 2;
  const baseY = cell.y * tileSize + tileSize / 2;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = speed * (0.6 + Math.random() * 0.8);
    _anims.particles.push({
      x: baseX,
      y: baseY,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      ay: 0,
      life: life * (0.6 + Math.random() * 0.6),
      color: colorsList[Math.floor(Math.random() * colorsList.length)],
      size: Math.max(2, Math.floor(tileSize * 0.06))
    });
  }
}

function drawParticles() {
  for (const p of _anims.particles) {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
}

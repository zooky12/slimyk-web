// web/main.js — boots wasm-adapter, creates a session, wires UI
import { initWasm } from './core/wasm-adapter.js';
import { initCanvas, draw, setCatalog, setEntityCatalog } from './ui/canvas.js';
import { setupHUD } from './ui/hud.js';
import { setupBuildUI, populateBuildChips } from './ui/build.js';
import { loadWorldList, loadLevelListForWorld, loadWorldLevel, exportLevel, importLevel } from './ui/io.js';

// --- Demo level (Loader schema) ---
const DEMO = {
  tileGrid: [
    ["wall","wall","wall","wall","wall","wall","wall","wall","wall","wall","wall"],
    ["wall","hole","hole","hole","hole","hole","hole","hole","hole","hole","wall"],
    ["wall","hole","floor","floor","floor","floor","floor","floor","floor","hole","wall"],
    ["wall","hole","floor","hole","wall","exit","wall","hole","floor","hole","wall"],
    ["wall","hole","floor","hole","floor","floor","floor","hole","floor","hole","wall"],
    ["wall","hole","floor","hole","floor","hole","floor","hole","floor","hole","wall"],
    ["wall","hole","floor","hole","floor","hole","floor","hole","floor","hole","wall"],
    ["wall","hole","floor","hole","floor","hole","floor","hole","floor","hole","wall"],
    ["wall","wall","floor","hole","floor","floor","floor","hole","floor","hole","wall"],
    ["wall","hole","hole","hole","hole","hole","hole","hole","hole","hole","wall"],
    ["spike","wall","wall","wall","wall","wall","wall","wall","wall","wall","wall"]
  ],
  entities: [
    { type: 'PlayerSpawn', x: 5, y: 8 },
    { type: 'BoxBasic', x: 8, y: 8 },
    { type: 'BoxBasic', x: 5, y: 4 },
    { type: 'BoxBasic', x: 2, y: 4 }
  ]
};

// Init the wasm engine once
const raw = await initWasm();
const sid = raw.initLevel(DEMO);

// Build id maps for UI convenience
function makeIndex(arr, keyName = 'name', idName = 'id') {
  const m = Object.create(null);
  for (const it of (arr || [])) {
    const k = (it[keyName] ?? '').toString();
    const v = it[idName];
    if (k) {
      m[k] = v;
      const kl = k.toLowerCase();
      if (!(kl in m)) m[kl] = v; // case-insensitive lookup support
    }
  }
  return m;
}

const tilesCatalog = raw.getTiles();
const entsCatalog = raw.getEntities();
try { console.table && console.table(tilesCatalog); } catch { try { console.log('Tile catalog:', tilesCatalog); } catch {} }
const ids = {
  tile: makeIndex(tilesCatalog, 'name', 'id'),
  entity: makeIndex(entsCatalog,  'name', 'id'),
  orient: { N:0, E:1, S:2, W:3, NE:4, SE:5, SW:6, NW:7 }
};
// Reverse maps for id -> name (needed to build LevelDTO)
const tileIdToName = (() => { const m = Object.create(null); for (const t of tilesCatalog) m[t.id] = t.name; return m; })();
const entIdToName  = (() => { const m = Object.create(null); for (const e of entsCatalog) m[e.id] = e.name; return m; })();

// Session-bound wrappers that call the adapter with `sid`
const api = {
  ...raw,
  ids,
  getState: () => raw.getState(sid),
  step: (dir) => raw.step(sid, dir),
  undo: () => raw.undo(sid),
  reset: () => raw.reset(sid),
  applyEdit: (kind, x, y, type, rot) => raw.applyEdit(sid, kind, x, y, type ?? 0, rot ?? 0),
  setState: (level) => raw.setState(sid, level),
  commitBaseline: () => (typeof raw.commitBaseline === 'function' ? raw.commitBaseline(sid) : undefined),
  resize: (add, dir) => resizeLocal(add, dir),
};

// Local resize fallback: build a LevelDTO from current state, transform, then setState
function resizeLocal(add, dir) {
  try {
    const dto = api.getState();
    const w = dto.w|0, h = dto.h|0;
    const dxOff = add ? (dir === 3 ? -1 : 0) : (dir === 3 ? +1 : 0); // 3=W/left
    // For vertical: add up => dyOff=0 (wall row at top), add down => dyOff=-1 (wall row at bottom)
    const dyOff = add ? (dir === 2 ? -1 : 0) : (dir === 0 ? +1 : 0); // 0=N/up, 2=S/down
    const nW = w + ((dir === 1 || dir === 3) ? (add ? 1 : -1) : 0); // 1=E/right
    const nH = h + ((dir === 0 || dir === 2) ? (add ? 1 : -1) : 0); // 2=S/down
    if (nW <= 0 || nH <= 0) return { ok:false, err:'min_size' };
    // Build tileGrid of names (rows y:0..nH-1)
    const tileName = (x,y) => tileIdToName[dto.tiles[y*w + x]] || 'Floor';
    const tileGrid = Array.from({length:nH}, (_, y2) => {
      const row = new Array(nW);
      for (let x2=0; x2<nW; x2++) {
        const ox = x2 + dxOff;
        const oy = y2 + dyOff;
        if (ox >= 0 && oy >= 0 && ox < w && oy < h) row[x2] = tileName(ox, oy);
        else row[x2] = 'Wall';
      }
      return row;
    });
    // Entities: map id -> name, adjust positions, drop out-of-bounds
    const entities = [];
    for (const e of (dto.entities||[])) {
      if (e == null) continue;
      const nx = e.x - dxOff;
      const ny = e.y - dyOff;
      if (nx < 0 || ny < 0 || nx >= nW || ny >= nH) continue;
      const name = entIdToName[e.type] || null;
      if (!name) continue;
      const entry = { type: name, x: nx, y: ny };
      if (Number.isInteger(e.rot)) {
        // Orientation enum expects names 'N','E','S','W'
        const rotNames = ['N','E','S','W'];
        const rn = rotNames[(e.rot|0)&3];
        if (rn) entry.orientation = rn;
      }
      entities.push(entry);
    }
    // Include PlayerSpawn to set player position
    if (dto.player && Number.isInteger(dto.player.x) && Number.isInteger(dto.player.y)) {
      const px = Math.max(0, Math.min(nW-1, dto.player.x - dxOff));
      const py = Math.max(0, Math.min(nH-1, dto.player.y - dyOff));
      entities.push({ type: 'PlayerSpawn', x: px, y: py });
    }
    const level = { width: nW, height: nH, tileGrid, entities };
    api.setState(level);
    return { ok:true };
  } catch (e) {
    console.error('resizeLocal failed', e);
    return { ok:false, err: e?.message || String(e) };
  }
}

// Canvas wiring
const canvasEl = document.getElementById('game');
if (canvasEl) {
  initCanvas(canvasEl);
}
// Provide catalog to canvas for correct color mapping by tile name
try { setCatalog(tilesCatalog); } catch {}
try { setEntityCatalog(entsCatalog); } catch {}
const bannerEl = document.getElementById('bigMessage');
let gameOver = false;
function setBanner(kind) {
  if (!bannerEl) return;
  bannerEl.classList.remove('active','win','lose');
  bannerEl.textContent = '';
  if (!kind) return;
  bannerEl.classList.add('active');
  bannerEl.classList.add(kind);
  if (kind === 'win') bannerEl.textContent = 'You Win!';
  else if (kind === 'lose') bannerEl.textContent = 'Game Over';
}
const requestRedraw = () => { try { draw(api.getState()); } catch (e) { console.error(e); } };
requestRedraw();
window.addEventListener('resize', requestRedraw);

// Fill two bottom rows with tile types from catalog for visual inspection
try {
  const dto = api.getState();
  const tiles = tilesCatalog;
  const w = dto.w | 0, h = dto.h | 0;
  const perRow = Math.max(1, w);
  const maxRows = Math.min(2, h);
  let i = 0;
  for (let row = 0; row < maxRows && i < tiles.length; row++) {
    const y = row; // engine coords: 0 bottom, 1 above
    for (let x = 0; x < perRow && i < tiles.length; x++) {
      const id = tiles[i++]?.id;
      if (Number.isInteger(id)) api.applyEdit(0, x, y, id, 0); // 0 = SetTile
    }
  }
  requestRedraw();
} catch (e) {
  console.warn('Showcase rows fill skipped:', e);
}

// Build tools wiring
let buildMode = false;
// Populate chips dynamically from catalogs BEFORE wiring listeners
populateBuildChips(api);
setupBuildUI(api, {
  canvasEl,
  onModified: requestRedraw,
  onSnapshot: () => {},
  requestRedraw,
  isBuildMode: () => buildMode,
});

// Toggle panels behavior for the collapsible sections
document.querySelectorAll('.tile-toggle[data-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const panel = document.getElementById(targetId);
    if (!panel) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    const next = !expanded;
    btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    panel.classList.toggle('hidden', !next);
    panel.setAttribute('aria-hidden', next ? 'false' : 'true');
  });
});

// HUD wiring
setupHUD({
  onToggleBuildMode: () => {
    const panel = document.querySelector('.build-controls');
    buildMode = !buildMode;
    const btn = document.getElementById('build-mode-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', buildMode ? 'true' : 'false');
      btn.textContent = buildMode ? 'Hide Build Tools' : 'Show Build Tools';
    }
    if (panel) {
      panel.classList.toggle('hidden', !buildMode);
      panel.setAttribute('aria-hidden', buildMode ? 'false' : 'true');
    }
    // When exiting build mode, commit current layout as the new baseline for Reset
    if (!buildMode) {
      try { api.commitBaseline && api.commitBaseline(); } catch {}
    }
  },
  onUndo: () => { if (api.undo()) { setBanner(null); gameOver = false; } requestRedraw(); },
  onReset: () => { api.reset(); setBanner(null); gameOver = false; requestRedraw(); },
  onToggleSolver: () => {
    const panel = document.getElementById('solverPanel');
    const btn = document.getElementById('toggleSolver');
    if (!panel || !btn) return;
    // Toggle visibility
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen ? true : false);
    const isOpen = willOpen; // after toggle above
    // Accessibility: keep ARIA and focus consistent; use inert to prevent hidden focus
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    try { panel.inert = !isOpen; } catch {}
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
    btn.textContent = isOpen ? 'Hide Solver' : 'Show Solver';
    if (!isOpen) {
      // If focus is inside hidden panel, move it to the toggle button
      const ae = document.activeElement;
      if (ae && panel.contains(ae)) {
        try { btn.focus(); } catch {}
      }
    } else {
      // When opening, focus first interactive control for convenience
      const first = panel.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (first && typeof first.focus === 'function') {
        try { first.focus(); } catch {}
      }
    }
  },
  onRefreshLevels: async () => {
    // Populate world and levels selects
    const worlds = await loadWorldList();
    const worldSel = document.getElementById('server-worlds');
    const levelSel = document.getElementById('server-levels');
    if (!worldSel || !levelSel) return;
    worldSel.innerHTML = '';
    for (const w of worlds) {
      const opt = document.createElement('option');
      opt.value = w; opt.textContent = w;
      worldSel.appendChild(opt);
    }
    if (worlds.length > 0) worldSel.selectedIndex = 0;
    const world = worldSel.value || (worlds[0] || '.');
    const levels = await loadLevelListForWorld(world);
    levelSel.innerHTML = '';
    for (const l of levels) {
      const opt = document.createElement('option');
      opt.value = l; opt.textContent = l;
      levelSel.appendChild(opt);
    }

    // Attach change listener once to repopulate levels when world changes
    if (!worldSel.dataset.bindChange) {
      worldSel.addEventListener('change', async () => {
        const w = worldSel.value || '.';
        const lvl = await loadLevelListForWorld(w);
        levelSel.innerHTML = '';
        for (const nm of lvl) {
          const opt = document.createElement('option');
          opt.value = nm; opt.textContent = nm;
          levelSel.appendChild(opt);
        }
      });
      worldSel.dataset.bindChange = '1';
    }
  },
  onLoadLevel: async () => {
    const worldSel = document.getElementById('server-worlds');
    const levelSel = document.getElementById('server-levels');
    if (!worldSel || !levelSel) return;
    const obj = await loadWorldLevel(worldSel.value || '.', levelSel.value || '');
    api.setState(obj);
    requestRedraw();
  },
  onExport: (name) => exportLevel(api.getState(), name || 'level.json'),
  onImport: async (file) => {
    const obj = await importLevel(file);
    api.setState(obj);
    requestRedraw();
  },
  onRunSolver: async ({ maxDepth, maxNodes, onProgress, onSolutions }) => {
    try {
      const cfg = {
        depthCap: Number(maxDepth) || 100,
        nodesCap: Number(maxNodes) || 200000,
        timeCapSeconds: 10.0,
        enforceTimeCap: false,
      };
      const report = await raw.solverAnalyze(api.getState(), cfg);
      // Unpack topSolutions -> moves strings
      const unpackMoves = (bytes, length) => {
        const dirToChar = ['w','d','s','a']; // N,E,S,W
        const out = [];
        for (let i=0;i<length;i++) {
          const byteIdx = i >> 2;
          const shift = (i & 3) * 2;
          const mv = (bytes[byteIdx] >> shift) & 0b11;
          out.push(dirToChar[mv]);
        }
        return out.join('');
      };
      const solutions = (report.topSolutions || []).map(e => ({ length: e.length|0, moves: unpackMoves(e.movesPacked||[], e.length|0) }));
      const deadEnds = []; // not surfaced in report entries; we keep stats only
      const stats = { nodesExpanded: report.nodesExplored|0 };
      onSolutions && onSolutions({ solutions, deadEnds, stats });
    } catch (err) {
      onProgress && onProgress('Error: ' + (err?.message || String(err)));
    }
  },
  onStopSolver: () => {},
  onPlaySolution: () => {},
  onExportSolution: () => {},
});

// Keyboard controls (WASD/Arrows)
const keyToDir = new Map([
  ['ArrowUp', 0], ['KeyW', 0],
  ['ArrowRight', 1], ['KeyD', 1],
  ['ArrowDown', 2], ['KeyS', 2],
  ['ArrowLeft', 3], ['KeyA', 3],
]);
function logPlayerState(prefix = 'After move') {
  try {
    const st = api.getState();
    const p = st && st.player ? st.player : null;
    if (!p) return;
    // entryDir: 0=N,1=E,2=S,3=W, or -1 when none
    console.log(prefix, { x: p.x, y: p.y, attached: p.attached, entryDir: p.entryDir });
  } catch {}
}
window.addEventListener('keydown', (e) => {
  // Reset with R regardless of build mode
  if (e.code === 'KeyR') {
    e.preventDefault();
    api.reset();
    setBanner(null);
    gameOver = false;
    requestRedraw();
    logPlayerState('After reset');
    return;
  }
  const dir = keyToDir.get(e.code);
  if (dir == null) return;
  e.preventDefault();
  if (buildMode || gameOver) return;
  try {
    const r = api.step(dir);
    logPlayerState('After step');
    if (r && (r.win || r.lose)) {
      gameOver = true;
      setBanner(r.win ? 'win' : 'lose');
    } else {
      setBanner(null);
    }
  } finally { requestRedraw(); }
});

// Export default for potential consumers
export default api;

// Populate worlds/levels on first load
(async ()=>{
  try {
    const refreshBtn = document.getElementById('refresh-server');
    if (refreshBtn) refreshBtn.click();
  } catch {}
})();

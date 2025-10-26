// web/main.js — boots wasm-adapter, creates a session, wires UI
import { initWasm } from './core/wasm-adapter.js';
import { initCanvas, draw, setCatalog } from './ui/canvas.js';
import { setupHUD } from './ui/hud.js';
import { setupBuildUI } from './ui/build.js';
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
    if (k) m[k] = v;
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
};

// Canvas wiring
const canvasEl = document.getElementById('game');
if (canvasEl) {
  initCanvas(canvasEl);
}
// Provide catalog to canvas for correct color mapping by tile name
try { setCatalog(tilesCatalog); } catch {}
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
setupBuildUI(api, {
  canvasEl,
  onModified: requestRedraw,
  onSnapshot: () => {},
  requestRedraw,
  isBuildMode: () => buildMode,
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
  },
  onUndo: () => { if (api.undo()) { setBanner(null); gameOver = false; } requestRedraw(); },
  onReset: () => { api.reset(); setBanner(null); gameOver = false; requestRedraw(); },
  onToggleSolver: () => {
    const p = document.getElementById('solverPanel');
    if (p) p.classList.toggle('hidden');
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
  onRunSolver: async () => { throw new Error('Solver not available in this build'); },
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
window.addEventListener('keydown', (e) => {
  // Reset with R regardless of build mode
  if (e.code === 'KeyR') {
    e.preventDefault();
    api.reset();
    setBanner(null);
    gameOver = false;
    requestRedraw();
    return;
  }
  const dir = keyToDir.get(e.code);
  if (dir == null) return;
  e.preventDefault();
  if (buildMode || gameOver) return;
  try {
    const r = api.step(dir);
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

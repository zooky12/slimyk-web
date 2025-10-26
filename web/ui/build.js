// ui/build.js — wired to minimal EditOps via wasm adapter
// Needs ../core/wasm-adapter.js to export:
//   api.getState(): DrawDto
//   api.edit(kind, x, y, type, rot): Promise<void>
//   api.ids = { tile:{...}, entity:{...}, orient:{...} }

// ui/build.js
import { initWasm } from '../core/wasm-adapter.js';

const DEMO = {
  "tileGrid": [
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
  "entities": [
    { "type": "PlayerSpawn", "x": 5, "y": 8 },
    { "type": "BoxBasic",    "x": 8, "y": 8 },
    { "type": "BoxBasic",    "x": 5, "y": 4 },
    { "type": "BoxBasic",    "x": 2, "y": 4 }
  ]
};


const api = await initWasm('./wasm/');          // resolves to ../wasm/ relative to module
let sid = api.initLevel(DEMO); // can be object; adapter stringifies

let apiPromise = null;
async function getApi() {
  if (window.__WASM_API__) return window.__WASM_API__;     // reuse if index created it
  if (!apiPromise) apiPromise = initWasm('/wasm/');         // or init here
  const api = await apiPromise;
  window.__WASM_API__ ??= api;                              // stash for other modules
  return api;
}
async function getSid() {
  if (window.__WASM_SID__) return window.__WASM_SID__;
  const api = await getApi();
  // create a session if none: use your demo JSON or current editor JSON
  const demoJson = window.__DEMO_LEVEL_JSON__ || JSON.stringify(/* your fallback */);
  const sid = await api.initLevel(demoJson);
  window.__WASM_SID__ = sid;
  return sid;
}
const res = await api.applyEdit(sid, kind, x, y, type, rot);


// C# enum: EditKind { SetTile=0, PlaceEntity=1, Remove=2, MovePlayer=3 }
const EDIT = { SetTile: 0, PlaceEntity: 1, Remove: 2, MovePlayer: 3 };

// UI entity keys -> engine EntityType names
const UI_TO_ENTITY_NAME = {
  player: 'PlayerSpawn',
  box: 'BoxBasic',
  heavyBox: 'BoxHeavy',
  triBox: 'TriBox',
  fragileWall: 'FragileWall',
};

// Valid tiles we expose in the UI
const VALID_TILES = new Set([
  'floor','wall','hole','exit','pressurePlate','grile','spikes',
  'holeSpikes','slimPathFloor','slimPathHole','fragileWall' // note: fragileWall as entity too
]);

// Fallback orientation cycling if you don't expose NE/SE/SW/NW in api.ids.orient
const TRI_ORIENT_CYCLE = ['NE','SE','SW','NW'];

export function setupBuildUI({
  canvasEl,
  getState,        // kept for compatibility but we pull state from API
  setState,        // kept for compatibility; not used to mutate
  onModified = () => {},
  onSnapshot = () => {},
  requestRedraw = () => {},
  isBuildMode
}) {
  let currentPaintTile = 'wall';
  let currentEntityKey = null;   // 'box' | 'heavyBox' | 'triBox' | 'player' | 'fragileWall'
  let rotateMode = false;        // rotate tri on click
  let mouseDown = false;
  const painted = new Set();

  // ---------- helpers ----------
  function dto() { return api.getState(); }

  function gridPosFromMouse(ev) {
    const d = dto();
    if (!d) return null;
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width  / Math.max(1, rect.width);
    const scaleY = canvasEl.height / Math.max(1, rect.height);
    const xpx = (ev.clientX - rect.left) * scaleX;
    const ypx = (ev.clientY - rect.top)  * scaleY;
    const tile = Math.floor(canvasEl.width / Math.max(1, d.w));
    const x = Math.floor(xpx / tile);
    const y = Math.floor(ypx / tile);
    if (x < 0 || x >= d.w || y < 0 || y >= d.h) return null;
    return { x, y };
  }

  function markModified() { onModified(); requestRedraw(); }

  function clearHL() {
    document.querySelectorAll('.build-controls button[data-tile], .build-controls button[data-entity], .build-controls button[data-rotate]')
      .forEach(btn => { btn.classList.remove('active'); btn.setAttribute('aria-pressed','false'); });
  }

  function tileId(name) {
    const id = api.ids?.tile?.[name];
    if (id == null) throw new Error(`Unknown tile '${name}'`);
    return id;
  }

  function entityId(name) {
    const id = api.ids?.entity?.[name];
    if (id == null) throw new Error(`Unknown entity '${name}'`);
    return id;
  }

  function orientId(name) {
    const id = api.ids?.orient?.[name];
    if (id == null) return 0;
    return id;
  }

  function entityAt(x, y) {
    const d = dto();
    return (d.entities || []).find(e => e.x === x && e.y === y);
  }

  function triAt(x, y) {
    const d = dto();
    return (d.entities || []).find(e => e.x === x && e.y === y && nameForEntityType(e.type) === 'TriBox');
  }

  function nameForEntityType(typeId) {
    // invert api.ids.entity
    const ent = api.ids?.entity || {};
    for (const [name, id] of Object.entries(ent)) if (id === typeId) return name;
    return null;
  }

  async function setTile(x, y, name, rotName = 'N') {
    await api.edit(EDIT.SetTile, x, y, tileId(name), orientId(rotName));
  }

  async function placeEntity(x, y, entityName, rotName = 'N') {
    await api.edit(EDIT.PlaceEntity, x, y, entityId(entityName), orientId(rotName));
  }

  async function removeAt(x, y) {
    await api.edit(EDIT.Remove, x, y, 0, 0);
  }

  async function movePlayerTo(x, y) {
    await api.edit(EDIT.MovePlayer, x, y, 0, 0);
  }

  // ---------- UI bindings ----------
  // Tile chips
  document.querySelectorAll('.build-controls button[data-tile]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isBuildMode()) return;
      const t = btn.dataset.tile;
      if (!VALID_TILES.has(t)) return;
      rotateMode = false;
      currentEntityKey = null;
      currentPaintTile = t;
      clearHL();
      btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
    });
  });

  // Entity chips
  document.querySelectorAll('.build-controls button[data-entity]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isBuildMode()) return;
      rotateMode = false;
      currentEntityKey = btn.dataset.entity; // 'box'|'heavyBox'|'triBox'|'player'|'fragileWall'
      clearHL();
      btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
    });
  });

  // Rotate chips (tri)
  document.querySelectorAll('.build-controls button[data-rotate]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isBuildMode()) return;
      rotateMode = true;
      currentEntityKey = null;
      clearHL();
      btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
    });
  });

  // Paint / drag
  async function paintAt(ev) {
    if (!isBuildMode()) return;
    const gp = gridPosFromMouse(ev);
    if (!gp) return;
    const key = gp.x + ',' + gp.y;
    if (painted.has(key)) return;
    painted.add(key);

    try {
      if (rotateMode) {
        // rotate Tri if present: remove & re-place with next orient
        const tri = triAt(gp.x, gp.y);
        if (tri) {
          const currentName = TRI_ORIENT_CYCLE.find(n => orientId(n) === (tri.rot ?? -999));
          const curIdx = currentName ? TRI_ORIENT_CYCLE.indexOf(currentName) : -1;
          const nextName = TRI_ORIENT_CYCLE[(Math.max(0, curIdx) + 1) % TRI_ORIENT_CYCLE.length];
          onSnapshot();
          await removeAt(gp.x, gp.y);
          await placeEntity(gp.x, gp.y, 'TriBox', nextName);
          markModified();
        }
        return;
      }

      if (currentEntityKey) {
        // Player uses MovePlayer (don’t destroy tiles/entities silently)
        if (currentEntityKey === 'player') {
          // refuse if an entity is already there (engine will also reject)
          if (entityAt(gp.x, gp.y)) { alert('Tile occupied by an entity. Remove it first.'); return; }
          onSnapshot();
          await movePlayerTo(gp.x, gp.y);
          markModified();
          return;
        }

        const engineName = UI_TO_ENTITY_NAME[currentEntityKey];
        if (!engineName) return;

        // toggle: if same-type entity present -> remove; else place
        const e = entityAt(gp.x, gp.y);
        if (e && nameForEntityType(e.type) === engineName) {
          onSnapshot(); await removeAt(gp.x, gp.y); markModified();
        } else if (e) {
          // Some other entity is here → also treat as toggle remove
          onSnapshot(); await removeAt(gp.x, gp.y); markModified();
        } else {
          onSnapshot(); await placeEntity(gp.x, gp.y, engineName, 'N'); markModified();
        }
        return;
      }

      // Tile paint
      if (!VALID_TILES.has(currentPaintTile)) return;
      onSnapshot();
      await setTile(gp.x, gp.y, currentPaintTile, 'N');
      markModified();
    } catch (err) {
      console.error(err);
      alert(err?.message || String(err));
    }
  }

  function onDown(ev) {
    if (!isBuildMode()) return;
    mouseDown = true;
    painted.clear();
    paintAt(ev);
  }
  function onMove(ev) {
    if (!isBuildMode() || !mouseDown) return;
    // drag only tiles to avoid nuking entities on sweeps
    if (!currentEntityKey && !rotateMode) paintAt(ev);
  }
  function onUp(){ mouseDown = false; painted.clear(); }
  function onLeave(){ mouseDown = false; painted.clear(); }

  canvasEl.addEventListener('mousedown', onDown);
  canvasEl.addEventListener('mousemove', onMove);
  canvasEl.addEventListener('mouseup', onUp);
  canvasEl.addEventListener('mouseleave', onLeave);

  // ---------- Buttons ----------
  // Fill walls (non-reachable): do flood on current DrawDto and SetTile to 'wall' for unreachable
  const fillBtn = document.getElementById('fill-floor');
  if (fillBtn) fillBtn.addEventListener('click', async () => {
    if (!isBuildMode()) return;
    const d = dto(); if (!d) return;
    // Find player
    const px = d.player?.x, py = d.player?.y;
    if (px == null || py == null) { alert('No player on the map.'); return; }
    const passable = (x, y) => {
      const idx = y * d.w + x;
      const tId = d.tiles[idx] ?? 0;
      // Use a simple mask: consider non-wall as passable (engine will enforce real rules)
      const wallId = api.ids?.tile?.wall;
      return tId !== wallId;
    };
    const seen = Array.from({length:d.h}, () => Array(d.w).fill(false));
    const q = [];
    if (passable(px, py)) { seen[py][px] = true; q.push({x:px, y:py}); }
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (q.length) {
      const {x,y} = q.shift();
      for (const [dx,dy] of dirs) {
        const nx=x+dx, ny=y+dy;
        if (nx<0||nx>=d.w||ny<0||ny>=d.h) continue;
        if (seen[ny][nx]) continue;
        if (!passable(nx, ny)) continue;
        seen[ny][nx] = true;
        q.push({x:nx, y:ny});
      }
    }
    onSnapshot();
    for (let y=0;y<d.h;y++) for (let x=0;x<d.w;x++) {
      if (!seen[y][x]) {
        try { await setTile(x, y, 'wall', 'N'); } catch {}
      }
    }
    markModified();
  });

  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    if (!isBuildMode()) return;
    if (!confirm('Clear map?')) return;
    const d = dto(); if (!d) return;
    onSnapshot();
    // Remove all entities
    for (const e of d.entities || []) {
      try { await removeAt(e.x, e.y); } catch {}
    }
    // Paint all tiles to floor
    for (let y=0;y<d.h;y++) for (let x=0;x<d.w;x++) {
      try { await setTile(x, y, 'floor', 'N'); } catch {}
    }
    markModified();
  });

  // Resize / Compact — not available with current EditOps; disable with hints
  const compactBtn = document.getElementById('compact-grid');
  if (compactBtn) {
    compactBtn.title = 'Compact borders needs a Compact or Resize EditOp (not available yet)';
    compactBtn.addEventListener('click', () => alert('Compact requires a Compact/Resize EditOp in the engine. We can add it next.'));
  }
  const addToggle = document.getElementById('resize-add');
  const removeToggle = document.getElementById('resize-remove');
  const pad = document.getElementById('dir-pad');
  const disableResizeUI = () => {
    if (addToggle) { addToggle.disabled = true; addToggle.title = 'Resize requires a Resize EditOp in the engine'; }
    if (removeToggle) { removeToggle.disabled = true; removeToggle.title = 'Resize requires a Resize EditOp in the engine'; }
    if (pad) { pad.classList.add('hidden'); pad.setAttribute('aria-hidden','true'); }
  };
  disableResizeUI();
}

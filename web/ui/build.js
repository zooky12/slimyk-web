// ui/build.js — editor tools using wasm-adapter API
// Expects a session-bound `api` object exposing:
//   - getState(): DrawDto
//   - applyEdit(kind, x, y, type, rot): Promise<{ok,err?}>
//   - ids = { tile:{...}, entity:{...}, orient:{...} }

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
const TRI_ORIENT_CYCLE = ['N','E','S','W'];

export function setupBuildUI(api, {
  canvasEl,
  getState,        // kept for compatibility but we pull state from API by default
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
  function dto() { return (typeof getState === 'function' ? getState() : api.getState()); }

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
    const yDraw = Math.floor(ypx / tile);
    // Flip Y to engine coordinates (engine y=0 bottom)
    const y = (d.h - 1 - yDraw);
    if (x < 0 || x >= d.w || y < 0 || y >= d.h) return null;
    return { x, y };
  }

  function markModified() { onModified(); requestRedraw(); }

  function clearHL() {
    document.querySelectorAll('.build-controls button[data-tile], .build-controls button[data-entity], .build-controls button[data-rotate]')
      .forEach(btn => { btn.classList.remove('active'); btn.setAttribute('aria-pressed','false'); });
  }

  function tileId(name) {
    const id = (api.ids?.tile?.[name] ?? api.ids?.tile?.[String(name || '').toLowerCase()]);
    if (id == null) throw new Error(`Unknown tile '${name}'`);
    return id;
  }

  function entityId(name) {
    const key = String(name || '');
    const id = (api.ids?.entity?.[key] ?? api.ids?.entity?.[key.toLowerCase?.() || key.toLowerCase()]);
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
    return (d.entities || []).find(e => e.x === x && e.y === y && nameForEntityType(e.type) === 'BoxTriangle');
  }

  function nameForEntityType(typeId) {
    // invert api.ids.entity
    const ent = api.ids?.entity || {};
    for (const [name, id] of Object.entries(ent)) if (id === typeId) return name;
    return null;
  }

  async function setTile(x, y, name, rotName = 'N') {
    await api.applyEdit(EDIT.SetTile, x, y, tileId(name), orientId(rotName));
  }

  async function placeEntity(x, y, entityName, rotName = 'N') {
    await api.applyEdit(EDIT.PlaceEntity, x, y, entityId(entityName), orientId(rotName));
  }

  async function removeAt(x, y) {
    await api.applyEdit(EDIT.Remove, x, y, 0, 0);
  }

  async function movePlayerTo(x, y) {
    await api.applyEdit(EDIT.MovePlayer, x, y, 0, 0);
  }

  // ---------- UI bindings ----------
  // Tile chips
  document.querySelectorAll('.build-controls button[data-tile]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isBuildMode()) return;
      const t = btn.dataset.tile;
      if (!t) return;
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
          const curIdx = (tri.rot ?? 0) & 3;
          const nextName = TRI_ORIENT_CYCLE[(curIdx + 1) % TRI_ORIENT_CYCLE.length];
          onSnapshot();
          await removeAt(gp.x, gp.y);
          await placeEntity(gp.x, gp.y, 'BoxTriangle', nextName);
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

        let engineName = currentEntityKey; if (UI_TO_ENTITY_NAME[engineName]) engineName = UI_TO_ENTITY_NAME[engineName];

        // toggle: if same-type entity present -> remove; else place
        const e = entityAt(gp.x, gp.y);
        if (e && nameForEntityType(e.type) === engineName) {
          onSnapshot(); await removeAt(gp.x, gp.y); markModified();
        } else if (e) {
          // Some other entity is here — also treat as toggle remove
          onSnapshot(); await removeAt(gp.x, gp.y); markModified();
        } else {
          onSnapshot(); await placeEntity(gp.x, gp.y, engineName, 'N'); markModified();
        }
        return;
      }

      // Tile paint
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
  let resizeAdd = true;
  if (addToggle) addToggle.addEventListener('click', () => {
    resizeAdd = true;
    addToggle.setAttribute('aria-pressed','true'); addToggle.classList.add('active');
    if (removeToggle) { removeToggle.setAttribute('aria-pressed','false'); removeToggle.classList.remove('active'); }
    if (pad) { pad.classList.remove('hidden'); pad.setAttribute('aria-hidden','false'); }
  });
  if (removeToggle) removeToggle.addEventListener('click', () => {
    resizeAdd = false;
    removeToggle.setAttribute('aria-pressed','true'); removeToggle.classList.add('active');
    if (addToggle) { addToggle.setAttribute('aria-pressed','false'); addToggle.classList.remove('active'); }
    if (pad) { pad.classList.remove('hidden'); pad.setAttribute('aria-hidden','false'); }
  });
  async function doResize(dirStr){
    if (!isBuildMode()) return;
    const map = { up:0, right:1, down:2, left:3 };
    const dir = map[dirStr]; if (dir == null) return;
    try {
      onSnapshot();
      const res = await api.resize(resizeAdd, dir);
      if (!res || res.ok !== true) throw new Error(res?.err || 'resize_failed');
      markModified();
    } catch (e) { alert('Resize failed: ' + (e?.message || e)); }
  }
  const upBtn = document.getElementById('dir-up');
  const downBtn = document.getElementById('dir-down');
  const leftBtn = document.getElementById('dir-left');
  const rightBtn = document.getElementById('dir-right');
  if (upBtn) upBtn.addEventListener('click', ()=>doResize('up'));
  if (downBtn) downBtn.addEventListener('click', ()=>doResize('down'));
  if (leftBtn) leftBtn.addEventListener('click', ()=>doResize('left'));
  if (rightBtn) rightBtn.addEventListener('click', ()=>doResize('right'));
}

// Dynamically populate build chips from catalogs
export function populateBuildChips(api) {
  try {
    const tilesBox = document.getElementById('tilesChips') || document.querySelector('#buildTiles .tile-filter-options');
    const entsBox  = document.getElementById('entsChips')  || document.querySelector('#buildEntities .tile-filter-options');
    if (tilesBox) tilesBox.innerHTML = '';
    if (entsBox) entsBox.innerHTML = '';

    const nice = (name) => String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g,' ').replace(/^./, c=>c.toUpperCase());

    // Tiles: create a chip for every catalog tile
    const tiles = (typeof api.getTiles === 'function') ? api.getTiles() : [];
    if (tilesBox && Array.isArray(tiles)) {
      for (const t of tiles) {
        if (!t || typeof t.name !== 'string') continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tile-chip';
        btn.dataset.tile = t.name; // build.js expects engine name
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = nice(t.name);
        tilesBox.appendChild(btn);
      }
    }

    // Entities: create chip for each catalog entity using engine names directly
    if (entsBox) {
      const ents = (typeof api.getEntities === 'function') ? api.getEntities() : [];
      for (const e of ents) {
        if (!e || typeof e.name !== 'string') continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tile-chip';
        btn.dataset.entity = e.name; // engine name
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = nice(e.name).replace('Box Basic','Box');
        entsBox.appendChild(btn);
      }
      // Rotate tri button
      const rot = document.createElement('button');
      rot.type = 'button';
      rot.className = 'tile-chip';
      rot.dataset.rotate = 'BoxTriangle';
      rot.setAttribute('aria-pressed', 'false');
      rot.title = 'Rotate Tri Box';
      rot.textContent = 'Rotate';
      entsBox.appendChild(rot);

      // Player chip
      const player = document.createElement('button');
      player.type = 'button';
      player.className = 'tile-chip';
      player.dataset.entity = 'player';
      player.setAttribute('aria-pressed', 'false');
      player.textContent = 'Player';
      entsBox.appendChild(player);
    }
  } catch (err) {
    console.warn('populateBuildChips failed', err);
  }
}





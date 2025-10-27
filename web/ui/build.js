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
  let currentPaintTile = null;
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

  // Catalog helpers for converting DrawDto -> LevelDTO (names)
  function catalogs() {
    const tiles = (typeof api.getTiles === 'function') ? api.getTiles() : [];
    const ents  = (typeof api.getEntities === 'function') ? api.getEntities() : [];
    const tileIdToName = Object.create(null);
    const entIdToName = Object.create(null);
    for (const t of tiles || []) if (t) tileIdToName[t.id] = t.name;
    for (const e of ents || []) if (e) entIdToName[e.id] = e.name;
    return { tileIdToName, entIdToName };
  }
  function toLevelDTOFromDraw(draw) {
    const { tileIdToName, entIdToName } = catalogs();
    const w = draw.w | 0, h = draw.h | 0;
    const tileGrid = Array.from({ length: h }, (_, y) => new Array(w));
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
      const id = draw.tiles[y * w + x];
      tileGrid[y][x] = tileIdToName[id] || 'Floor';
    }
    const entities = [];
    if (draw.player && Number.isInteger(draw.player.x) && Number.isInteger(draw.player.y))
      entities.push({ type:'PlayerSpawn', x: draw.player.x, y: draw.player.y });
    for (const e of draw.entities || []) {
      const name = entIdToName[e.type];
      if (!name || name === 'PlayerSpawn') continue;
      const out = { type: name, x: e.x|0, y: e.y|0 };
      if (Number.isInteger(e.rot)) {
        const rotNames = ['N','E','S','W'];
        out.orientation = rotNames[(e.rot|0) & 3];
      }
      entities.push(out);
    }
    return { width: w, height: h, tileGrid, entities };
  }

  // Rotate a LevelDTO 90 degrees clockwise. Entities positions updated accordingly.
  function rotateLevelDTOcw(level){
    const W = level.width|0, H = level.height|0;
    const out = { width: H, height: W, tileGrid: Array.from({length: W}, ()=> new Array(H)), entities: [] };
    // tiles
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      const nx = H - 1 - y;
      const ny = x;
      out.tileGrid[ny][nx] = level.tileGrid[y][x];
    }
    // orientation CCW map to preserve relative orientation when rotating level CW
    const ccw = { N:'W', W:'S', S:'E', E:'N' };
    // entities
    for (const e of level.entities || []){
      if (!e) continue;
      const nx = H - 1 - (e.y|0);
      const ny = (e.x|0);
      const ne = { type: e.type, x: nx, y: ny };
      if (e.orientation && typeof e.orientation === 'string'){
        const up = e.orientation.toUpperCase();
        ne.orientation = ccw[up] || up;
      }
      out.entities.push(ne);
    }
    return out;
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

      // Tile paint only if a tile is explicitly selected
      if (!currentPaintTile) return;
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
    compactBtn.title = 'Try to remove empty borders without changing solutions';
    compactBtn.addEventListener('click', compactBorders);
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

  // Rotate level clockwise button
  const rotateBtn = document.getElementById('rotate-cw');
  if (rotateBtn) rotateBtn.addEventListener('click', async () => {
    if (!isBuildMode()) return;
    rotateBtn.disabled = true;
    try {
      const d = dto(); if (!d) return;
      onSnapshot();
      const level = toLevelDTOFromDraw(d);
      const rotated = rotateLevelDTOcw(level);
      await api.setState(rotated);
      markModified();
      requestRedraw();
    } catch (e) {
      console.warn('Rotate CW failed', e);
      alert('Rotate failed: ' + (e?.message || e));
    } finally { rotateBtn.disabled = false; }
  });

  // Add 4: add one row/column on all 4 sides
  async function addFour() {
    onSnapshot();
    for (const d of [0,1,2,3]) {
      const res = await api.resize(true, d);
      if (!res || res.ok !== true) throw new Error(res?.err || 'add4_failed');
    }
    markModified();
  }
  const addFourBtn = document.getElementById('add-four');
  if (addFourBtn) addFourBtn.addEventListener('click', async () => {
    if (!isBuildMode()) return;
    addFourBtn.disabled = true;
    try { await addFour(); }
    catch (e) { console.warn('Add 4 failed', e); alert('Add 4 failed.'); }
    finally { addFourBtn.disabled = false; }
  });

  // ----- Solver helpers for Compact/Simplify -----
  function makeSolver() {
    try {
      const worker = new Worker(new URL('../workers/ald-worker.js', import.meta.url), { type:'module' });
      let nextId = 1; const pending = new Map();
      worker.onmessage = (ev) => {
        const { id, ok, result, error } = ev.data || {};
        const pr = pending.get(id); if (!pr) return; pending.delete(id);
        if (ok) pr.resolve(result); else pr.reject(new Error(error || 'worker_error'));
      };
      const call = (cmd, ...args) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); worker.postMessage({ id, cmd, args }); });
      call('init', { baseUrl: '../wasm/' }).catch(()=>{});
      return { analyze: (level, cfg) => call('solverAnalyze', level, cfg), dispose: () => worker.terminate() };
    } catch {
      return { analyze: (level, cfg) => api.solverAnalyze ? api.solverAnalyze(level, cfg) : Promise.reject(new Error('no_solver')), dispose: () => {} };
    }
  }
  function unpackMovesPacked(bytes, length) {
    const dirToChar = ['w','d','s','a'];
    if (!bytes || length <= 0) return '';
    let arr;
    if (typeof bytes === 'string') { try { const bin = atob(bytes); arr = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i); } catch { arr = []; } }
    else if (Array.isArray(bytes)) arr = bytes; else if (bytes && typeof bytes.length === 'number') arr = Array.from(bytes); else arr = [];
    const out=[]; for (let i=0;i<length;i++){ const b=i>>2, sh=(i&3)*2; const mv=((arr[b]||0)>>sh)&3; out.push(dirToChar[mv]||''); } return out.join('');
  }
  function takeTop3(report){ const top = Array.isArray(report?.topSolutions) ? report.topSolutions.slice(0,3) : []; return top.map(s => (typeof s.moves==='string')? s.moves : unpackMovesPacked(s.movesPacked, s.length|0)); }
  function filteredCount(report){ const v = report?.solutionsFilteredCount; if (Number.isFinite(v)) return v|0; if (Array.isArray(report?.solutions)) return report.solutions.length|0; const t = Array.isArray(report?.topSolutions)? report.topSolutions.length:0; return t|0; }
  function makeSignature(report){ return { cnt: filteredCount(report), top3: takeTop3(report) }; }
  function sameSignature(a,b){ if (!a||!b) return false; if (a.cnt !== b.cnt) return false; const n=Math.max(a.top3.length,b.top3.length); for (let i=0;i<n;i++){ if ((a.top3[i]||'') !== (b.top3[i]||'')) return false; } return true; }
  function readSolverCaps(){ const depth = Number(document.getElementById('solverMaxDepth')?.value) || 100; const nodes = Number(document.getElementById('solverMaxNodes')?.value) || 200000; return { depthCap: depth, nodesCap: nodes, timeCapSeconds: 5.0, enforceTimeCap: false }; }
  async function analyzeCurrent(solver){ const draw = dto(); const level = toLevelDTOFromDraw(draw); return await solver.analyze(level, readSolverCaps()); }

  async function compactBorders(){
    if (!isBuildMode()) return;
    if (compactBtn) compactBtn.disabled = true;
    const solver = makeSolver();
    try {
      let baseSig = makeSignature(await analyzeCurrent(solver));
      for (const dir of [0,1,2,3]){
        while (true){
          const snap = toLevelDTOFromDraw(dto());
          let removed=false; try { const res = await api.resize(false, dir); removed = !!(res && res.ok); } catch { removed=false; }
          if (!removed) { await api.setState(snap); break; }
          const sig = makeSignature(await analyzeCurrent(solver));
          if (sameSignature(baseSig, sig)) { baseSig = sig; continue; }
          await api.setState(snap); break;
        }
      }
      // After compaction succeeds across all sides, automatically run Add 4
      try { await addFour(); } catch { /* ignore, already compacted */ }
      markModified();
    } finally { solver.dispose(); if (compactBtn) compactBtn.disabled = false; }
  }

  async function simplifyLevel(){
    if (!isBuildMode()) return;
    const a=document.getElementById('simplify-keep'); const b=document.getElementById('simplify-flex'); if (a) a.disabled=true; if (b) b.disabled=true;
    const solver = makeSolver();
    try {
      await compactBorders();
      let baseSig = makeSignature(await analyzeCurrent(solver));
      const d = dto(); if (!d) return;
      const wallId = api.ids?.tile?.wall;
      const passable = (x,y)=> (d.tiles[y*d.w+x]??0) !== wallId;
      const seen = Array.from({length:d.h},()=>Array(d.w).fill(false)); const q=[]; const px=d.player?.x, py=d.player?.y; if (Number.isInteger(px)&&Number.isInteger(py)&&passable(px,py)){ seen[py][px]=true; q.push({x:px,y:py}); }
      const ord=[]; const dirs2=[[1,0],[-1,0],[0,1],[0,-1]]; while(q.length){ const {x,y}=q.shift(); ord.push({x,y}); for(const [dx,dy] of dirs2){ const nx=x+dx, ny=y+dy; if(nx<0||nx>=d.w||ny<0||ny>=d.h) continue; if(seen[ny][nx]) continue; if(!passable(nx,ny)) continue; seen[ny][nx]=true; q.push({x:nx,y:ny}); } }
      const tilesArr = (typeof api.getTiles==='function')? api.getTiles():[]; const idToName={}; for(const t of tilesArr) idToName[t.id]=t.name;
      const simpler = (name)=>{ const nc=String(name||'').toLowerCase(); const out=[]; if(nc!=='floor'&&nc!=='wall'&&nc!=='hole') out.push('Floor'); if(nc!=='wall'&&nc!=='hole'){ if(nc.includes('hole')||nc.includes('grill')) out.push('Hole'); out.push('Wall'); } return out; };
      for (const {x,y} of ord){ const id=d.tiles[y*d.w+x]; const name=idToName[id]||''; const lc=name.toLowerCase(); if (lc==='floor'||lc==='wall'||lc==='hole') continue; const cands=simpler(name); for(const cand of cands){ const snap=toLevelDTOFromDraw(dto()); try{ await setTile(x,y,cand,'N'); } catch { await api.setState(snap); continue; } const sig=makeSignature(await analyzeCurrent(solver)); if (sameSignature(baseSig, sig)){ baseSig=sig; d.tiles[y*d.w+x]=(api.ids?.tile?.[cand] ?? api.ids?.tile?.[cand.toLowerCase?.()||cand.toLowerCase()])|0; break; } else { await api.setState(snap); } } }
      await compactBorders(); markModified();
    } catch(e){ console.warn('Simplify failed', e); alert('Simplify failed: '+(e?.message||e)); }
    finally { solver.dispose(); if (a) a.disabled=false; if (b) b.disabled=false; }
  }

  // Hook simplify buttons
  const simpA = document.getElementById('simplify-keep'); const simpB = document.getElementById('simplify-flex');
  if (simpA) simpA.addEventListener('click', simplifyLevel);
  if (simpB) simpB.addEventListener('click', simplifyLevel);
  // Greedy helpers: Place 1 / Remove 1 using C# exports
  const placeOneBtn = document.getElementById('place-one');
  if (placeOneBtn) placeOneBtn.addEventListener('click', async () => {
    if (!isBuildMode()) return;
    try {
      const draw = dto(); if (!draw) return;
      const level = toLevelDTOFromDraw(draw);
      // Determine selection: prefer entity chip, else tile chip
      let entitiesPlace = undefined;
      let tilesPlace = undefined;
      if (currentEntityKey) {
        let engineName = currentEntityKey;
        if (UI_TO_ENTITY_NAME[engineName]) engineName = UI_TO_ENTITY_NAME[engineName];
        entitiesPlace = [engineName];
      } else if (currentPaintTile) {
        tilesPlace = [currentPaintTile.replace(/\s+/g,'')];
      } else {
        alert('Select a tile or entity first.');
        return;
      }
      // Pull solver caps if present in UI
      const maxDepth = Number(document.getElementById('solverMaxDepth')?.value) || 100;
      const maxNodes = Number(document.getElementById('solverMaxNodes')?.value) || 200000;
      const opts = { tilesPlace, entitiesPlace, movePlayer: (entitiesPlace && entitiesPlace.includes('PlayerSpawn')) || false, maxDepth, maxNodes };
      const res = await api.aldPlaceOne(level, opts);
      if (!res || !res.ok) throw new Error(res?.err || 'place_one_failed');
      await api.setState(res.level);
      requestRedraw();
    } catch (e) {
      console.warn('PlaceOne failed', e);
      alert('Place One failed: ' + (e?.message || e));
    }
  });

  const removeOneBtn = document.getElementById('remove-one');
  if (removeOneBtn) removeOneBtn.addEventListener('click', async () => {
    if (!isBuildMode()) return;
    try {
      const draw = dto(); if (!draw) return;
      const level = toLevelDTOFromDraw(draw);
      let entitiesRemove = undefined;
      if (currentEntityKey) {
        let engineName = currentEntityKey;
        if (UI_TO_ENTITY_NAME[engineName]) engineName = UI_TO_ENTITY_NAME[engineName];
        entitiesRemove = [engineName];
      } else {
        // Fallback: try to remove common box type
        entitiesRemove = ['BoxBasic'];
      }
      const maxDepth = Number(document.getElementById('solverMaxDepth')?.value) || 100;
      const maxNodes = Number(document.getElementById('solverMaxNodes')?.value) || 200000;
      const opts = { entitiesRemove, maxDepth, maxNodes };
      const res = await api.aldRemoveOne(level, opts);
      if (!res || !res.ok) throw new Error(res?.err || 'remove_one_failed');
      await api.setState(res.level);
      requestRedraw();
    } catch (e) {
      console.warn('RemoveOne failed', e);
      alert('Remove One failed: ' + (e?.message || e));
    }
  });
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






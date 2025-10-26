// ui/io.js
//
// Lightweight level I/O helpers for the WASM-backed engine.
// - Lists worlds and levels from /levels
// - Loads a level and returns its JSON (object)
// - Exports/imports plain JSON
//
// NOTE: The consumer (index/app) should pass the JSON string to the WASM adapter:
//   const jsonStr = JSON.stringify(levelObj);
//   const sid = await api.initLevel(jsonStr);

function toObject(maybeJson) {
  if (!maybeJson) return {};
  if (typeof maybeJson === 'string') {
    try { return JSON.parse(maybeJson); } catch { return {}; }
  }
  return maybeJson;
}

function toJSONString(objOrString) {
  if (typeof objOrString === 'string') return objOrString;
  return JSON.stringify(objOrString ?? {}, null, 2);
}

const BASE = new URL('../', import.meta.url); // points to /web/

function urlInWeb(path) { return new URL(path, BASE).href; }

export async function loadLevelList() {
  try {
    const res = await fetch(urlInWeb('levels/index.json'), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.statusText);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function loadLevel(name) {
  const res = await fetch(urlInWeb('levels/' + encodeURIComponent(name)), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  return adaptLevel(toObject(data));
}

// ---- World-based loading ----

export async function loadWorldList() {
  try {
    const res = await fetch(urlInWeb('levels/worlds.json'), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.statusText);
    const worlds = await res.json();
    return Array.isArray(worlds) ? worlds : [];
  } catch {
    // Fallback: no worlds.json -> treat root as a flat world
    const flat = await loadLevelList();
    if (flat.length) return ['.']; // "." represents top-level /levels
    return [];
  }
}

export async function loadLevelListForWorld(world) {
  if (world === '.' || world === '' || world == null) {
    return loadLevelList();
  }
  try {
    const url = urlInWeb(`levels/${encodeURIComponent(world)}/index.json`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.statusText);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function loadWorldLevel(world, name) {
  if (world === '.' || world === '' || world == null) {
    return loadLevel(name);
  }
  const res = await fetch(urlInWeb(`levels/${encodeURIComponent(world)}/${encodeURIComponent(name)}`), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  return adaptLevel(toObject(data));
}

// ---- Export / Import plain JSON ----

export function exportLevel(levelObjOrString, filename) {
  const json = toJSONString(levelObjOrString);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (typeof filename === 'string' && filename.trim()) ? filename.trim() : 'level.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importLevel(file) {
  const text = await file.text();
  return adaptLevel(toObject(text)); // parsed & adapted
}

// ---- Migration: adapt older JSON formats to the engine's LevelDTO ----

function canonicalTileName(n) {
  const k = String(n || '').trim();
  if (!k) return 'Floor';
  const key = k.replace(/\s+/g,'').toLowerCase();
  const map = {
    floor: 'Floor', wall: 'Wall', hole: 'Hole', exit: 'Exit',
    spike: 'Spike', spikehole: 'SpikeHole', grill: 'Grill',
    slimpth: 'SlimPath', slimpthhole: 'SlimPathHole', // guard typos
    slimpthfloor: 'SlimPath',
    slimpthhole2: 'SlimPathHole',
    slimpth_ice: 'IceSlimPath',
    slimpath: 'SlimPath', slimpathhole: 'SlimPathHole',
    ice: 'Ice', icespike: 'IceSpike', icegrill: 'IceGrill', iceslimpath: 'IceSlimPath', iceexit: 'IceExit',
    buttonallowexit: 'ButtonAllowExit', buttontoggle: 'ButtonToggle'
  };
  return map[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

function canonicalEntityName(n) {
  const key = String(n || '').trim().toLowerCase();
  const map = {
    player: 'PlayerSpawn', playerspawn: 'PlayerSpawn',
    box: 'BoxBasic', boxbasic: 'BoxBasic',
    boxheavy: 'BoxHeavy', heavybox: 'BoxHeavy',
    tribox: 'TriBox', fragilewall: 'FragileWall'
  };
  return map[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

function adaptLevel(obj) {
  if (!obj || typeof obj !== 'object') return {};

  // If it's already in LevelDTO shape, return as-is
  if (Array.isArray(obj.tileGrid) || Array.isArray(obj.tileCharGrid)) return obj;

  const out = {};
  // Dimensions
  const rows = obj.size?.rows ?? obj.height;
  const cols = obj.size?.cols ?? obj.width;
  if (Number.isInteger(rows) && Number.isInteger(cols)) {
    out.width = cols; out.height = rows;
  }

  // Grid
  if (Array.isArray(obj.base)) {
    out.tileGrid = obj.base.map(row => Array.isArray(row) ? row.map(canonicalTileName) : []);
  } else if (Array.isArray(obj.grid)) {
    out.tileGrid = obj.grid.map(row => Array.isArray(row) ? row.map(canonicalTileName) : []);
  }

  // Entities
  if (Array.isArray(obj.entities)) {
    out.entities = [];
    for (const e of obj.entities) {
      if (!e) continue;
      const name = canonicalEntityName(e.type);
      const x = Number(e.x); const y = Number(e.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.entities.push({ type: name, x, y });
    }
  }

  return out;
}

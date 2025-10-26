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

export async function loadLevelList() {
  try {
    const res = await fetch('levels/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.statusText);
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function loadLevel(name) {
  const res = await fetch('levels/' + encodeURIComponent(name), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  // Return the parsed object; caller can JSON.stringify and feed to WASM.
  return toObject(data);
}

// ---- World-based loading ----

export async function loadWorldList() {
  try {
    const res = await fetch('levels/worlds.json', { cache: 'no-store' });
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
    const url = `levels/${encodeURIComponent(world)}/index.json`;
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
  const res = await fetch(`levels/${encodeURIComponent(world)}/${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.statusText);
  const data = await res.json();
  return toObject(data);
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
  return toObject(text); // parsed object
}

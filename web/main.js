// web/main.js
import { initWasm } from './core/wasm-adapter.js';

// --- Demo level (your JSON) ---
const DEMO = {
  "tileGrid":[
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
  "entities":[
    {"type":"PlayerSpawn","x":5,"y":8},
    {"type":"BoxBasic","x":8,"y":8},
    {"type":"BoxBasic","x":5,"y":4},
    {"type":"BoxBasic","x":2,"y":4}
  ]
};

// 1) Init the wasm engine once
const rawApi = await initWasm('./wasm/'); // resolves against this file

// 2) Create a fresh session with the demo level
const sid = rawApi.initLevel(DEMO);

// 3) Build an ids map (tile/entity name -> numeric id) for UI code convenience
function makeIndex(arr, keyName = 'name', idName = 'id') {
  const m = Object.create(null);
  for (const it of (arr || [])) {
    const k = (it[keyName] ?? it[keyName?.toLowerCase?.()] ?? '').toString();
    const v = (it[idName] ?? it[idName?.toLowerCase?.()]);
    if (k) m[k] = v;
  }
  return m;
}

const tilesList = rawApi.getTiles();     // expected: [{ id, name }, ...]
const entsList  = rawApi.getEntities();  // expected: [{ id, name }, ...]
const ids = {
  tile: makeIndex(tilesList, 'name', 'id'),
  entity: makeIndex(entsList,  'name', 'id'),
  // Safe defaults for orientations; adjust if your enum differs.
  // (NESW are commonly 0..3; NE/SE/SW/NW are extra if your engine supports them)
  orient: { N:0, E:1, S:2, W:3, NE:4, SE:5, SW:6, NW:7 }
};

// 4) Augment the API with ids + convenience wrappers bound to our session
const api = {
  ...rawApi,
  ids,
  // Session-bound helpers (no need to pass sid everywhere unless you want to)
  getState: () => rawApi.getState(sid),
  step: (dir) => rawApi.step(sid, dir),
  undo: () => rawApi.undo(sid),
  reset: () => rawApi.reset(sid),
  applyEdit: (kind, x, y, type, rot) => rawApi.applyEdit(sid, kind, x, y, type, rot),
};

// 5) Expose for other modules that expect a ready engine
window.__WASM_API__ = api;
window.__WASM_SID__ = sid;
// (Optional) also export if you want to import it directly elsewhere
export default api;

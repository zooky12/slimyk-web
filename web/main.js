// web/main.js — boots wasm-adapter, creates a session, wires UI
import { initWasm } from "./core/wasm-adapter.js";
import { initCanvas, draw, setCatalog, setEntityCatalog } from "./ui/canvas.js";
import { setupHUD } from "./ui/hud.js";
import { setupBuildUI, populateBuildChips } from "./ui/build.js";
import {
  loadWorldList,
  loadLevelListForWorld,
  loadWorldLevel,
  exportLevel,
  importLevel,
} from "./ui/io.js";
import { setupAutoLiteUI } from "./ui/auto-lite.js";

// --- Demo level (Loader schema) ---
const DEMO = {
  tileGrid: [
    [
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
    ],
    [
      "wall",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "floor",
      "hole",
      "wall",
      "exit",
      "wall",
      "hole",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "floor",
      "hole",
      "floor",
      "floor",
      "floor",
      "hole",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "wall",
      "floor",
      "hole",
      "floor",
      "floor",
      "floor",
      "hole",
      "floor",
      "hole",
      "wall",
    ],
    [
      "wall",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "hole",
      "wall",
    ],
    [
      "spike",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
      "wall",
    ],
  ],
  entities: [
    { type: "PlayerSpawn", x: 5, y: 8 },
    { type: "BoxBasic", x: 8, y: 8 },
    { type: "BoxBasic", x: 5, y: 4 },
    { type: "BoxBasic", x: 2, y: 4 },
  ],
};

// Init the wasm engine once
const raw = await initWasm();
const sid = raw.initLevel(DEMO);

// Build id maps for UI convenience
function makeIndex(arr, keyName = "name", idName = "id") {
  const m = Object.create(null);
  for (const it of arr || []) {
    const k = (it[keyName] ?? "").toString();
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
try {
  console.table && console.table(tilesCatalog);
} catch {
  try {
    console.log("Tile catalog:", tilesCatalog);
  } catch {}
}
const ids = {
  tile: makeIndex(tilesCatalog, "name", "id"),
  entity: makeIndex(entsCatalog, "name", "id"),
  orient: { N: 0, E: 1, S: 2, W: 3, NE: 4, SE: 5, SW: 6, NW: 7 },
};
// Reverse maps for id -> name (needed to build LevelDTO)
const tileIdToName = (() => {
  const m = Object.create(null);
  for (const t of tilesCatalog) m[t.id] = t.name;
  return m;
})();
const entIdToName = (() => {
  const m = Object.create(null);
  for (const e of entsCatalog) m[e.id] = e.name;
  return m;
})();

// Session-bound wrappers that call the adapter with `sid`
const api = {
  ...raw,
  ids,
  getState: () => raw.getState(sid),
  step: (dir) => raw.step(sid, dir),
  undo: () => raw.undo(sid),
  reset: () => raw.reset(sid),
  applyEdit: (kind, x, y, type, rot) =>
    raw.applyEdit(sid, kind, x, y, type ?? 0, rot ?? 0),
  setState: (level) => raw.setState(sid, level),
  commitBaseline: () =>
    typeof raw.commitBaseline === "function"
      ? raw.commitBaseline(sid)
      : undefined,
  resize: (add, dir) => resizeLocal(add, dir),
};

// Expose for console debugging
try {
  window.api = api;
} catch {}

// Local resize fallback: build a LevelDTO from current state, transform, then setState
function resizeLocal(add, dir) {
  try {
    const dto = api.getState();
    const w = dto.w | 0,
      h = dto.h | 0;
    const dxOff = add ? (dir === 3 ? -1 : 0) : dir === 3 ? +1 : 0; // 3=W/left
    // For vertical: add up => dyOff=0 (wall row at top), add down => dyOff=-1 (wall row at bottom)
    const dyOff = add ? (dir === 2 ? -1 : 0) : dir === 0 ? +1 : 0; // 0=N/up, 2=S/down
    const nW = w + (dir === 1 || dir === 3 ? (add ? 1 : -1) : 0); // 1=E/right
    const nH = h + (dir === 0 || dir === 2 ? (add ? 1 : -1) : 0); // 2=S/down
    if (nW <= 0 || nH <= 0) return { ok: false, err: "min_size" };
    // Build tileGrid of names (rows y:0..nH-1)
    const tileName = (x, y) => tileIdToName[dto.tiles[y * w + x]] || "Floor";
    const tileGrid = Array.from({ length: nH }, (_, y2) => {
      const row = new Array(nW);
      for (let x2 = 0; x2 < nW; x2++) {
        const ox = x2 + dxOff;
        const oy = y2 + dyOff;
        if (ox >= 0 && oy >= 0 && ox < w && oy < h) row[x2] = tileName(ox, oy);
        else row[x2] = "Wall";
      }
      return row;
    });
    // Entities: map id -> name, adjust positions, drop out-of-bounds
    const entities = [];
    for (const e of dto.entities || []) {
      if (e == null) continue;
      const nx = e.x - dxOff;
      const ny = e.y - dyOff;
      if (nx < 0 || ny < 0 || nx >= nW || ny >= nH) continue;
      const name = entIdToName[e.type] || null;
      if (!name) continue;
      const entry = { type: name, x: nx, y: ny };
      if (Number.isInteger(e.rot)) {
        // Orientation enum expects names 'N','E','S','W'
        const rotNames = ["N", "E", "S", "W"];
        const rn = rotNames[(e.rot | 0) & 3];
        if (rn) entry.orientation = rn;
      }
      entities.push(entry);
    }
    // Include PlayerSpawn to set player position
    if (
      dto.player &&
      Number.isInteger(dto.player.x) &&
      Number.isInteger(dto.player.y)
    ) {
      const px = Math.max(0, Math.min(nW - 1, dto.player.x - dxOff));
      const py = Math.max(0, Math.min(nH - 1, dto.player.y - dyOff));
      entities.push({ type: "PlayerSpawn", x: px, y: py });
    }
    const level = { width: nW, height: nH, tileGrid, entities };
    api.setState(level);
    return { ok: true };
  } catch (e) {
    console.error("resizeLocal failed", e);
    return { ok: false, err: e?.message || String(e) };
  }
}

// Canvas wiring
const canvasEl = document.getElementById("game");
if (canvasEl) {
  initCanvas(canvasEl);
}
// Provide catalog to canvas for correct color mapping by tile name
try {
  setCatalog(tilesCatalog);
} catch {}
try {
  setEntityCatalog(entsCatalog);
} catch {}
const bannerEl = document.getElementById("bigMessage");
let gameOver = false;
function setBanner(kind) {
  if (!bannerEl) return;
  bannerEl.classList.remove("active", "win", "lose");
  bannerEl.textContent = "";
  if (!kind) return;
  bannerEl.classList.add("active");
  bannerEl.classList.add(kind);
  if (kind === "win") bannerEl.textContent = "You Win!";
  else if (kind === "lose") bannerEl.textContent = "Game Over";
}
function clearGameStatus() {
  gameOver = false;
  try {
    setBanner(null);
  } catch {}
}
const requestRedraw = () => {
  try {
    draw(api.getState());
  } catch (e) {
    console.error(e);
  }
};
try {
  window.requestRedraw = requestRedraw;
} catch {}
requestRedraw();
window.addEventListener("resize", requestRedraw);

// Fill two bottom rows with tile types from catalog for visual inspection
try {
  const dto = api.getState();
  const tiles = tilesCatalog;
  const w = dto.w | 0,
    h = dto.h | 0;
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
  console.warn("Showcase rows fill skipped:", e);
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
document.querySelectorAll(".tile-toggle[data-target]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-target");
    const panel = document.getElementById(targetId);
    if (!panel) return;
    const expanded = btn.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    // Close all other panels first
    document.querySelectorAll(".tile-toggle[data-target]").forEach((other) => {
      if (other === btn) return;
      const oid = other.getAttribute("data-target");
      const op = oid && document.getElementById(oid);
      other.setAttribute("aria-expanded", "false");
      if (op) {
        op.classList.add("hidden");
        op.setAttribute("aria-hidden", "true");
      }
    });
    // Toggle requested panel
    btn.setAttribute("aria-expanded", next ? "true" : "false");
    panel.classList.toggle("hidden", !next);
    panel.setAttribute("aria-hidden", next ? "false" : "true");
  });
});

// --- Authoring export (words, not numbers) ---
function buildAuthoringLevel(dto, tileIdToName, entIdToName) {
  const w = dto.w | 0,
    h = dto.h | 0;

  // tileGrid with string names
  const tileGrid = Array.from({ length: h }, (_, y) => {
    const row = new Array(w);
    for (let x = 0; x < w; x++) {
      const id = dto.tiles[y * w + x] | 0;
      row[x] = tileIdToName[id] || "Floor"; // names the C# loader understands
    }
    return row;
  });

  // entities with string types
  const entities = [];
  for (const e of dto.entities || []) {
    if (!e) continue;
    const name = entIdToName[e.type];
    if (!name) continue;
    const out = { type: name, x: e.x | 0, y: e.y | 0 };
    if (Number.isInteger(e.rot)) {
      const rotNames = ["N", "E", "S", "W"];
      out.orientation = rotNames[(e.rot | 0) & 3];
    }
    entities.push(out);
  }

  // also emit PlayerSpawn from dto.player
  if (
    dto.player &&
    Number.isInteger(dto.player.x) &&
    Number.isInteger(dto.player.y)
  ) {
    entities.push({
      type: "PlayerSpawn",
      x: dto.player.x | 0,
      y: dto.player.y | 0,
    });
  }

  // authoring shape the Loader already supports
  return { tileGrid, entities };
}

// --- Import normalizer ---
// If the file is already authoring (tileGrid of words), pass through.
// If it's numeric (w/h/tiles) with ids, convert to words on the fly.
function normalizeImported(json, idsToNames) {
  if (json && Array.isArray(json.tileGrid)) return json; // already words
  if (
    json &&
    Number.isInteger(json.w) &&
    Number.isInteger(json.h) &&
    Array.isArray(json.tiles)
  ) {
    // Make a minimal dto-lookalike to reuse the builder
    const dto = {
      w: json.w | 0,
      h: json.h | 0,
      tiles: Array.from(json.tiles || []),
      entities: Array.from(json.entities || []),
      player: json.player
        ? { x: json.player.x | 0, y: json.player.y | 0 }
        : undefined,
    };
    return buildAuthoringLevel(dto, idsToNames.tile, idsToNames.entity);
  }
  return json; // unknown shapes go through; Loader will error with a clear message
}

// Helper: detect if any menu/panel is open to pause game input
function isAnyMenuOpen() {
  // Auto/Solver panels
  const autoOpen = (() => {
    const el = document.getElementById("autoPanel");
    return !!(el && !el.classList.contains("hidden"));
  })();
  const solverOpen = (() => {
    const el = document.getElementById("solverPanel");
    return !!(el && !el.classList.contains("hidden"));
  })();
  // Build controls
  const buildOpen = (() => {
    const el = document.querySelector(".build-controls");
    return !!(el && !el.classList.contains("hidden"));
  })();
  // Any expanded collapsible
  const anyExpanded = document.querySelector(".tile-filter-panel:not(.hidden)");
  return autoOpen || solverOpen || buildOpen || !!anyExpanded;
}

// Expose a helper to close other top-level panels (build/solver/auto)
function __closePanelsExcept(active) {
  // Build panel
  const buildPanel = document.querySelector(".build-controls");
  const buildBtn = document.getElementById("build-mode-btn");
  const wantBuild = active === "build";
  if (buildPanel) {
    buildPanel.classList.toggle("hidden", !wantBuild);
    buildPanel.setAttribute("aria-hidden", wantBuild ? "false" : "true");
  }
  if (buildBtn) {
    buildBtn.classList.toggle("active", !!wantBuild);
    buildBtn.setAttribute("aria-pressed", wantBuild ? "true" : "false");
    buildBtn.textContent = wantBuild ? "Hide Build Tools" : "Show Build Tools";
  }
  // Keep internal flag in sync
  if (typeof buildMode === "boolean") buildMode = !!wantBuild;

  // Solver panel
  const solverPanel = document.getElementById("solverPanel");
  const solverBtn = document.getElementById("toggleSolver");
  const wantSolver = active === "solver";
  if (solverPanel) {
    solverPanel.classList.toggle("hidden", !wantSolver);
    solverPanel.setAttribute("aria-hidden", wantSolver ? "false" : "true");
  }
  if (solverBtn) {
    solverBtn.classList.toggle("active", !!wantSolver);
    solverBtn.setAttribute("aria-pressed", wantSolver ? "true" : "false");
    solverBtn.textContent = wantSolver ? "Hide Solver" : "Show Solver";
  }

  // Auto panel
  const autoPanel = document.getElementById("autoPanel");
  const autoBtn = document.getElementById("toggleAuto");
  const wantAuto = active === "auto";
  if (autoPanel) {
    autoPanel.classList.toggle("hidden", !wantAuto);
    autoPanel.setAttribute("aria-hidden", wantAuto ? "false" : "true");
  }
  if (autoBtn) {
    autoBtn.classList.toggle("active", !!wantAuto);
    autoBtn.setAttribute("aria-pressed", wantAuto ? "true" : "false");
  }

  // Collapse all nested toggle panels except inside the active top-level panel
  document.querySelectorAll(".tile-toggle[data-target]").forEach((btn) => {
    const tid = btn.getAttribute("data-target");
    const pnl = tid && document.getElementById(tid);
    if (!pnl) return;
    const insideActive =
      (wantBuild && buildPanel && buildPanel.contains(pnl)) ||
      (wantSolver && solverPanel && solverPanel.contains(pnl)) ||
      (wantAuto && autoPanel && autoPanel.contains(pnl));
    if (!insideActive) {
      btn.setAttribute("aria-expanded", "false");
      pnl.classList.add("hidden");
      pnl.setAttribute("aria-hidden", "true");
    }
  });
}

try {
  window.__closePanelsExcept = __closePanelsExcept;
} catch {}

// HUD wiring
setupHUD({
  onToggleBuildMode: () => {
    const panel = document.querySelector(".build-controls");
    const willOpen = panel ? panel.classList.contains("hidden") : !buildMode;
    // Close others first, then open build
    __closePanelsExcept(willOpen ? "build" : "");
    buildMode = willOpen;
    // When exiting build mode, commit current layout as the new baseline for Reset
    if (!buildMode) {
      try {
        api.commitBaseline && api.commitBaseline();
      } catch {}
    }
  },
  onUndo: () => {
    if (api.undo()) {
      setBanner(null);
      gameOver = false;
    }
    requestRedraw();
  },
  onNextLevel: async () => {
    try {
      const worldSel = document.getElementById("server-worlds");
      const levelSel = document.getElementById("server-levels");
      if (!levelSel) return;
      const loadCurrent = async () => {
        const world = worldSel?.value || ".";
        const level = levelSel?.value || "";
        if (!level) return;
        const obj = await loadWorldLevel(world, level);
        api.setState(obj);
        clearGameStatus();
        requestRedraw();
      };

      // If there is a next level in the current list, go to it
      if (
        levelSel.selectedIndex >= 0 &&
        levelSel.selectedIndex < levelSel.options.length - 1
      ) {
        levelSel.selectedIndex = levelSel.selectedIndex + 1;
        await loadCurrent();
        return;
      }

      // Otherwise, try next world (first level)
      if (
        worldSel &&
        worldSel.selectedIndex >= 0 &&
        worldSel.selectedIndex < worldSel.options.length - 1
      ) {
        worldSel.selectedIndex = worldSel.selectedIndex + 1;
        const world = worldSel.value || ".";
        const levels = await loadLevelListForWorld(world);
        if (Array.isArray(levels) && levels.length) {
          levelSel.innerHTML = "";
          for (const l of levels) {
            const opt = document.createElement("option");
            opt.value = l;
            opt.textContent = l;
            levelSel.appendChild(opt);
          }
          levelSel.selectedIndex = 0;
          await loadCurrent();
          return;
        }
      }
    } catch (e) {
      console.warn("[main] next level failed", e);
    }
  },
  onReset: () => {
    api.reset();
    setBanner(null);
    gameOver = false;
    requestRedraw();
  },
  onToggleSolver: () => {
    const panel = document.getElementById("solverPanel");
    const btn = document.getElementById("toggleSolver");
    if (!panel || !btn) return;
    const willOpen = panel.classList.contains("hidden");
    __closePanelsExcept(willOpen ? "solver" : "");
    // Focus management
    if (!willOpen) {
      const ae = document.activeElement;
      if (ae && panel.contains(ae)) {
        try {
          btn.focus();
        } catch {}
      }
    } else {
      const first = panel.querySelector(
        'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (first && typeof first.focus === "function") {
        try {
          first.focus();
        } catch {}
      }
    }
  },
  onRefreshLevels: async () => {
    // Populate world and levels selects
    const worlds = await loadWorldList();
    const worldSel = document.getElementById("server-worlds");
    const levelSel = document.getElementById("server-levels");
    if (!worldSel || !levelSel) return;
    worldSel.innerHTML = "";
    for (const w of worlds) {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = w;
      worldSel.appendChild(opt);
    }
    if (worlds.length > 0) worldSel.selectedIndex = 0;
    const world = worldSel.value || worlds[0] || ".";
    const levels = await loadLevelListForWorld(world);
    levelSel.innerHTML = "";
    for (const l of levels) {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      levelSel.appendChild(opt);
    }
    // Auto-load first level on refresh
    if (levels && levels.length > 0) {
      levelSel.selectedIndex = 0;
      try {
        const obj = await loadWorldLevel(world, levels[0]);
        api.setState(obj);
        clearGameStatus();
        requestRedraw();
      } catch {}
    }

    // Attach change listener once to repopulate levels when world changes
    if (!worldSel.dataset.bindChange) {
      worldSel.addEventListener("change", async () => {
        const w = worldSel.value || ".";
        const lvl = await loadLevelListForWorld(w);
        levelSel.innerHTML = "";
        for (const nm of lvl) {
          const opt = document.createElement("option");
          opt.value = nm;
          opt.textContent = nm;
          levelSel.appendChild(opt);
        }
        // Auto-select and load the first level of the new world
        if (lvl && lvl.length > 0) {
          levelSel.selectedIndex = 0;
          try {
            const obj = await loadWorldLevel(w, lvl[0]);
            api.setState(obj);
            clearGameStatus();
            requestRedraw();
          } catch {}
        }
      });
      worldSel.dataset.bindChange = "1";
    }
  },
  onLoadLevel: async () => {
    const worldSel = document.getElementById("server-worlds");
    const levelSel = document.getElementById("server-levels");
    if (!worldSel || !levelSel) return;
    const obj = await loadWorldLevel(
      worldSel.value || ".",
      levelSel.value || ""
    );
    api.setState(obj);
    clearGameStatus();
    clearGameStatus();
    requestRedraw();
  },
  onExport: (name) => {
    const dto = api.getState(); // DrawDto with numeric ids
    const out = buildAuthoringLevel(dto, tileIdToName, entIdToName);
    exportLevel(out, (name || "level.authoring.json").trim());
  },

  onImport: async (file) => {
    const obj = await importLevel(file); // JSON parsed from file
    const normalized = normalizeImported(obj, {
      // ensure authoring shape
      tile: tileIdToName,
      entity: entIdToName,
    });
    api.setState(normalized); // Loader.cs accepts tileGrid + names
    api.commitBaseline && api.commitBaseline();
    clearGameStatus();
    requestRedraw();
  },

  onRunSolver: async ({ maxDepth, maxNodes, onProgress, onSolutions }) => {
    try {
      console.debug && console.debug("[main] onRunSolver start");
    } catch {}
    try {
      const cfg = {
        depthCap: Number(maxDepth) || 100,
        nodesCap: Number(maxNodes) || 200000,
        timeCapSeconds: 10.0,
        enforceTimeCap: false,
      };
      const levelDto = toLevelDTO(api.getState());
      // Use worker proxy for solver to keep UI responsive
      const worker = new Worker(
        new URL("./workers/ald-worker.js", import.meta.url),
        { type: "module" }
      );
      let nextId = 1;
      const pending = new Map();
      worker.onmessage = (ev) => {
        const { id, ok, result, error } = ev.data || {};
        const f = pending.get(id);
        if (!f) return;
        pending.delete(id);
        if (ok) f.resolve(result);
        else f.reject(new Error(error || "worker_error"));
      };
      const call = (cmd, ...args) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, cmd, args });
        });
      try {
        await call("init", { baseUrl: "./wasm/" });
      } catch {}
      const report = await call("solverAnalyze", levelDto, cfg);
      try {
        console.debug && console.debug("Solver report:", report);
      } catch {}
      // Unpack topSolutions -> moves strings
      const unpackMovesPacked = (bytes, length) => {
        const dirToChar = ["w", "d", "s", "a"]; // N,E,S,W
        if (!bytes || length <= 0) return "";
        let arr;
        if (typeof bytes === "string") {
          // base64 string -> Uint8Array
          try {
            const bin = atob(bytes);
            arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          } catch {
            arr = [];
          }
        } else if (Array.isArray(bytes)) {
          arr = bytes;
        } else if (bytes && typeof bytes.length === "number") {
          arr = Array.from(bytes);
        } else {
          arr = [];
        }
        const out = [];
        for (let i = 0; i < length; i++) {
          const byteIdx = i >> 2;
          const shift = (i & 3) * 2;
          const mv = ((arr[byteIdx] || 0) >> shift) & 0b11;
          out.push(dirToChar[mv] || "");
        }
        return out.join("");
      };
      const pickSolutionsArray = (rep) =>
        rep?.topSolutions ||
        rep?.TopSolutions ||
        rep?.solutions ||
        rep?.Solutions ||
        [];
      const top = pickSolutionsArray(report);
      const solutions = top
        .map((e) => {
          const len = (e.length ?? e.Length) | 0;
          const mstr = e.moves || e.Moves;
          const packed = e.movesPacked ?? e.MovesPacked;
          const moves =
            typeof mstr === "string" && mstr
              ? mstr
              : unpackMovesPacked(packed, len);
          return { length: len, moves };
        })
        .sort((a, b) => (a.length | 0) - (b.length | 0));
      const stats = {
        nodesExpanded:
          (report.nodesExplored ??
            report.NodesExplored ??
            report.nodes ??
            report.Nodes) | 0,
      };
      onSolutions &&
        onSolutions({ solutions, deadEnds: [], stats, reportRaw: report });
      try {
        worker.terminate();
      } catch {}
    } catch (err) {
      try {
        console.error && console.error("[main] onRunSolver error", err);
      } catch {}
      onProgress && onProgress("Error: " + (err?.message || String(err)));
    }
  },
  onStopSolver: () => {},
  onPlaySolution: async (moves) => {
    try {
      if (!moves || typeof moves !== "string") return;
      // Start from current state; if you prefer, call api.reset() here
      const map = { w: 0, d: 1, s: 2, a: 3 };
      for (const ch of moves) {
        const dir = map[ch];
        if (dir == null) continue;
        const r = api.step(dir);
        if (r && (r.win || r.lose)) {
          setBanner(r.win ? "win" : "lose");
          requestRedraw();
          break;
        }
        requestRedraw();
        await new Promise((r) => setTimeout(r, 140));
      }
    } catch {}
  },
  onExportSolution: (moves) => {
    try {
      if (!moves || typeof moves !== "string") return;
      const data = { moves, length: moves.length };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "solution.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  },
});

// ---- swipe input ----
function installSwipe(el, cb, opts = {}) {
  const THRESH = opts.threshold ?? 24; // px required to count
  let id = null,
    x0 = 0,
    y0 = 0;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    el.setPointerCapture(id);
  });

  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    id = null;
    if (Math.hypot(dx, dy) < THRESH) return;
    cb(
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
        ? "down"
        : "up"
    );
  });

  el.addEventListener("pointercancel", () => {
    id = null;
  });
}

//const canvasEl = document.getElementById("game");
const dirIdx = { up: 0, right: 1, down: 2, left: 3 };

installSwipe(canvasEl, (dir) => {
  if (!canvasEl) return;
  if (isAnyMenuOpen() || buildMode || gameOver) return;

  const d = dirIdx[dir];
  if (d == null) return;

  try {
    const r = api.step(d); // <-- use your engine wrapper
    if (r && (r.win || r.lose)) {
      gameOver = true;
      setBanner(r.win ? "win" : "lose");
    } else {
      setBanner(null);
    }
  } finally {
    requestRedraw(); // <-- paint the new frame
  }
});

// Keyboard controls (WASD/Arrows)
const keyToDir = new Map([
  ["ArrowUp", 0],
  ["KeyW", 0],
  ["ArrowRight", 1],
  ["KeyD", 1],
  ["ArrowDown", 2],
  ["KeyS", 2],
  ["ArrowLeft", 3],
  ["KeyA", 3],
]);
function logPlayerState(prefix = "After move") {
  try {
    const st = api.getState();
    const p = st && st.player ? st.player : null;
    if (!p) return;
    // entryDir: 0=N,1=E,2=S,3=W, or -1 when none
    console.log(prefix, {
      x: p.x,
      y: p.y,
      attached: p.attached,
      entryDir: p.entryDir,
    });
  } catch {}
}
window.addEventListener("keydown", (e) => {
  const ae = document.activeElement;
  const typing =
    ae &&
    ((ae.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit", "reset"].includes(ae.type)) ||
      ae.tagName === "TEXTAREA" ||
      ae.isContentEditable);
  if (typing) return;
  // Pause game inputs if any UI menu/panel is open
  if (isAnyMenuOpen()) return;
  // Reset with R regardless of build mode
  if (e.code === "KeyR") {
    e.preventDefault();
    api.reset();
    setBanner(null);
    gameOver = false;
    requestRedraw();
    logPlayerState("After reset");
    return;
  }
  const dir = keyToDir.get(e.code);
  if (dir == null) return;
  e.preventDefault();
  if (buildMode || gameOver) return;
  try {
    const r = api.step(dir);
    logPlayerState("After step");
    if (r && (r.win || r.lose)) {
      gameOver = true;
      setBanner(r.win ? "win" : "lose");
    } else {
      setBanner(null);
    }
  } finally {
    requestRedraw();
  }
});

// Export default for potential consumers
export default api;

// Populate worlds/levels on first load
(async () => {
  try {
    const refreshBtn = document.getElementById("refresh-server");
    if (refreshBtn) refreshBtn.click();
  } catch {}
})();
function buildDtoV2(dto) {
  // Prefer catalogs from engine if available
  const tiles =
    (typeof ex !== "undefined" && ex.getTiles ? ex.getTiles() : []) || [];
  const ents =
    (typeof ex !== "undefined" && ex.getEntities ? ex.getEntities() : []) || [];

  // id -> stable code slug
  const toSlug = (s) =>
    "core:" +
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const tileCodes = {};
  for (const t of tiles) {
    if (t && Number.isInteger(t.id)) tileCodes[String(t.id)] = toSlug(t.name);
  }

  const entityCodes = {};
  for (const e of ents) {
    if (e && Number.isInteger(e.id)) entityCodes[String(e.id)] = toSlug(e.name);
  }

  return {
    format: { kind: "dto-v2", version: "1.0" },
    w: dto.w | 0,
    h: dto.h | 0,
    tileCodes, // e.g. { "0":"core:floor", "1":"core:wall", ... }
    tiles: Array.from(dto.tiles || []), // length = w*h, numeric ids
    entityCodes, // e.g. { "2":"core:box_heavy", ... }
    entities: Array.from(dto.entities || []).map((e) => ({
      id: e.id | 0,
      type: e.type | 0,
      x: e.x | 0,
      y: e.y | 0,
      rot: e.rot | 0,
    })),
    player: { x: dto.player?.x | 0, y: dto.player?.y | 0 },
  };
}

// Convert the current DrawDto (api.getState) to Loader LevelDTO schema
function toLevelDTO(draw) {
  const w = draw.w | 0,
    h = draw.h | 0;
  const tileGrid = Array.from({ length: h }, (_, y) => new Array(w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = draw.tiles[y * w + x];
      tileGrid[y][x] = tileIdToName[id] || "Floor";
    }
  }
  const entities = [];
  // Represent player as a PlayerSpawn entity for Loader
  if (
    draw.player &&
    Number.isInteger(draw.player.x) &&
    Number.isInteger(draw.player.y)
  ) {
    entities.push({ type: "PlayerSpawn", x: draw.player.x, y: draw.player.y });
  }
  // Copy other entities mapping id->name and orientation if present
  for (const e of draw.entities || []) {
    const name = entIdToName[e.type];
    if (!name || name === "PlayerSpawn") continue;
    const out = { type: name, x: e.x | 0, y: e.y | 0 };
    if (Number.isInteger(e.rot)) {
      const rotNames = ["N", "E", "S", "W"];
      out.orientation = rotNames[(e.rot | 0) & 3];
    }
    entities.push(out);
  }
  return { width: w, height: h, tileGrid, entities };
}

// Auto Creator minimal UI
try {
  setupAutoLiteUI(api);
} catch {}

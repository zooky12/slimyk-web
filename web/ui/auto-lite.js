// ui/auto-lite.js - cleaned and functional Auto Creator UI
export function setupAutoLiteUI(api) {
  // Lightweight worker RPC for ALD (fallback to main-thread API if worker fails)
  function makeAldProxy(api){
    try {
      const worker = new Worker(new URL('../workers/ald-worker.js', import.meta.url), { type:'module' });
      let nextId = 1;
      const pending = new Map();
      worker.onmessage = (ev)=>{
        const { id, ok, result, error } = ev.data || {};
        const f = pending.get(id); if (!f) return;
        pending.delete(id);
        if (ok) f.resolve(result); else f.reject(new Error(error || 'worker_error'));
      };
      const call = (cmd, ...args)=> new Promise((resolve, reject)=>{
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, cmd, args });
      });
      // init runtime once
      call('init', { baseUrl: '../wasm/' }).catch(()=>{});
      return {
        aldNewContext: (settings)=> call('aldNewContext', settings),
        aldCloseContext: (ctxId)=> call('aldCloseContext', ctxId),
        aldInsertCandidate: (ctxId, level, cfg)=> call('aldInsertCandidate', ctxId, level, cfg),
        aldGetBucketsSummary: (ctxId)=> call('aldGetBucketsSummary', ctxId),
        aldSelectBaseCtx: (ctxId, topK, skew)=> call('aldSelectBaseCtx', ctxId, topK, skew),
        aldMutate: (ctxId, base, mutate)=> call('aldMutate', ctxId, base, mutate),
        __dispose: ()=> worker.terminate()
      };
    } catch {
      return api; // fallback
    }
  }
  const ald = makeAldProxy(api);
  const tilesChips = document.getElementById("autoTilesChips");
  const entsChips = document.getElementById("autoEntitiesChips");
  const addBucketBtn = document.getElementById("addBucket");
  const bucketRows = document.getElementById("bucketRows");
  const runBtn = document.getElementById("runAuto");
  const stopBtn = document.getElementById("stopAuto");
  const restoreBtn = document.getElementById("autoRestore");
  const progressEl = document.getElementById("autoProgress");
  const toggleBtn = document.getElementById("toggleAuto");
  const panelEl = document.getElementById("autoPanel");

  // --- helpers
  const nice = (name) =>
    String(name || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase());
  function bindChipToggles(root) {
    if (!root) return;
    root.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button.tile-chip");
      if (!btn || !root.contains(btn)) return;
      const on = btn.classList.toggle("active");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function createChipRow(kind, name, label, defaults) {
    const row = document.createElement("div");
    row.className = "chip-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile-chip";
    if (kind === 'tile') btn.dataset.tile = name; else btn.dataset.entity = name;
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = label;
    const min = document.createElement("input");
    min.type = "number";
    min.placeholder = "min -1";
    min.title = "Min count (-1 = no limit)";
    min.className = "count-input min";
    min.dataset.kind = kind;
    min.dataset.name = name;
    min.style.width = "60px";
    const max = document.createElement("input");
    max.type = "number";
    max.placeholder = "max -1";
    max.title = "Max count (-1 = no limit)";
    max.className = "count-input max";
    max.dataset.kind = kind;
    max.dataset.name = name;
    max.style.width = "60px";
    // Defaults: -1 means unused; keep existing safe defaults for Exit/PlayerSpawn
    const dmin = (defaults && Number.isFinite(defaults.min)) ? Number(defaults.min) : -1;
    const dmax = (defaults && Number.isFinite(defaults.max)) ? Number(defaults.max) : -1;
    min.value = String(dmin);
    max.value = String(dmax);
    row.appendChild(btn);
    row.appendChild(min);
    row.appendChild(max);
    return row;
  }
  // (legacy scoring/helpers removed; C# context owns scoring and filtering)
  function unpackMovesPacked(bytes, length) {
    const dirToChar = ["w", "d", "s", "a"]; // N,E,S,W
    if (!bytes || length <= 0) return "";
    let arr;
    if (typeof bytes === "string") {
      try {
        const bin = atob(bytes);
        arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      } catch {
        arr = [];
      }
    } else if (Array.isArray(bytes)) arr = bytes;
    else if (bytes && typeof bytes.length === "number") arr = Array.from(bytes);
    else arr = [];
    const out = [];
    for (let i = 0; i < length; i++) {
      const byteIdx = i >> 2;
      const shift = (i & 3) * 2;
      const mv = ((arr[byteIdx] || 0) >> shift) & 0b11;
      out.push(dirToChar[mv] || "");
    }
    return out.join("");
  }

  // Cache shortest-solution move strings per base level (keyed by JSON signature)
  const baseSolutionCache = new Map();

  function levelKey(dto){
    try {
      // Stable-ish signature for caching; compact to reduce memory
      const ents = Array.from(dto.entities || [])
        .map(e => `${e.type}@${e.x},${e.y}${e.orientation?`:${e.orientation}`:``}`)
        .sort();
      return JSON.stringify({ w:dto.width|0, h:dto.height|0, t:dto.tileGrid, e:ents });
    } catch { return JSON.stringify(dto || {}); }
  }

  async function getShortestMovesForBase(baseDto, solverCfg){
    const key = levelKey(baseDto);
    if (baseSolutionCache.has(key)) return baseSolutionCache.get(key);
    try {
      const rep = await api.solverAnalyze(baseDto, solverCfg);
      const top = rep && rep.topSolutions && rep.topSolutions[0];
      if (!top || !top.length || !top.movesPacked){ baseSolutionCache.set(key, null); return null; }
      const moves = unpackMovesPacked(top.movesPacked, top.length);
      baseSolutionCache.set(key, moves);
      return moves;
    } catch {
      baseSolutionCache.set(key, null);
      return null;
    }
  }

  async function sequenceSolvesLevel(levelDto, movesStr){
    if (!movesStr || !movesStr.length) return false;
    try {
      // Create an isolated session for fast simulation
      const sid = api.initLevel(levelDto);
      const charToDir = { w:0, d:1, s:2, a:3 };
      for (let i = 0; i < movesStr.length; i++){
        const c = movesStr[i];
        const dir = charToDir[c];
        if (dir == null) continue;
        const r = api.stepAndState(sid, dir);
        const step = r && r.step;
        if (step && step.win) return true; // solved by prefix of base solution
        if (step && step.lose) return false; // dead early => can't be same solution
      }
      return false;
    } catch { return false; }
  }
  function catalogs() {
    const tiles = (typeof api.getTiles === "function" ? api.getTiles() : []) || [];
    const ents = (typeof api.getEntities === "function" ? api.getEntities() : []) || [];
    const tileIdToName = Object.create(null);
    const entIdToName = Object.create(null);
    for (const t of tiles) if (t) tileIdToName[t.id] = t.name;
    for (const e of ents) if (e) entIdToName[e.id] = e.name;
    return { tiles, ents, tileIdToName, entIdToName };
  }
  function toLevelDTOFromDraw(draw, idToTile, idToEnt) {
    const w = draw.w | 0;
    const h = draw.h | 0;
    const tileGrid = Array.from({ length: h }, (_, y) => new Array(w));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        tileGrid[y][x] = idToTile[draw.tiles[y * w + x]] || "Floor";
    const entities = [];
    if (draw.player && Number.isInteger(draw.player.x) && Number.isInteger(draw.player.y))
      entities.push({ type: "PlayerSpawn", x: draw.player.x, y: draw.player.y });
    for (const e of draw.entities || []) {
      const name = idToEnt[e.type];
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
  function parseRules(text) {
    if (text == null) return {};
    if (typeof text === "object") return text;
    if (typeof text !== "string") return {};
    // allow // comment lines in textarea
    const noComments = text.replace(/^\s*\/\/.*$/gm, "");
    try {
      return JSON.parse(noComments);
    } catch {
      return {};
    }
  }
  function matchesBucket(rules, report) {
    try {
      const top = pickSolutionsArray(report);
      if (!top || top.length === 0) return false; // skip unsolvable
      const fastest = top.length ? Math.min(...top.map((s) => (s.length ?? s.Length) | 0)) : Infinity;
      const deadCount = (report.deadEnds ?? report.DeadEnds ?? []).length || 0;
      if (rules.minSolutions && top.length < rules.minSolutions) return false;
      if (rules.maxSolutions && top.length > rules.maxSolutions) return false;
      if (rules.minFastest && !(fastest >= rules.minFastest)) return false;
      if (rules.maxFastest && !(fastest <= rules.maxFastest)) return false;
      if (rules.minDeadEnds && !(deadCount >= rules.minDeadEnds)) return false;
      if (rules.maxDeadEnds && !(deadCount <= rules.maxDeadEnds)) return false;
      return true;
    } catch {
      return false;
    }
  }
  function mutateLevel(level, tilesAllowed, entsAllowed) {
    // Extremely simple mutator as a fallback when C# ALD is not available
    const w = level.width | 0;
    const h = level.height | 0;
    const copy = JSON.parse(JSON.stringify(level));
    // mutate a random tile if any allowed tile
    if (tilesAllowed && tilesAllowed.length) {
      const x = (Math.random() * w) | 0;
      const y = (Math.random() * h) | 0;
      const name = tilesAllowed[(Math.random() * tilesAllowed.length) | 0];
      copy.tileGrid[y][x] = name;
    }
    // ensure PlayerSpawn uniqueness if selected
    if (entsAllowed?.includes("PlayerSpawn")) {
      copy.entities = (copy.entities || []).filter((e) => e.type !== "PlayerSpawn");
      copy.entities.push({ type: "PlayerSpawn", x: (w / 2) | 0, y: (h / 2) | 0 });
    }
    return copy;
  }

  // --- populate chips from catalogs
  try {
    const tiles = api.getTiles?.() || [];
    if (tilesChips && Array.isArray(tiles)) {
      tilesChips.innerHTML = "";
      for (const t of tiles) {
        if (!t || typeof t.name !== "string") continue;
        const label = nice(t.name);
        // Default: Exit min=1 to keep solvable unless user overrides
        const defaults = (t.name === 'Exit') ? { min: 1, max: -1 } : undefined;
        tilesChips.appendChild(createChipRow('tile', t.name, label, defaults));
      }
      bindChipToggles(tilesChips);
    }
  } catch {}
  try {
    const ents = api.getEntities?.() || [];
    if (entsChips && Array.isArray(ents)) {
      entsChips.innerHTML = "";
      for (const e of ents) {
        if (!e || typeof e.name !== "string") continue;
        const label = nice(e.name).replace("Box Basic", "Box");
        // Default: PlayerSpawn min=1 enforced unless overridden below for explicit PlayerSpawn row
        if (e.name === 'PlayerSpawn') continue; // we'll add explicit one next
        entsChips.appendChild(createChipRow('entity', e.name, label));
      }
      // explicit PlayerSpawn chip (movable single-spawn)
      entsChips.appendChild(createChipRow('entity', 'PlayerSpawn', 'Player Spawn', { min: 1, max: -1 }));
      bindChipToggles(entsChips);
    }
  } catch {}

  // --- buckets
  const buckets = [];
  const BUCKET_PRESETS = {
    // Full C# BucketConfig JSON defaults
    Easy: JSON.stringify({
      name: "Easy",
      topK: 20,
      features: [
        { id: "solutionLength", mode: "Band", bandMin: 15, bandMax: 30, weight: 1, hard: true },
        { id: "solutionsFilteredCount", mode: "Band", bandMin: 1, bandMax: 3, weight: 1, hard: false },
        { id: "deadEndsNearTop1Count", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.3, hard: false },
        { id: "deadEndsAverageDepth", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.1, hard: false }
      ]
    }, null, 2),
    Medium: JSON.stringify({
      name: "Medium",
      topK: 20,
      features: [
        { id: "solutionLength", mode: "Band", bandMin: 30, bandMax: 50, weight: 1, hard: true },
        { id: "solutionsFilteredCount", mode: "Band", bandMin: 1, bandMax: 3, weight: 1, hard: false },
        { id: "deadEndsNearTop1Count", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.3, hard: false },
        { id: "deadEndsAverageDepth", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.1, hard: false }
      ]
    }, null, 2),
    Hard: JSON.stringify({
      name: "Hard",
      topK: 20,
      features: [
        { id: "solutionLength", mode: "Band", bandMin: 50, bandMax: 70, weight: 1, hard: true },
        { id: "solutionsFilteredCount", mode: "Band", bandMin: 1, bandMax: 3, weight: 1, hard: false },
        { id: "deadEndsNearTop1Count", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.3, hard: false },
        { id: "deadEndsAverageDepth", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.1, hard: false }
      ]
    }, null, 2),
    Hardest: JSON.stringify({
      name: "Hardest",
      topK: 0, // unlimited
      features: [
        { id: "solutionLength", mode: "Band", bandMin: 70, bandMax: 99999, weight: 1, hard: true },
        { id: "solutionsFilteredCount", mode: "Band", bandMin: 1, bandMax: 3, weight: 1, hard: false },
        { id: "deadEndsNearTop1Count", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.3, hard: false },
        { id: "deadEndsAverageDepth", mode: "Infinite", bandMin: 0, bandMax: 0, weight: 0.1, hard: false }
      ]
    }, null, 2)
  };
  function renderBuckets() {
    if (!bucketRows) return;
    bucketRows.innerHTML = "";
    buckets.forEach((b, idx) => {
      const row = document.createElement("div");
      row.className = "levels-row";
      const label = document.createElement("div");
      // show weights summary for base buckets
      let weightsSummary = "";
      try {
        const br = parseRules(b.rules);
        const w = br && br.weights;
        if (w) {
          const f = (n) =>
            Object.prototype.hasOwnProperty.call(w, n) ? Number(w[n]).toFixed(2) : "-";
          weightsSummary = ` [w: fast:${f("fastest")}, sol:${f("solutions")}, dead:${f("deadEnds")}, nodes:${f("nodes")}]`;
        }
      } catch {}
      label.textContent = `${b.name} - ${b.preset}${weightsSummary}`;
      const rules = document.createElement("textarea");
      rules.rows = 2;
      rules.placeholder = "Bucket rules (editable JSON or notes)";
      rules.value = b.rules || "";
      rules.addEventListener("input", () => (b.rules = rules.value));
      const del = document.createElement("button");
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        buckets.splice(idx, 1);
        renderBuckets();
      });
      row.appendChild(label);
      row.appendChild(rules);
      row.appendChild(del);
      bucketRows.appendChild(row);
    });
  }
  function addDefaultBuckets() {
    const base = ["Easy", "Medium", "Hard", "Hardest"];
    for (const p of base) {
      const presetText = BUCKET_PRESETS[p];
      const rulesText = typeof presetText === "string" ? presetText : JSON.stringify(presetText || {}, null, 2);
      buckets.push({ name: p, preset: p, rules: rulesText });
    }
    renderBuckets();
  }
  addDefaultBuckets();
  if (addBucketBtn) {
    addBucketBtn.addEventListener("click", () => {
      const nameEl = document.getElementById("bucketName");
      const presetEl = document.getElementById("bucketHeuristic");
      const name = (nameEl?.value || "").trim();
      const preset = presetEl?.value || "Neutral";
      if (!name) return;
      let rulesText;
      const presetText = BUCKET_PRESETS[preset];
      if (typeof presetText === "string") rulesText = presetText;
      else rulesText = JSON.stringify(presetText || {}, null, 2);
      buckets.push({ name, preset, rules: rulesText });
      if (nameEl) nameEl.value = "";
      renderBuckets();
    });
  }

  // --- toggle Auto panel (and close other panels)
  if (toggleBtn && panelEl) {
    toggleBtn.addEventListener("click", () => {
      const expanded = toggleBtn.getAttribute("aria-pressed") === "true";
      const next = !expanded;
      // Let main close other panels consistently
      try { window.__closePanelsExcept && window.__closePanelsExcept(next ? "auto" : ""); } catch {}
      // Ensure our own toggle state reflects the result
      toggleBtn.setAttribute("aria-pressed", next ? "true" : "false");
      toggleBtn.classList.toggle("active", next);
      panelEl.classList.toggle("hidden", !next);
      panelEl.setAttribute("aria-hidden", next ? "false" : "true");
    });
    // Prevent game key handling while typing within panel
    panelEl.addEventListener("keydown", (e) => e.stopPropagation());
  }

  // --- run/stop/restore
  let cancel = false;
  let snapshot = null;
  // Persist an ALD context across runs when using "Keep Running"
  let persistentCtxId = null;
  async function pickBaseForMutation(grouped, snapshot) {
    try {
      const topK = Math.max(1, Number(document.getElementById("autoSelectTopK")?.value) || 5);
      const skew = Math.max(0, Number(document.getElementById("autoSelectSkew")?.value) || 1);
      const pool = [];
      const names = Object.keys(grouped || {});
      for (const bname of names) {
        const arr = grouped[bname] || [];
        for (let i = 0; i < Math.min(topK, arr.length); i++) {
          const e = arr[i];
          pool.push({ score: e.score ?? 0, level: e.level });
        }
      }
      if (pool.length === 0) return snapshot;
      // Prefer C# selection when available
      if (api.aldSelectBase) {
        try {
          const res = await api.aldSelectBase(pool, topK, skew);
          if (res && res.ok && res.level) return res.level;
        } catch {}
      }
      // Fallback to JS weighting
      let min = Infinity; for (const e of pool) if (e.score < min) min = e.score;
      const eps = 1e-6;
      const weights = pool.map(e => Math.pow((e.score - min) + eps, skew <= 0 ? 1 : skew));
      let sum = 0; for (const w of weights) sum += w;
      let r = Math.random() * (sum > 0 ? sum : 1);
      for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i].level; }
      return pool[pool.length - 1].level;
    } catch { return snapshot; }
  }

  async function runAuto({ keep=false } = {}) {
    try {
      cancel = false;
      if (runBtn) runBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      if (progressEl) progressEl.textContent = "Running...";
      console.log("[auto] run start");
      const { tileIdToName, entIdToName } = catalogs();
      const baseDraw = api.getState();
      snapshot = toLevelDTOFromDraw(baseDraw, tileIdToName, entIdToName);
      // Build C# context settings from UI presets (buckets JSON)
      function toBucketConfig(name, rulesText) {
        // Buckets presets are already full C# BucketConfig JSON; just parse and return
        try {
          const bc = JSON.parse(rulesText);
          if (!bc.name) bc.name = name;
          if (bc.topK == null && name === 'Hardest') bc.topK = 0;
          return bc;
        } catch {
          return { name, topK: name==='Hardest'?0:20, features: [] };
        }
      }
      function buildContextSettings() {
        const bucketsCfg = buckets.map(b => toBucketConfig(b.name, b.rules));
        const solver = {
          NodesCap: Number(document.getElementById("solverMaxNodes")?.value) || 200000,
          DepthCap: Number(document.getElementById("solverMaxDepth")?.value) || 10000,
          TimeCapSeconds: 10.0,
          EnforceTimeCap: false
        };
        const selection = {
          topK: Math.max(1, Number(document.getElementById("autoSelectTopK")?.value) || 5),
          skew: Math.max(0, Number(document.getElementById("autoSelectSkew")?.value) || 1)
        };
        // Collect allowed tiles/entities from UI chips
        const tilesSel = Array.from(
          document.querySelectorAll('#autoTilesChips .tile-chip.active') || []
        ).map(b => b.dataset.tile).filter(Boolean);
        const entsSel = Array.from(
          document.querySelectorAll('#autoEntitiesChips .tile-chip.active') || []
        ).map(b => b.dataset.entity).filter(Boolean);

        // Collect min/max counts
        function collectCounts(rootSelector, kind, specialNames){
          const rows = document.querySelectorAll(`${rootSelector} .chip-row`) || [];
          const out = {};
          for (const row of rows){
            const btn = row.querySelector('button.tile-chip');
            if (!btn) continue;
            const name = kind === 'tile' ? btn.dataset.tile : btn.dataset.entity;
            if (!name) continue;
            const minEl = row.querySelector('input.count-input.min');
            const maxEl = row.querySelector('input.count-input.max');
            const vmin = Number(minEl?.value ?? -1);
            const vmax = Number(maxEl?.value ?? -1);
            const useNullToOverride = specialNames && specialNames.has(name);
            const minVal = (vmin >= 0) ? (vmin|0) : (useNullToOverride ? null : undefined);
            const maxVal = (vmax >= 0) ? (vmax|0) : (useNullToOverride ? null : undefined);
            if (minVal !== undefined || maxVal !== undefined){
              out[name] = { min: minVal ?? null, max: maxVal ?? null };
            }
          }
          return out;
        }
        const tileCounts = collectCounts('#autoTilesChips', 'tile', new Set(['Exit']));
        const entityCounts = collectCounts('#autoEntitiesChips', 'entity', new Set(['PlayerSpawn']));
        const mutation = {
          stepsBase: Math.max(1, Number(document.getElementById("autoBaseChanges")?.value) || 5),
          stepsEvolve: Math.max(1, Number(document.getElementById("autoEvolveChanges")?.value) || 1),
          tilesPlace: tilesSel.length ? tilesSel : undefined,
          entitiesPlace: entsSel.length ? entsSel : undefined,
          greedyRatio: Math.max(0, Math.min(1, Number(document.getElementById('autoGreedyRatio')?.value) || 0)),
          tileCounts: Object.keys(tileCounts).length ? tileCounts : undefined,
          entityCounts: Object.keys(entityCounts).length ? entityCounts : undefined,
          operatorWeights: {
            replaceTile: 0.15,
            placeEntity: 0.10,
            removeEntity: 0.05,
            greedyPlaceOne: 0.05,
            greedyRemoveOne: 0.05
          }
        };
        // Move player only if PlayerSpawn is allowed
        if (entsSel && entsSel.length) mutation.movePlayer = entsSel.includes('PlayerSpawn');
        const dedupe = { T_sol: 0.12, T_layout: 0.25, w_tiles: 0.4, w_entities: 0.4, w_spatial: 0.2 };
        return { generator: {}, buckets: bucketsCfg, solver, selection, mutation, dedupe };
      }
      let ctxId = persistentCtxId;
      if (!keep || !ctxId) {
        // Start fresh: optionally close previous
        if (!keep && ctxId) {
          try { await (ald.aldCloseContext ? ald.aldCloseContext(ctxId) : api.aldCloseContext(ctxId)); } catch {}
        }
        try {
          const ctxRes = await (ald.aldNewContext ? ald.aldNewContext(buildContextSettings()) : api.aldNewContext(buildContextSettings()));
          if (ctxRes && ctxRes.ok) {
            ctxId = ctxRes.ctxId;
            persistentCtxId = ctxId;
          }
        } catch {}
      }
      const tilesSel = Array.from(
        tilesChips?.querySelectorAll(".tile-chip.active") || []
      )
        .map((b) => b.dataset.tile)
        .filter(Boolean);
      const entsSel = Array.from(
        entsChips?.querySelectorAll(".tile-chip.active") || []
      )
        .map((b) => b.dataset.entity)
        .filter(Boolean);
      const cfg = {
        depthCap:
          Number(document.getElementById("solverMaxDepth")?.value) || 100,
        nodesCap:
          Number(document.getElementById("solverMaxNodes")?.value) || 200000,
        timeCapSeconds: 5.0,
        enforceTimeCap: false,
      };
      const bucketDefs = buckets.slice();
      const attempts =
        Number(document.getElementById("autoAttemptsCount")?.value) || 20;
      const baseChanges = Math.max(1, Number(document.getElementById("autoBaseChanges")?.value) || 1);
      const evolveChanges = Math.max(1, Number(document.getElementById("autoEvolveChanges")?.value) || 1);
      let accum = { sel:0, mut:0, ins:0, sum:0, n:0 };
      for (let i = 0; i < attempts && !cancel; i++) {
        const tAttempt0 = performance.now();
        // Choose base via C# context; fallback to snapshot
        const tSel0 = performance.now();
        let base = snapshot;
        let evolve = false;
        // Probability to use the original snapshot as base instead of a bucket pick
        const baseUseRatio = Math.max(0, Math.min(1, Number(document.getElementById('autoBaseUseRatio')?.value) || 0));
        const pickSnapshot = Math.random() < baseUseRatio;
        if (!pickSnapshot && ctxId) {
          try {
            const selTopK = Math.max(1, Number(document.getElementById("autoSelectTopK")?.value) || 5);
            const selSkew = Math.max(0, Number(document.getElementById("autoSelectSkew")?.value) || 1);
            const sel = await (ald.aldSelectBaseCtx ? ald.aldSelectBaseCtx(ctxId, selTopK, selSkew) : api.aldSelectBaseCtx(ctxId, selTopK, selSkew));
            if (sel && sel.ok && sel.level) { base = sel.level; evolve = true; }
          } catch {}
        }
        const tSel1 = performance.now();
        const selMs = tSel1 - tSel0;
        const nChanges = evolve ? evolveChanges : baseChanges;
        // mutate in C# context if available
        const tMut0 = performance.now();
        let lvl = base;
        if (ctxId) {
          try {
            const mu = await (ald.aldMutate ? ald.aldMutate(ctxId, base, { evolve }) : api.aldMutate(ctxId, base, { evolve }));
            if (mu && mu.ok && mu.level) lvl = mu.level;
          } catch {}
        }
        const tMut1 = performance.now();
        const mutMs = tMut1 - tMut0;

        // Fast discard: if base's shortest solution also solves the mutated level, skip insert
        try {
          const baseMoves = await getShortestMovesForBase(base, cfg);
          if (baseMoves){
            const works = await sequenceSolvesLevel(lvl, baseMoves);
            if (works){
              // Skip inserting this candidate as it's too similar
              if (progressEl && (i % 3 === 0)) progressEl.textContent = `Discarded similar ${i + 1}/${attempts}`;
              continue;
            }
          }
        } catch {}
        // Insert into C# buckets
        const tIns0 = performance.now();
        if (ctxId) {
          try { await (ald.aldInsertCandidate ? ald.aldInsertCandidate(ctxId, lvl, cfg) : api.aldInsertCandidate(ctxId, lvl, cfg)); } catch {}
        }
        const tIns1 = performance.now();
        const insMs = tIns1 - tIns0;
        // Refresh list from C# buckets
        let grouped = null;
        const tSum0 = performance.now();
        const refreshEvery = Math.max(1, Number(document.getElementById('autoRefreshEvery')?.value) || 7);
        if (ctxId && (i % refreshEvery === 0 || i === attempts - 1)) {
          try {
            const sum = await (ald.aldGetBucketsSummary ? ald.aldGetBucketsSummary(ctxId) : api.aldGetBucketsSummary(ctxId));
            if (sum && sum.ok) grouped = sum.buckets;
          } catch {}
        }
        const tSum1 = performance.now();
        const sumMs = tSum1 - tSum0;
        accum.sel += selMs; accum.mut += mutMs; accum.ins += insMs; accum.sum += sumMs; accum.n++;
        if (i % 5 === 0) {
          console.log(`[auto] attempt ${i + 1}/${attempts} ms sel:${selMs.toFixed(1)} mut:${mutMs.toFixed(1)} ins:${insMs.toFixed(1)} sum:${sumMs.toFixed(1)} avg sel:${(accum.sel/accum.n).toFixed(1)} mut:${(accum.mut/accum.n).toFixed(1)} ins:${(accum.ins/accum.n).toFixed(1)} sum:${(accum.sum/accum.n).toFixed(1)}`);
        }
        if (i % 3 === 0 && progressEl) progressEl.textContent = `Generated ${i + 1}/${attempts}`;
        if (grouped) renderResultsFromSummary(grouped);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (progressEl) progressEl.textContent = cancel ? "Canceled" : "Done";
    } finally {
      if (runBtn) runBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    }
  }
  function stopAuto() {
    cancel = true;
    if (progressEl) progressEl.textContent = "Canceling...";
  }
  function restoreSnapshot() {
    if (!snapshot) return;
    try {
      api.setState(snapshot);
      try { if (window.requestRedraw) window.requestRedraw(); } catch {}
    } catch (e) {
      console.warn("[auto] restore failed", e);
    }
  }
  if (runBtn) runBtn.addEventListener("click", () => runAuto({ keep:false }));
  const keepBtn = document.getElementById("keepRunning");
  if (keepBtn) keepBtn.addEventListener("click", () => runAuto({ keep:true }));
  if (stopBtn) stopBtn.addEventListener("click", stopAuto);
  if (restoreBtn) restoreBtn.addEventListener("click", restoreSnapshot);

  // --- results UI
  function renderResults(grouped) {
    const resultsEl = document.getElementById("autoList");
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    const names = Object.values(grouped || {}).map(b=> b.name || "");
    (grouped || []).forEach((bucket) => {
      const bucketName = bucket.name || "Bucket";
      const entries = bucket.entries || [];
      const section = document.createElement("div");
      section.className = "bucketSection";
      const head = document.createElement("h4");
      head.textContent = `${bucketName} (${entries.length})`;
      section.appendChild(head);
      entries.forEach((entry, idx) => {
        const row = document.createElement("div");
        row.className = "levels-row";
        const label = document.createElement("div");
        label.className = "solutionText";
        const m = entry.metrics || {};
        const scoreStr = (entry.score != null) ? ` hv:${(entry.score).toFixed(2)}` : "";
        const fastest = m.solutionLength ?? m.fastest ?? "-";
        const sols = m.solutionsFilteredCount ?? m.solutions ?? "-";
        label.textContent = `#${idx + 1} sols:${sols} fastest:${fastest}${scoreStr}`;
        const actions = document.createElement("div");
        actions.className = "solutionActions";
        const useBtn = document.createElement("button");
        useBtn.textContent = "Use";
        useBtn.addEventListener("click", () => api.setState(entry.level));
        actions.appendChild(useBtn);
        row.appendChild(label);
        row.appendChild(actions);
        section.appendChild(row);
      });
      resultsEl.appendChild(section);
    });
  }

  function renderResultsFromSummary(bucketsSummary){
    const resultsEl = document.getElementById("autoList");
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    (bucketsSummary || []).forEach((bucket) => {
      const bucketName = bucket.name || "Bucket";
      const entries = bucket.entries || [];
      // Collapsible per-bucket panel
      const wrap = document.createElement('details');
      wrap.className = 'info-panel';
      const summary = document.createElement('summary');
      summary.textContent = `${bucketName} (${entries.length})`;
      wrap.appendChild(summary);
      const container = document.createElement('div');
      container.className = 'info-content';
      entries.forEach((entry, idx)=>{
        const row = document.createElement("div"); row.className='levels-row';
        const label = document.createElement("div"); label.className='solutionText';
        const m = entry.metrics || {}; const scoreStr = (entry.score!=null)?` hv:${entry.score.toFixed(2)}`:"";
        const fastest = m.solutionLength ?? m.fastest ?? '-'; const sols = m.solutionsFilteredCount ?? m.solutions ?? '-';
        label.textContent = `#${idx+1} sols:${sols} fastest:${fastest}${scoreStr}`;
        const actions = document.createElement("div"); actions.className='solutionActions';
        const useBtn = document.createElement("button"); useBtn.textContent='Use';
        useBtn.addEventListener('click', ()=> { try { api.setState(entry.level); if (window.requestRedraw) window.requestRedraw(); } catch {} });
        actions.appendChild(useBtn);
        row.appendChild(label); row.appendChild(actions); container.appendChild(row);
      });
      wrap.appendChild(container);
      resultsEl.appendChild(wrap);
    });
  }

  return {
    getConfig: () => ({
      tilesPlace: Array.from(
        tilesChips?.querySelectorAll(".tile-chip.active") || []
      ).map((b) => b.dataset.tile),
      entitiesPlace: Array.from(
        entsChips?.querySelectorAll(".tile-chip.active") || []
      ).map((b) => b.dataset.entity),
      buckets: buckets.slice(),
    }),
  };
}

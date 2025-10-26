// ui/auto.js
import { cloneState, removeRow, removeColumn, findPlayer } from '../core/state.js';
import { EntityTypes, isSolid } from '../core/entities.js';
import { isTrait, getTileTraits } from '../core/tiles.js';
import { evaluateLevel, computeAllowedDeadSetFromGraph } from '../solver/evaluator.js';

export function setupAutoUI({ getState, setState, runSolver, onPlaySolution }) {
  const runBtn = document.getElementById('runAuto');
  const stopBtn = document.getElementById('stopAuto');
  const restoreBtn = document.getElementById('autoRestore');
  const progressEl = document.getElementById('autoProgress');
  const listEl = document.getElementById('autoList');
  const panelEl = document.getElementById('autoPanel');
  const toggleBtn = document.getElementById('toggleAuto');

  if (!runBtn || !stopBtn || !progressEl || !listEl || !panelEl || !toggleBtn) return;

  let cancel = false;

  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-pressed') === 'true';
    const next = !expanded;
    toggleBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
    toggleBtn.classList.toggle('active', next);
    toggleBtn.textContent = next ? 'Hide Auto Creator' : 'Show Auto Creator';
    panelEl.classList.toggle('hidden', !next);
    panelEl.setAttribute('aria-hidden', next ? 'false' : 'true');
  });

  function getSolverLimits() {
    const md = Number(document.getElementById('solverMaxDepth')?.value);
    const mn = Number(document.getElementById('solverMaxNodes')?.value);
    const ms = Number(document.getElementById('solverMaxSolutions')?.value);
    return {
      maxDepth: Number.isFinite(md) ? md : 100,
      maxNodes: Number.isFinite(mn) ? mn : 200000,
      maxSolutions: Number.isFinite(ms) ? Math.max(1, ms) : 50
    };
  }

  // Centralized presets loader
  function loadScoringPreset(key){
    function setVal(id, v){ const el = document.getElementById(id); if (el) el.value = v; }
    function setChk(id, v){ const el = document.getElementById(id); if (el) el.checked = !!v; }
    // Default baseline for all presets (bands off unless specified)
    const presets = {
      generic: {
        weights: { U:1.0, D:1.0, Fr:0.0, S:2.0, M:0.0, F:0.0, Y:0.0 },
        bands:   { U:{en:false,min:0.01,max:1}, S:{en:false,min:0.01,max:1} },
        params:  { U_Smax:16, S_Lmin:10, S_Lmax:100, F_kind:'sine', Y_sym:'horizontal' },
        gcons:   { minDead:0, LminSolv:0 }
      },
      elegant: {
        weights: { U:1.2, D:0.8, Fr:0.6, S:1.0, M:0.6, F:1.2, Y:0.6 },
        bands:   { U:{en:false,min:0.2,max:1}, S:{en:false,min:0.05,max:1} },
        params:  { U_Smax:16, S_Lmin:12, S_Lmax:60, F_kind:'sine', Y_sym:'horizontal' },
        gcons:   { minDead:4, LminSolv:0 }
      },
      showcase: {
        weights: { U:0.8, D:0.5, Fr:0.4, S:0.8, M:1.5, F:0.4, Y:0.0 },
        bands:   { U:{en:false,min:0.01,max:1}, S:{en:false,min:0.01,max:1} },
        params:  { U_Smax:32, S_Lmin:8, S_Lmax:80, F_kind:'sine', Y_sym:'horizontal' },
        gcons:   { minDead:4, LminSolv:0 }
      },
      exploration: {
        weights: { U:0.7, D:0.4, Fr:-0.2, S:1.4, M:0.8, F:0.4, Y:0.3 },
        bands:   { U:{en:false,min:0.01,max:1}, S:{en:false,min:0.01,max:1} },
        params:  { U_Smax:16, S_Lmin:20, S_Lmax:140, F_kind:'sine', Y_sym:'horizontal' },
        gcons:   { minDead:4, LminSolv:0 }
      },
      punishing: {
        weights: { U:1.2, D:1.4, Fr:1.2, S:0.9, M:0.3, F:0.6, Y:0.0 },
        bands:   { U:{en:false,min:0.01,max:1}, S:{en:false,min:0.01,max:1} },
        params:  { U_Smax:16, S_Lmin:10, S_Lmax:80, F_kind:'sine', Y_sym:'horizontal' },
        gcons:   { minDead:4, LminSolv:0 }
      }
    };
    const p = presets[key] || presets.generic;
    // Weights
    setVal('scW_U', String(p.weights.U)); setVal('scW_D', String(p.weights.D)); setVal('scW_Fr', String(p.weights.Fr)); setVal('scW_S', String(p.weights.S)); setVal('scW_M', String(p.weights.M)); setVal('scW_F', String(p.weights.F)); setVal('scW_Y', String(p.weights.Y));
    // Bands (only U/S exposed, others remain off by default)
    setChk('scB_U_en', !!p.bands.U.en); setVal('scB_U_min', String(p.bands.U.min)); setVal('scB_U_max', String(p.bands.U.max));
    setChk('scB_S_en', !!p.bands.S.en); setVal('scB_S_min', String(p.bands.S.min)); setVal('scB_S_max', String(p.bands.S.max));
    setChk('scB_D_en', false); setChk('scB_Fr_en', false); setChk('scB_M_en', false); setChk('scB_F_en', false); setChk('scB_Y_en', false);
    // Params
    setVal('scP_U_Smax', String(p.params.U_Smax)); setVal('scP_S_Lmin', String(p.params.S_Lmin)); setVal('scP_S_Lmax', String(p.params.S_Lmax));
    const kind = document.getElementById('scP_F_kind'); if (kind) kind.value = p.params.F_kind;
    const sym  = document.getElementById('scP_Y_sym'); if (sym) sym.value = p.params.Y_sym;
    // Global constraints
    setVal('scG_minDedLen', String(p.gcons.minDead)); setVal('scG_LminSolv', String(p.gcons.LminSolv));
  }

  // Hook up Preset UI
  const scPresetSelect = document.getElementById('scPresetSelect');
  const scLoadPresetBtn = document.getElementById('scLoadPreset');
  if (scLoadPresetBtn) scLoadPresetBtn.addEventListener('click', () => {
    const key = scPresetSelect?.value || 'generic';
    if (key === 'custom') {
      try {
        const raw = localStorage.getItem('scoringPreset_custom');
        if (raw) {
          const cfg = JSON.parse(raw);
          // Apply custom by writing fields to UI controls
          // Weights
          const w = cfg.weights || {};
          const setV = (id, v)=>{ const el=document.getElementById(id); if (el && v!==undefined) el.value=String(v); };
          setV('scW_U', w.U); setV('scW_D', w.D); setV('scW_Fr', w.Fr); setV('scW_S', w.S); setV('scW_M', w.M); setV('scW_F', w.F); setV('scW_Y', w.Y);
          // Bands
          const b = cfg.bands || {};
          const setC = (id, v)=>{ const el=document.getElementById(id); if (el && v!==undefined) el.checked=!!v; };
          const setNum = (id, v)=>{ const el=document.getElementById(id); if (el && v!==undefined) el.value=String(v); };
          setC('scB_U_en', b.U?.enabled); setNum('scB_U_min', b.U?.min); setNum('scB_U_max', b.U?.max);
          setC('scB_S_en', b.S?.enabled); setNum('scB_S_min', b.S?.min); setNum('scB_S_max', b.S?.max);
          // Params
          const p = cfg.params || {};
          setNum('scP_U_Smax', p.U?.S_max);
          setNum('scP_S_Lmin', p.S?.L_min); setNum('scP_S_Lmax', p.S?.L_max);
          const kind = document.getElementById('scP_F_kind'); if (kind && p.F?.ideal_kind) kind.value = p.F.ideal_kind;
          const sym  = document.getElementById('scP_Y_sym'); if (sym && p.Y?.sym_mode) sym.value = p.Y.sym_mode;
          // Global
          const g = cfg.globalConstraints || {};
          setNum('scG_minDedLen', g.min_dead_end_depth_len); setNum('scG_LminSolv', g.L_min_solvable);
        }
      } catch {}
    } else {
      loadScoringPreset(key);
    }
  });
  const scResetBtn = document.getElementById('scResetDefaults');
  if (scResetBtn) scResetBtn.addEventListener('click', () => loadScoringPreset('generic'));
  // Initialize once
  loadScoringPreset('generic');

  document.querySelectorAll('.tile-toggle[data-target]').forEach(btn => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      btn.setAttribute('aria-expanded', next ? 'true' : 'false');
      btn.classList.toggle('active', next);
      target.classList.toggle('hidden', !next);
      target.setAttribute('aria-hidden', next ? 'false' : 'true');
    });
  });

  // Tile-chip toggles and select/deselect all within Auto Creator panels
  document.querySelectorAll('.auto-card .tile-filter-panel').forEach(panel => {
    panel.addEventListener('click', (event) => {
      const selAll = event.target.closest('.select-all');
      if (selAll) {
        panel.querySelectorAll('.tile-chip[data-value], .tile-chip[data-option]').forEach(chip => {
          chip.classList.add('active');
          chip.setAttribute('aria-pressed', 'true');
        });
        event.preventDefault();
        return;
      }
      const deselAll = event.target.closest('.deselect-all');
      if (deselAll) {
        panel.querySelectorAll('.tile-chip[data-value], .tile-chip[data-option]').forEach(chip => {
          chip.classList.remove('active');
          chip.setAttribute('aria-pressed', 'false');
        });
        event.preventDefault();
        return;
      }
      const chip = event.target.closest('.tile-chip');
      if (!chip) return;
      const isActive = chip.classList.toggle('active');
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  });

  stopBtn.addEventListener('click', () => {
    cancel = true;
    progressEl.textContent = 'Cancel requested...';
    stopBtn.disabled = true;
  });

  let originalBase = null;

  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      if (!originalBase) return;
      setState(cloneState(originalBase));
      progressEl.textContent = 'Restored original base.';
    });
  }

  runBtn.addEventListener('click', async () => {
    if (panelEl.classList.contains('hidden')) {
      toggleBtn.click();
    }
    cancel = false;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    if (restoreBtn) restoreBtn.disabled = false;
    listEl.innerHTML = '';

    const params = readParams();
    // capture the base level used to generate from
    originalBase = cloneState(getState());
    const best = [];
    const seen = new Set();
    let invalidSkipped = 0;
    let duplicateStreak = 0;
    const maxDuplicateStreak = Math.max(100, params.attempts * 2);
    let attemptsDone = 0; // counts only unique + valid tile mutation
    let tries = 0;        // total generation tries (including skipped)
    const hardCap = Math.max(1000, params.attempts * 50);

  while (attemptsDone < params.attempts && !cancel) {
      tries++;
      if (tries > hardCap) {
        progressEl.textContent = 'Search limit reached (too many invalid/duplicate tries)';
        break;
      }
      progressEl.textContent = 'Attempt ' + (attemptsDone + 1) + '/' + params.attempts + ' - skipped:' + invalidSkipped;
      await tick();

      // Choose base: original or sampled from population per genetic ratio
      const useGA = (params.genUseRatio > 0) && Math.random() < Math.min(1, Math.max(0, params.genUseRatio)) && best.length > 0;
      let candidate = cloneState(useGA ? sampleParent(best, params.genSkew) : originalBase);
      if (useGA && Math.random() < (Math.max(0, Math.min(100, params.genCrossoverPct)) / 100) && best.length > 1) {
        const b2 = cloneState(sampleParent(best, params.genSkew));
        candidate = crossoverLevels(candidate, b2);
      }

      ensurePlayer(candidate);

      let okTiles = false, okEnts = false;
      if (params.placeOptimally){
        const tileChanges = useGA && params.genPopMaxChanges ? params.genPopMaxChanges : params.maxTilesChanged;
        okTiles = await mutateTilesOptimally(candidate, tileChanges, params.tilesChange, params.tilesPlace, runSolver, getSolverLimits());
        if (params.movePlayer) okEnts = await mutateEntitiesOptimally(candidate, { movePlayer: true }, runSolver, getSolverLimits());
        if (params.placeBoxes) okEnts = (await mutateEntitiesOptimally(candidate, { placeBoxes: true, placeTypes: params.placeBoxTypes }, runSolver, getSolverLimits())) || okEnts;
      } else {
        const tileChanges = useGA && params.genPopMaxChanges ? params.genPopMaxChanges : params.maxTilesChanged;
        okTiles = mutateTiles(candidate, tileChanges, params.tilesChange, params.tilesPlace);
        okEnts  = mutateEntities(candidate, {
          movePlayer: !!params.movePlayer,
          placeBoxes: !!params.placeBoxes,
          removeBoxes: !!params.removeBoxes,
          placeTypes: params.placeBoxTypes,
          removeTypes: params.removeBoxTypes,
        });
      }
      if (!(okTiles || okEnts)) continue; // neither tiles nor entities changed -> does not count as attempt

      // Deduplicate candidates by a stable key
      const key = stateKey(candidate);
      if (seen.has(key)) {
        duplicateStreak++;
        if (duplicateStreak >= maxDuplicateStreak) {
          progressEl.textContent = 'Exhausted unique candidates (no new uniques found)';
          break;
        }
        continue; // duplicate -> does not count as attempt
      }
      seen.add(key);
      duplicateStreak = 0;
      // Validate initial positions after mutations; do not relocate (skip invalid)
      if (!isValidInitialPositions(candidate)) { invalidSkipped++; continue; }
      attemptsDone++; // count only when we have a unique, valid candidate

      const result = await runSolver(candidate, {
        maxDepth: params.maxDepth,
        maxNodes: params.maxNodes,
        maxSolutions: Math.max(params.maxSolutions, 1),
        onProgress: () => {}
      });

      const solutions = Array.isArray(result?.solutions) ? result.solutions : [];
      if (solutions.length < 1) continue;
      // Filter dead ends by depth threshold (in steps) across the graph
      const cfg = readScoringConfig();
      const minSteps = Math.max(0, (cfg.globalConstraints?.min_dead_end_depth_len||0));
      const moveIdx = buildMoveIndex(result?.graph?.edges);
      const allowed = computeAllowedDeadSetFromGraph(result?.graph||{}, minSteps);
      const deadEndsRaw = Array.isArray(result?.deadEnds) ? result.deadEnds : [];
      const filteredDeadEnds = deadEndsRaw.filter(de => {
        try {
          let cur = result?.graph?.startHash;
          if(!cur) return false;
          for(const ch of (de.moves||'')){ const m = moveIdx.get(cur); if(!m||!m.has(ch)) return false; cur = m.get(ch); }
          return allowed.has(cur);
        } catch { return false; }
      });

      // Scoring
      const evalRes = evaluateLevel({
        initialState: candidate,
        solverResult: result,
        solverGraph: {
          startHash: result?.graph?.startHash,
          processed: result?.graph?.processed,
          edges: result?.graph?.edges,
          adj: result?.graph?.adj,
          rev: result?.graph?.rev,
          depthByHash: result?.graph?.depthByHash,
          goalHashes: result?.graph?.goalHashes,
          moveIndex: buildMoveIndex(result?.graph?.edges)
        },
        weights: cfg.weights || {},
        bands: cfg.bands || {},
        params: cfg.params || {},
        gcons: cfg.globalConstraints || { min_dead_end_depth_len: 0 },
        mapSigned: cfg.mapSigned !== false
      });
      if (evalRes.discarded) continue;

      // Note: Do not simplify candidates automatically here; user can run Simplify from Build Tools

      const fastest = Math.min(...solutions.map(s => s.length));
      const deadEnds = filteredDeadEnds;
      const score01 = evalRes.score ?? 0;
      best.push({ state: cloneState(candidate), solutions, deadEnds, fastest, score01 });
      best.sort((a, b) => b.score01 - a.score01);
      if (best.length > 20) best.length = 20;
      renderList(best, listEl, onPlaySolution, setState);
    }

    const doneMsg = cancel
      ? `Canceled · candidates:${best.length} · skipped:${invalidSkipped}`
      : (duplicateStreak >= maxDuplicateStreak
          ? `Done. candidates: ${best.length} · skipped:${invalidSkipped} (unique space exhausted)`
          : `Done. candidates: ${best.length} · skipped:${invalidSkipped}`);
    progressEl.textContent = doneMsg;
    runBtn.disabled = false;
    stopBtn.disabled = true;
  });

  // Scoring Presets: Save current into 'custom'
  // Use existing scPresetSelect; only declare Save button here
  const scSavePresetBtn = document.getElementById('scSavePreset');
  if (scSavePresetBtn) scSavePresetBtn.addEventListener('click', () => {
    const cfg = readScoringConfig();
    try {
      localStorage.setItem('scoringPreset_custom', JSON.stringify(cfg));
      if (scPresetSelect) scPresetSelect.value = 'custom';
    } catch {}
  });
}

function readParams() {
  const getNum = (id, def, min) => {
    const el = document.getElementById(id);
    const v = Number(el?.value);
    if (!Number.isFinite(v)) return def;
    return Math.max(min ?? -Infinity, v);
  };
  const getSelectedValues = (panelId) => {
    const panel = document.getElementById(panelId);
    if (!panel) return null;
    const selected = Array.from(panel.querySelectorAll('.tile-chip.active[data-value]'))
      .map(btn => btn.dataset.value);
    return selected.length ? selected : null;
  };
  const isOptionSelected = (panelId, optionName) => {
    const panel = document.getElementById(panelId);
    if (!panel) return false;
    return !!panel.querySelector(`.tile-chip.active[data-option="${optionName}"]`);
  };
  const getToggle = (id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    return el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true';
  };

  return {
    maxTilesChanged: getNum('autoMaxChanges', 3, 1),
    attempts: getNum('autoAttempts', 50, 1),
    tilesChange: getSelectedValues('autoTilesChange'),
    tilesPlace: getSelectedValues('autoTilesPlace'),
    maxDepth: getNum('solverMaxDepth', 100, 1),
    maxNodes: getNum('solverMaxNodes', 200000, 100),
    maxSolutions: getNum('solverMaxSolutions', 50, 1)
    , movePlayer: getToggle('autoMovePlayer')
    , placeBoxes: (
        isOptionSelected('autoTilesPlace', 'placeBox') ||
        isOptionSelected('autoTilesPlace', 'placeHeavyBox') ||
        isOptionSelected('autoTilesPlace', 'placeTriBox')
      )
    , removeBoxes: (
        isOptionSelected('autoTilesChange', 'removeBox') ||
        isOptionSelected('autoTilesChange', 'removeHeavyBox') ||
        isOptionSelected('autoTilesChange', 'removeTriBox')
      )
    , placeBoxTypes: {
        box: isOptionSelected('autoTilesPlace', 'placeBox'),
        heavyBox: isOptionSelected('autoTilesPlace', 'placeHeavyBox'),
        triBox: isOptionSelected('autoTilesPlace', 'placeTriBox')
      }
    , removeBoxTypes: {
        box: isOptionSelected('autoTilesChange', 'removeBox'),
        heavyBox: isOptionSelected('autoTilesChange', 'removeHeavyBox'),
        triBox: isOptionSelected('autoTilesChange', 'removeTriBox')
      }
    , placeOptimally: getToggle('autoPlaceOptimally')
    , genUseRatio: (()=>{ const el=document.getElementById('genUseRatio'); const v=Number(el?.value); return Number.isFinite(v)? Math.max(0,Math.min(1,v)) : 0; })()
    , genSkew: (()=>{ const el=document.getElementById('genSkew'); const v=Number(el?.value); return Number.isFinite(v)? Math.max(0,Math.min(1,v)) : 0.5; })()
    , genCrossoverPct: (()=>{ const el=document.getElementById('genCrossoverPct'); const v=Number(el?.value); return Number.isFinite(v)? Math.max(0,Math.min(100,v)) : 10; })()
    , genPopMaxChanges: (()=>{ const el=document.getElementById('genPopMaxChanges'); const v=Number(el?.value); return Number.isFinite(v)? Math.max(1,Math.floor(v)) : null; })()
  };
}

function renderList(list, listEl, onPlaySolution, setState) {
  listEl.innerHTML = '';
  list.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'solutionItem';

    const text = document.createElement('div');
    text.className = 'solutionText';
    text.innerHTML = `#${idx + 1} score:${(c.score01||0).toFixed(3)} sols:${c.solutions.length} dead:${c.deadEnds.length} fastest:${c.fastest}`;
    row.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'solutionActions';

    const play = document.createElement('button');
    play.textContent = 'Play';
    play.addEventListener('click', () => {
      if (!onPlaySolution) return;
      const moves = (c.solutions[0] || {}).moves || '';
      onPlaySolution({ state: cloneState(c.state), moves });
    });
    actions.appendChild(play);

    const useBtn = document.createElement('button');
    useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => { setState(cloneState(c.state)); });
    actions.appendChild(useBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

function ensurePlayer(state) {
  const hasPlayer = state.entities.some(e => e.type === EntityTypes.player);
  if (hasPlayer) return;
  const canStand = (x, y) => {
    const t = (state.base[y][x] || 'floor');
    if (isTrait(t, 'isWallForPlayer') || isTrait(t, 'isHoleForPlayer')) return false;
    if ((state.base[y][x] || 'floor') === 'exit') return false; // avoid trivial start on exit
    const anyHere = state.entities?.some(e => e.x === x && e.y === y);
    return !anyHere;
  };
  const options = [];
  for (let y = 0; y < state.size.rows; y++) {
    for (let x = 0; x < state.size.cols; x++) {
      if (canStand(x, y)) options.push({ x, y });
    }
  }
  if (!options.length) return;
  const spot = options[Math.floor(Math.random() * options.length)];
  state.entities = state.entities.filter(e => e.type !== EntityTypes.player);
  state.entities.push({ type: EntityTypes.player, x: spot.x, y: spot.y, state: { mode: 'free', entryDir: { dx: 0, dy: 0 } } });
}

const ALL_TILES = ['floor','wall','hole','exit','pressurePlate','grile','spikes','holeSpikes','slimPathFloor','slimPathHole','fragileWall'];

function mutateTiles(state, maxChanges, sourceAllowed, targetAllowed) {
  const sourceSet = new Set(sourceAllowed && sourceAllowed.length ? sourceAllowed : ALL_TILES);
  const targets = targetAllowed && targetAllowed.length ? targetAllowed : ALL_TILES;

  // Without reachable/boundary restriction: consider all cells whose current type is allowed to change
  const eligible = [];
  for (let y = 0; y < state.size.rows; y++) {
    for (let x = 0; x < state.size.cols; x++) {
      const cur = state.base[y][x] || 'floor';
      if (!sourceSet.has(cur)) continue;
      eligible.push({ x, y, cur });
    }
  }
  if (!eligible.length) return false;

  let changes = 0;
  const tried = new Set();
  const maxTries = Math.min(eligible.length * 2, Math.max(eligible.length, maxChanges * 12));

  function tryIndex(idx) {
    if (idx < 0 || idx >= eligible.length) return false;
    const key = idx;
    if (tried.has(key)) return false;
    tried.add(key);
    const { x, y, cur } = eligible[idx];
    // If there is a box/heavyBox at this cell, only choose tiles that support boxes
    const boxAt = state.entities?.some(e => (e.type === EntityTypes.box || e.type === EntityTypes.heavyBox) && e.x === x && e.y === y);
    const candidateTargets = targets.filter(t => t !== cur && (!boxAt || allowsBoxTile(t)));
    if (!candidateTargets.length) return false;
    let pick = candidateTargets[Math.floor(Math.random() * candidateTargets.length)];
    if (!pick) return false; // safety

    // Special case: selecting fragileWall means place an ENTITY overlay, not a base tile
    if (pick === 'fragileWall') {
      if (cur === 'wall') return false; // don't place on walls
      const solidHere = state.entities?.some(e => isSolid(e) && e.x === x && e.y === y);
      if (solidHere) return false;
      state.entities.push({ type: EntityTypes.fragileWall, x, y, underTile: cur });
      return true;
    }

    state.base[y][x] = pick;
    return true;
  }

  for (let t = 0; t < maxTries && changes < maxChanges; t++) {
    const idx = Math.floor(Math.random() * eligible.length);
    if (tryIndex(idx)) changes++;
  }

  return changes > 0;
}

// Greedy step-by-step placement for one chosen target tile type per step
async function mutateTilesOptimally(state, maxChanges, sourceAllowed, targetAllowed, runSolver, limits){
  const sourceSet = new Set(sourceAllowed && sourceAllowed.length ? sourceAllowed : ALL_TILES);
  const targets = targetAllowed && targetAllowed.length ? targetAllowed.slice() : ALL_TILES.slice();
  if (!targets.length) return false;
  let changed = false;
  const cfg = readScoringConfig();
  // Baseline score
  async function scoreOf(s){
    const res = await runSolver(s, { ...(limits||{}), onProgress: () => {} });
    if (!res || !Array.isArray(res.solutions)) return { ok:false, score:-Infinity };
    const evalRes = evaluateLevel({
      initialState: s,
      solverResult: res,
      solverGraph: { startHash: res?.graph?.startHash, processed: res?.graph?.processed, edges: res?.graph?.edges, adj: res?.graph?.adj, rev: res?.graph?.rev, depthByHash: res?.graph?.depthByHash, goalHashes: res?.graph?.goalHashes, moveIndex: buildMoveIndex(res?.graph?.edges) },
      weights: cfg.weights || {}, bands: cfg.bands || {}, params: cfg.params || {}, gcons: cfg.globalConstraints || { min_dead_end_depth_len: 0 }, mapSigned: cfg.mapSigned !== false
    });
    if (evalRes.discarded) return { ok:false, score:-Infinity };
    const L = Array.isArray(res.solutions) && res.solutions.length ? Math.min(...res.solutions.map(x=>x.length)) : 0;
    return { ok:true, score: (evalRes.score ?? 0), L };
  }
  const baseScoreObj = await scoreOf(state);
  let baseScore = baseScoreObj.ok ? baseScoreObj.score : -Infinity;

  for (let step=0; step<maxChanges; step++){
    // Pick a target type for this step
    let bestDelta = 0, bestPos = null, bestIsEntity = false, bestType = null, bestL = -1;
    for (const pick of targets){
      for (let y=0; y<state.size.rows; y++){
        for (let x=0; x<state.size.cols; x++){
          const cur = state.base[y][x] || 'floor';
          if (!sourceSet.has(cur)) continue;
          // Box/fragile entity overlay rule
          const boxAt = state.entities?.some(e => (e.type===EntityTypes.box || e.type===EntityTypes.heavyBox) && e.x===x && e.y===y);
          if (boxAt && (isTrait(pick,'isWallForBox') || isTrait(pick,'isHoleForBox'))) continue;
          // Simulate change
          const test = cloneState(state);
          if (pick === 'fragileWall'){
            const solidHere = test.entities?.some(e => isSolid(e) && e.x===x && e.y===y);
            if (solidHere) continue;
            test.entities.push({ type: EntityTypes.fragileWall, x, y, underTile: cur });
          } else {
            if (cur === pick) continue;
            test.base[y][x] = pick;
          }
          if (!isValidInitialPositions(test)) continue; // do not relocate for this test
          const sObj = await scoreOf(test);
          if (!sObj.ok) continue;
          const delta = sObj.score - baseScore;
          if (delta > bestDelta || (Math.abs(delta - bestDelta) <= 1e-9 && sObj.L > bestL)){
            bestDelta = delta; bestPos = {x,y}; bestIsEntity = (pick==='fragileWall'); bestType = pick; bestL = sObj.L;
          }
        }
      }
    }
    // Also optionally consider entity operations (move player / place box) when toggles are on via mutateEntitiesOptimally, handled separately by caller
    if (bestPos && bestDelta > 0){
      // apply best change
      const {x,y} = bestPos;
      if (bestIsEntity){
        state.entities.push({ type: EntityTypes.fragileWall, x, y, underTile: state.base[y][x]||'floor' });
      } else {
        state.base[y][x] = bestType;
      }
      changed = true;
      // update base score
      const sObj2 = await scoreOf(state);
      if (sObj2.ok) baseScore = sObj2.score;
    } else {
      break; // no improvement for this step
    }
  }
  return changed;
}

async function mutateEntitiesOptimally(state, opts, runSolver, limits){
  let changed = false;
  const cfg = readScoringConfig();
  async function scoreOf(s){
    const res = await runSolver(s, { ...(limits||{}), onProgress: () => {} });
    if (!res || !Array.isArray(res.solutions)) return { ok:false, score:-Infinity };
    const evalRes = evaluateLevel({ initialState: s, solverResult: res, solverGraph: { startHash: res?.graph?.startHash, processed: res?.graph?.processed, edges: res?.graph?.edges, adj: res?.graph?.adj, rev: res?.graph?.rev, depthByHash: res?.graph?.depthByHash, goalHashes: res?.graph?.goalHashes, moveIndex: buildMoveIndex(res?.graph?.edges) }, weights: cfg.weights||{}, bands: cfg.bands||{}, params: cfg.params||{}, gcons: cfg.globalConstraints||{min_dead_end_depth_len:0}, mapSigned: cfg.mapSigned !== false });
    if (evalRes.discarded) return { ok:false, score:-Infinity };
    const L = Array.isArray(res.solutions) && res.solutions.length ? Math.min(...res.solutions.map(x=>x.length)) : 0;
    return { ok:true, score: (evalRes.score ?? 0), L };
  }
  const baseScoreObj = await scoreOf(state);
  let baseScore = baseScoreObj.ok ? baseScoreObj.score : -Infinity;
  // Move player
  if (opts.movePlayer){
    const idx = state.entities.findIndex(e => e.type===EntityTypes.player);
    if (idx >= 0){
      const p = state.entities[idx];
      let best = null, bestDelta = 0, bestL = -1;
      for (let y=0;y<state.size.rows;y++) for (let x=0;x<state.size.cols;x++){
        const t = state.base[y][x]||'floor';
        if (isTrait(t,'isWallForPlayer')||isTrait(t,'isHoleForPlayer')) continue;
        if (t==='exit') continue; // avoid trivial move onto exit
        const anyHere = state.entities.some(e=> e!==p && e.x===x && e.y===y);
        if (anyHere) continue;
        const test = cloneState(state);
        const pp = test.entities.find(e=>e.type===EntityTypes.player);
        pp.x = x; pp.y = y; pp.state = { mode:'free', entryDir:{dx:0,dy:0} };
        if (!isValidInitialPositions(test)) if (!attemptRelocateInvalid(test,1)) continue;
        const sObj = await scoreOf(test); if (!sObj.ok) continue;
        const d = sObj.score - baseScore; if (d>bestDelta || (Math.abs(d-bestDelta)<=1e-9 && sObj.L>bestL)){ bestDelta=d; best={x,y}; bestL=sObj.L; }
      }
      if (best && bestDelta>0){ p.x=best.x; p.y=best.y; p.state={mode:'free',entryDir:{dx:0,dy:0}}; changed=true; const sObj2=await scoreOf(state); if (sObj2.ok) baseScore=sObj2.score; }
    }
  }
  // Place a box/heavyBox/triBox
  if (opts.placeBoxes){
    let best = null, bestDelta = 0, bestType = EntityTypes.box, bestL = -1;
    for (let y=0;y<state.size.rows;y++) for (let x=0;x<state.size.cols;x++){
      const t = state.base[y][x]||'floor';
      if (!allowsBoxTile(t)) continue;
      const anyBlock = state.entities.some(e=> (e.x===x && e.y===y));
      if (anyBlock) continue;
      {
      const allow = opts.placeTypes || { box:true, heavyBox:true, triBox:true };
      const types = [];
      if (allow.box) types.push(EntityTypes.box);
      if (allow.heavyBox) types.push(EntityTypes.heavyBox);
      if (allow.triBox) types.push(EntityTypes.triBox);
      for (const type of types){
        if (type === EntityTypes.triBox) {
          const orients = ['NE','SE','SW','NW'];
          for (const o of orients) {
            const test = cloneState(state);
            test.entities.push({ type, x, y, state: { orient: o } });
            if (!isValidInitialPositions(test)) if (!attemptRelocateInvalid(test,1)) continue;
            const sObj = await scoreOf(test); if (!sObj.ok) continue;
            const d = sObj.score - baseScore; if (d>bestDelta || (Math.abs(d-bestDelta)<=1e-9 && sObj.L>bestL)){ bestDelta=d; best={x,y}; bestType={ t:type, o }; bestL=sObj.L; }
          }
        } else {
          const test = cloneState(state);
          test.entities.push({ type, x, y });
          if (!isValidInitialPositions(test)) if (!attemptRelocateInvalid(test,1)) continue;
          const sObj = await scoreOf(test); if (!sObj.ok) continue;
          const d = sObj.score - baseScore; if (d>bestDelta || (Math.abs(d-bestDelta)<=1e-9 && sObj.L>bestL)){ bestDelta=d; best={x,y}; bestType=type; bestL=sObj.L; }
        }
      }
      }
    }
    if (best && bestDelta>0){
      if (typeof bestType === 'object' && bestType.t === EntityTypes.triBox) {
        state.entities.push({ type: bestType.t, x: best.x, y: best.y, state:{ orient: bestType.o } });
      } else {
        state.entities.push({ type: bestType, x: best.x, y: best.y });
      }
      changed=true;
    }
  }
  return changed;
}

function computePlayerReachable(state){
  const rows = state.size.rows, cols = state.size.cols;
  const grid = Array.from({length:rows}, ()=> Array(cols).fill(false));
  const p = findPlayer(state);
  if (!p) return grid;
  const q = [];
  function pass(x,y){
    const t = state.base[y][x] || 'floor';
    // Consider holes inside; only walls-for-player block reach
    return !isTrait(t,'isWallForPlayer');
  }
  if (pass(p.x,p.y)) { grid[p.y][p.x] = true; q.push({x:p.x,y:p.y}); }
  const n4 = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length){
    const {x,y} = q.shift();
    for (const [dx,dy] of n4){
      const nx=x+dx, ny=y+dy;
      if (ny<0||ny>=rows||nx<0||nx>=cols) continue;
      if (grid[ny][nx]) continue;
      if (!pass(nx,ny)) continue;
      grid[ny][nx] = true;
      q.push({x:nx,y:ny});
    }
  }
  return grid;
}

// Rank-weighted parent sampling
function sampleParent(best, skew){
  const n = Math.min(best.length, 20);
  if (n <= 1 || skew >= 0.999) return cloneState(best[0].state);
  if (skew <= 0){ const idx = Math.floor(Math.random()*n); return cloneState(best[idx].state); }
  const targetRatio = 1 / Math.max(1e-6, (1 - skew));
  const tau = (n - 1) / Math.log(targetRatio);
  const weights = Array.from({length:n}, (_,i)=> Math.exp(-(i)/tau));
  const sum = weights.reduce((a,b)=>a+b,0);
  let r = Math.random()*sum;
  for (let i=0;i<n;i++){ r -= weights[i]; if (r<=0) return cloneState(best[i].state); }
  return cloneState(best[n-1].state);
}

function crossoverLevels(a, b){
  const A = cloneState(a), B = cloneState(b);
  if (A.size.rows!==B.size.rows || A.size.cols!==B.size.cols) return A; // fallback
  const rows=A.size.rows, cols=A.size.cols;
  const out = cloneState(A);
  const vertical = Math.random()<0.5;
  if (vertical){
    const cut = Math.floor(cols/2);
    for (let y=0;y<rows;y++) for (let x=cut;x<cols;x++) out.base[y][x]=B.base[y][x];
  } else {
    const cut = Math.floor(rows/2);
    for (let y=cut;y<rows;y++) for (let x=0;x<cols;x++) out.base[y][x]=B.base[y][x];
  }
  // Entities: player from A, boxes merge (avoid conflicts), fragileWalls prefer B on its half
  const merged = [];
  const isLeftHalf = (x)=> vertical ? (x<Math.floor(cols/2)) : true;
  const isTopHalf  = (y)=> !vertical ? (y<Math.floor(rows/2)) : true;
  const keepFromA = new Set();
  // Player from A
  const plA = A.entities.find(e=>e.type===EntityTypes.player);
  if (plA) merged.push({ ...plA, state: { mode:'free', entryDir:{dx:0,dy:0} } });
  const occ = (x,y,list)=> list.some(e=> e.x===x && e.y===y);
  function pushIfFree(e){ if (!occ(e.x,e.y,merged)) merged.push({ ...e }); }
  for (const e of A.entities){ if (e.type!==EntityTypes.player) pushIfFree(e); }
  for (const e of B.entities){ if (e.type!==EntityTypes.player) pushIfFree(e); }
  out.entities = merged;
  return out;
}

// Randomly move player and place/move boxes/heavyBoxes (one lightweight op per attempt)
function mutateEntities(state, opts = {}) {
  let changed = false;

  // Helpers
  const tileAt = (x, y) => (state.base[y][x] || 'floor');
  const solidAt = (x, y) => state.entities?.some(e => isSolid(e) && e.x === x && e.y === y);

  // 1) Maybe move player
  const playerIdx = state.entities.findIndex(e => e.type === EntityTypes.player);
  if (opts.movePlayer && playerIdx >= 0 && Math.random() < 0.5) {
    const p = state.entities[playerIdx];
    const options = [];
    for (let y = 0; y < state.size.rows; y++) {
      for (let x = 0; x < state.size.cols; x++) {
        const t = tileAt(x, y);
        if (isTrait(t, 'isWallForPlayer')) continue;
        if (isTrait(t, 'isHoleForPlayer')) continue;
        if (solidAt(x, y) && !(x === p.x && y === p.y)) continue;
        options.push({ x, y });
      }
    }
    if (options.length) {
      const spot = options[Math.floor(Math.random() * options.length)];
      if (spot.x !== p.x || spot.y !== p.y) {
        p.x = spot.x; p.y = spot.y;
        p.state = { mode: 'free', entryDir: { dx: 0, dy: 0 } };
        changed = true;
      }
    }
  }

  // 2) Box operation: add or remove one box/heavyBox/triBox
  if (opts.placeBoxes || opts.removeBoxes) {
    // decide which op to do this attempt
    const ops = [];
    if (opts.placeBoxes) ops.push('add');
    if (opts.removeBoxes) ops.push('remove');
    const pickOp = ops.length ? ops[Math.floor(Math.random() * ops.length)] : null;
    const boxCells = [];
    for (let y = 0; y < state.size.rows; y++) {
      for (let x = 0; x < state.size.cols; x++) {
        const t = tileAt(x, y);
        if (!allowsBoxTile(t)) continue;
        if (solidAt(x, y)) continue;
        boxCells.push({ x, y });
      }
    }

    if (pickOp === 'add') {
      if (boxCells.length) {
        const { x, y } = boxCells[Math.floor(Math.random() * boxCells.length)];
        const allow = opts.placeTypes || { box:true, heavyBox:true, triBox:true };
        const types = [];
        if (allow.box) types.push(EntityTypes.box);
        if (allow.heavyBox) types.push(EntityTypes.heavyBox);
        if (allow.triBox) types.push(EntityTypes.triBox);
        const pickT = types.length ? types[Math.floor(Math.random()*types.length)] : EntityTypes.box;
        if (pickT === EntityTypes.triBox) {
          const orients = ['NE','SE','SW','NW'];
          const o = orients[Math.floor(Math.random()*orients.length)];
          state.entities.push({ type: pickT, x, y, state: { orient: o } });
        } else {
          state.entities.push({ type: pickT, x, y });
        }
        changed = true;
      }
    } else if (pickOp === 'remove') {
      const allow = opts.removeTypes || { box:true, heavyBox:true, triBox:true };
      const indices = state.entities
        .map((e, i) => ({ e, i }))
        .filter(it => (it.e.type === EntityTypes.box && allow.box) || (it.e.type === EntityTypes.heavyBox && allow.heavyBox) || (it.e.type === EntityTypes.triBox && allow.triBox))
        .map(it => it.i);
      if (indices.length) {
        const idx = indices[Math.floor(Math.random() * indices.length)];
        state.entities.splice(idx, 1);
        changed = true;
      }
    }
  }

  return changed;
}

function attemptRelocateInvalid(state, maxAttempts = 3){
  for (let attempt = 0; attempt < maxAttempts; attempt++){
    if (isValidInitialPositions(state)) return true;
    // Build fresh occupancy for conflict checks
    const occ = new Map();
    for (const e of (state.entities||[])){
      const k = e.x+","+e.y;
      if (!occ.has(k)) occ.set(k, []);
      occ.get(k).push(e);
    }
    // Move invalid entities to a random valid cell if available
    let movedAny = false;
    for (const e of state.entities){
      const t = state.base[e.y][e.x] || 'floor';
      const isP = e.type===EntityTypes.player;
      const isB = (e.type===EntityTypes.box || e.type===EntityTypes.heavyBox);
      const here = occ.get(e.x+","+e.y) || [];
      const conflict = (isP && (here.some(x=>x!==e && (x.type===EntityTypes.fragileWall || x.type===EntityTypes.box || x.type===EntityTypes.heavyBox))))
                    || (isB && (here.some(x=>x!==e && (x.type===EntityTypes.fragileWall || x.type===EntityTypes.player || x.type===EntityTypes.box || x.type===EntityTypes.heavyBox))));
      const tileBad = (isP && (isTrait(t,'isWallForPlayer') || isTrait(t,'isHoleForPlayer')))
                   || (isB && (!allowsBoxTile(t)));
      if (!(conflict || tileBad)) continue;
      // Find candidate cells
      const cells = [];
      for (let y=0;y<state.size.rows;y++){
        for (let x=0;x<state.size.cols;x++){
          const tt = state.base[y][x] || 'floor';
          if (isP) {
            if (isTrait(tt,'isWallForPlayer') || isTrait(tt,'isHoleForPlayer')) continue;
            const anyHere = state.entities.some(ent => ent!==e && ent.x===x && ent.y===y);
            if (anyHere) continue;
          } else if (isB) {
            if (!allowsBoxTile(tt)) continue;
            const anyBlock = state.entities.some(ent => ent!==e && ent.x===x && ent.y===y && (ent.type===EntityTypes.fragileWall || ent.type===EntityTypes.player || ent.type===EntityTypes.box || ent.type===EntityTypes.heavyBox));
            if (anyBlock) continue;
          }
          cells.push({x,y});
        }
      }
      if (cells.length === 0) return false;
      const spot = cells[Math.floor(Math.random()*cells.length)];
      e.x = spot.x; e.y = spot.y;
      movedAny = true;
    }
    if (!movedAny) break;
  }
  return isValidInitialPositions(state);
}

function isValidInitialPositions(state){
  const tileAt = (x,y)=> (state.base[y][x]||'floor');
  const isPlayer = (e)=> e.type===EntityTypes.player;
  const isBoxLike = (e)=> e.type===EntityTypes.box || e.type===EntityTypes.heavyBox || e.type===EntityTypes.triBox;
  const isFragileEnt = (e)=> e.type===EntityTypes.fragileWall;
  const supportsPlayer = (t)=> !isTrait(t,'isWallForPlayer') && !isTrait(t,'isHoleForPlayer') && t!=='exit';
  const supportsBox = (t)=> !isTrait(t,'isWallForBox') && !isTrait(t,'isHoleForBox');

  // Occupancy per cell
  const occ = new Map();
  for (const e of (state.entities||[])){
    const k = e.x+","+e.y;
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k).push(e);
  }
  for (const [k, arr] of occ){
    const hasPlayer = arr.some(isPlayer);
    const boxes = arr.filter(isBoxLike);
    const hasFragile = arr.some(isFragileEnt);
    if (hasPlayer && (boxes.length>0 || hasFragile)) return false;
    if (boxes.length>1) return false;
    if (boxes.length>=1 && hasFragile) return false;
  }
  for (const e of (state.entities||[])){
    const t = tileAt(e.x, e.y);
    if (isPlayer(e)) {
      if (!supportsPlayer(t)) return false;
    } else if (isBoxLike(e)) {
      if (!supportsBox(t)) return false;
    }
  }
  return true;
}

function randomOther(list, current) {
  const choices = list.filter(t => t !== current);
  if (!choices.length) return null;
  return choices[Math.floor(Math.random() * choices.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// A tile supports boxes if it is not a wall-for-box nor a hole-for-box
function allowsBoxTile(tileType) {
  return !isTrait(tileType, 'isWallForBox') && !isTrait(tileType, 'isHoleForBox');
}

// Build a stable, compact key for a candidate state to detect duplicates
// Zobrist-like fast hash for dedupe (includes tiles and entities, player mode/dir)
let zCache = null;
function rndBig() {
  const n = Math.floor(Math.random() * 2**30);
  const m = Math.floor(Math.random() * 2**23);
  return (BigInt(n) << 23n) ^ BigInt(m);
}
function ensureZ(rows, cols) {
  if (zCache && zCache.rows === rows && zCache.cols === cols) return;
  const tileTypes = Array.from(new Set(ALL_TILES.concat(['floor'])));
  const makeGrid = () => Array.from({ length: rows }, () => Array.from({ length: cols }, () => rndBig()));
  const tiles = {};
  for (const t of tileTypes) tiles[t] = makeGrid();
  const entities = {
    box: makeGrid(),
    heavyBox: makeGrid(),
    triBox_NE: makeGrid(),
    triBox_NW: makeGrid(),
    triBox_SE: makeGrid(),
    triBox_SW: makeGrid(),
    fragileWall: makeGrid(),
    player_free: makeGrid(),
    player_inbox_r: makeGrid(),
    player_inbox_l: makeGrid(),
    player_inbox_u: makeGrid(),
    player_inbox_d: makeGrid(),
    player_inbox_z: makeGrid()
  };
  zCache = { rows, cols, salt: rndBig(), tiles, entities };
}
function dirKey(d) {
  if (!d || (d.dx === 0 && d.dy === 0)) return 'z';
  if (d.dx === 1) return 'r';
  if (d.dx === -1) return 'l';
  if (d.dy === -1) return 'u';
  if (d.dy === 1) return 'd';
  return 'z';
}
function stateKey(s) {
  ensureZ(s.size.rows, s.size.cols);
  let h = 0n ^ zCache.salt;
  // tiles
  for (let y = 0; y < s.size.rows; y++) {
    for (let x = 0; x < s.size.cols; x++) {
      const tt = s.base[y][x] || 'floor';
      const grid = zCache.tiles[tt];
      if (grid) h ^= grid[y][x];
    }
  }
  // entities
  for (const e of (s.entities || [])) {
    if (e.type === EntityTypes.player) {
      if (e.state?.mode === 'free') h ^= zCache.entities.player_free[e.y][e.x];
      else {
        const k = dirKey(e.state?.entryDir);
        h ^= zCache.entities['player_inbox_' + k][e.y][e.x];
      }
    } else if (e.type === EntityTypes.triBox) {
      const ori = (e.state && e.state.orient) || 'SE';
      const key = 'triBox_' + (['NE','NW','SE','SW'].includes(ori) ? ori : 'SE');
      const grid = zCache.entities[key];
      if (grid) h ^= grid[e.y][e.x];
    } else {
      const grid = zCache.entities[e.type];
      if (grid) h ^= grid[e.y][e.x];
    }
  }
  return h.toString();
}

// Public: Simplify an entire level by iteratively
// 1) removing outer rows/cols, and
// 2) replacing tiles with simpler equivalents,
// while preserving solver outputs: same solutions and step counts; and optionally same dead-end counts.
export async function simplifyLevel(inputState, { runSolver, params = {}, preserveDeadEnds = true } = {}) {
  let current = cloneState(inputState);
  const limits = {
    maxDepth: params.maxDepth || 100,
    maxNodes: params.maxNodes || 200000,
    maxSolutions: Math.max(params.maxSolutions || 50, 1)
  };
  let baseline = await runSolver(current, { ...limits, onProgress: () => {} });
  let baseSig = solverSignature(baseline);

  function parts(res){
    const sols = Array.isArray(res?.solutions) ? res.solutions : [];
    const cnt = sols.length;
    const minL = cnt ? Math.min(...sols.map(s=>s.length)) : 0;
    const dead = Array.isArray(res?.deadEnds) ? res.deadEnds.length : 0;
    return { cnt, minL, dead };
  }
  let baseFlex = parts(baseline);

  async function accept(res, sig){
    if (preserveDeadEnds) return sameSignature(baseSig, sig, true);
    const p = parts(res);
    // Flex: keep number of solutions and shortest length unchanged; prefer fewer dead ends
    if (p.cnt === baseFlex.cnt && p.minL === baseFlex.minL) {
      if (p.dead <= baseFlex.dead) {
        baseFlex = p; // tighten baseline toward fewer dead ends
        return true;
      }
    }
    return false;
  }

  let changed = true;
  while (changed) {
    changed = false;

    // Try border removals greedily
    const borderMutations = [
      (s) => removeRow(s, 'top'),
      (s) => removeRow(s, 'bottom'),
      (s) => removeColumn(s, 'left'),
      (s) => removeColumn(s, 'right')
    ];
    let removed = false;
    if (preserveDeadEnds) {
      for (const mut of borderMutations) {
        const next = mut(current);
        if (!next) continue;
        const res = await runSolver(next, { ...limits, onProgress: () => {} });
        const sig = solverSignature(res);
        if (sameSignature(baseSig, sig, true)) {
          current = next;
          baseSig = sig;
          removed = true;
          changed = true;
          break;
        }
        await tick();
      }
    } else {
      // Flex: choose the border removal (if any) that reduces dead ends while keeping sol count and shortest length
      let best = null;
      for (const mut of borderMutations) {
        const next = mut(current);
        if (!next) continue;
        const res = await runSolver(next, { ...limits, onProgress: () => {} });
        const sig = solverSignature(res);
        const p = parts(res);
        if (p.cnt === baseFlex.cnt && p.minL === baseFlex.minL && p.dead <= baseFlex.dead) {
          if (!best || p.dead < best.p.dead) best = { next, res, sig, p };
        }
        await tick();
      }
      if (best) {
        current = best.next;
        // baseSig not used for flex acceptance, but keep it roughly in sync with solutions if needed
        baseSig = best.sig;
        baseFlex = best.p;
        removed = true;
        changed = true;
      }
    }
    if (removed) continue;

    // Try to simplify tiles across whole grid; one change at a time
    let simplifiedOne = false;
    outer: for (let y = 0; y < current.size.rows; y++) {
      for (let x = 0; x < current.size.cols; x++) {
        const cur = current.base[y][x] || 'floor';
        const simplerOptions = ['wall','hole','floor']
          .filter(t => isSimplerTile(t, cur))
          .sort((a, b) => tileRank(a) - tileRank(b));
        if (!simplerOptions.length) continue;

        const hasBox = current.entities?.some(e => (e.type === EntityTypes.box || e.type === EntityTypes.heavyBox) && e.x === x && e.y === y);
        const options = simplerOptions.filter(t => !hasBox || allowsBoxTile(t));
        for (const t of options) {
          const prev = cur;
          const testState = cloneState(current);
          testState.base[y][x] = t;
          const res = await runSolver(testState, { ...limits, onProgress: () => {} });
          const sig = solverSignature(res);
          if (await accept(res, sig)) {
            current = testState;
            baseSig = sig;
            simplifiedOne = true;
            changed = true;
            break outer;
          }
          await tick();
        }
      }
    }
    if (simplifiedOne) continue;

    // Try to simplify entities: heavyBox/triBox -> box, one at a time
    let simplifiedEnt = false;
    for (let i = 0; i < (current.entities?.length || 0); i++) {
      const e = current.entities[i];
      if (!e) continue;
      if (e.type !== EntityTypes.heavyBox && e.type !== EntityTypes.triBox) continue;
      const testState = cloneState(current);
      // Replace entity with a regular box at same position
      testState.entities = testState.entities.map((en, idx) => idx === i ? { type: EntityTypes.box, x: en.x, y: en.y } : en);
      const res = await runSolver(testState, { ...limits, onProgress: () => {} });
      const sig = solverSignature(res);
      if (await accept(res, sig)) {
        current = testState;
        baseSig = sig;
        changed = true;
        simplifiedEnt = true;
        break;
      }
      await tick();
    }
    if (simplifiedEnt) continue;
  }

  return current;
}

// Attempt to replace newly changed tiles with simpler ones while keeping solver outputs identical
async function simplifyTilesPreservingResult({ base, candidate, params, runSolver, prevResult }) {
  const origSig = solverSignature(prevResult);
  const rows = candidate.size.rows;
  const cols = candidate.size.cols;

  // Find positions where candidate differs from base
  const diffs = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = (base.base[y][x] || 'floor');
      const b = (candidate.base[y][x] || 'floor');
      if (a !== b) diffs.push({ x, y });
    }
  }

  let currentSig = origSig;

  for (const { x, y } of diffs) {
    let curType = candidate.base[y][x] || 'floor';
    while (true) {
      const simplerOptions = ['wall','hole','floor']
        .filter(t => isSimplerTile(t, curType))
        .sort((t1, t2) => tileRank(t1) - tileRank(t2));
      if (!simplerOptions.length) break;

      // If a box/heavyBox is at this cell, keep only box-legal tiles
      const hasBox = candidate.entities?.some(e => (e.type === EntityTypes.box || e.type === EntityTypes.heavyBox) && e.x === x && e.y === y);
      const options = simplerOptions.filter(t => !hasBox || allowsBoxTile(t));
      if (!options.length) break;

      let applied = false;
      for (const t of options) {
        const prev = curType;
        candidate.base[y][x] = t;
        const test = await runSolver(candidate, {
          maxDepth: params.maxDepth,
          maxNodes: params.maxNodes,
          maxSolutions: Math.max(params.maxSolutions, 1),
          onProgress: () => {}
        });
        const testSig = solverSignature(test);
        if (sameSignature(currentSig, testSig)) {
          // accept and continue trying to simplify further
          curType = t;
          currentSig = testSig; // unchanged by definition, but keep consistent
          applied = true;
          break;
        } else {
          // revert
          candidate.base[y][x] = prev;
        }
      }
      if (!applied) break; // cannot simplify further at this cell
    }
  }
}

function traitKeys(tileType) {
  const t = getTileTraits(tileType) || {};
  return Object.keys(t).filter(k => k !== 'name' && t[k] === true);
}

function traitCount(tileType) { return traitKeys(tileType).length; }

function tileRank(tileType) {
  // Simplicity order: wall (simplest) < hole < floor (least simple among the three)
  if (tileType === 'wall') return 0;
  if (tileType === 'hole') return 1;
  if (tileType === 'floor') return 2;
  return Number.POSITIVE_INFINITY;
}

function isSimplerTile(candidateTile, originalTile) {
  // Simpler tiles are restricted to floor < hole < wall
  const candR = tileRank(candidateTile);
  const origR = tileRank(originalTile);
  return candR < origR;
}

function solverSignature(result) {
  const sols = Array.isArray(result?.solutions) ? result.solutions : [];
  const deads = Array.isArray(result?.deadEnds) ? result.deadEnds : [];
  const norm = arr => arr.map(s => `${s.moves || ''}|${s.length || 0}`).sort();
  return { s: norm(sols), d: norm(deads) };
}

function sameSignature(a, b, includeDeads = true) {
  if (!a || !b) return false;
  if (a.s.length !== b.s.length || a.d.length !== b.d.length) return false;
  for (let i = 0; i < a.s.length; i++) if (a.s[i] !== b.s[i]) return false;
  if (includeDeads) {
    for (let i = 0; i < a.d.length; i++) if (a.d[i] !== b.d[i]) return false;
  }
  return true;
}

function tick() { return new Promise(r => setTimeout(r, 0)); }

function readScoringConfig(){
  const num = (id, def) => { const el = document.getElementById(id); const v = Number(el?.value); return Number.isFinite(v) ? v : def; };
  const bool = (id, def=false) => { const el = document.getElementById(id); return el ? !!el.checked : def; };
  const sel = (id, def) => { const el = document.getElementById(id); return el?.value || def; };

  const weights = {
    U: num('scW_U', 1.0),
    D: num('scW_D', 0.5),
    Fr: num('scW_Fr', 0.8),
    S: num('scW_S', 1.2),
    M: num('scW_M', 0.6),
    F: num('scW_F', 1.0),
    Y: num('scW_Y', 0.0)
  };

  const bands = {
    U: { enabled: bool('scB_U_en', true), min: num('scB_U_min', 0.10), max: num('scB_U_max', 1.00) },
    D: { enabled: bool('scB_D_en', false), min: num('scB_D_min', 0.00), max: num('scB_D_max', 1.00) },
    Fr:{ enabled: bool('scB_Fr_en', false), min: num('scB_Fr_min', 0.00), max: num('scB_Fr_max', 1.00) },
    S: { enabled: bool('scB_S_en', true),  min: num('scB_S_min', 0.20), max: num('scB_S_max', 1.00) },
    M: { enabled: bool('scB_M_en', false), min: num('scB_M_min', 0.00), max: num('scB_M_max', 1.00) },
    F: { enabled: bool('scB_F_en', false), min: num('scB_F_min', 0.00), max: num('scB_F_max', 1.00) },
    Y: { enabled: bool('scB_Y_en', false), min: num('scB_Y_min', 0.00), max: num('scB_Y_max', 1.00) }
  };

  const params = {
    U: { S_max: Math.max(1, Math.floor(num('scP_U_Smax', 16))) },
    S: { L_min: Math.max(1, Math.floor(num('scP_S_Lmin', 8))), L_max: Math.max(2, Math.floor(num('scP_S_Lmax', 30))) },
    F: { dead_end_h: 1, ideal_kind: sel('scP_F_kind', 'sine') },
    Y: { sym_mode: sel('scP_Y_sym', 'horizontal') }
  };

  const globalConstraints = {
    min_dead_end_depth_len: Math.max(0, Math.floor(num('scG_minDedLen', 4))),
    L_min_solvable: Math.max(0, Math.floor(num('scG_LminSolv', 0)))
  };

  const mapSigned = bool('scMapSigned', true);
  return { weights, bands, params, globalConstraints, mapSigned };
}

function buildMoveIndex(edges){
  const idx = new Map();
  if (!Array.isArray(edges)) return idx;
  for (const e of edges){
    if (e.losing) continue;
    if (!idx.has(e.parent)) idx.set(e.parent, new Map());
    const m = idx.get(e.parent);
    if (!m.has(e.move)) m.set(e.move, e.child);
  }
  return idx;
}
  // Toggle buttons for entity mutations
  const movePlayerBtn = document.getElementById('autoMovePlayer');
  const placeBoxesBtn = document.getElementById('autoPlaceBoxes');
  const removeBoxesBtn = document.getElementById('autoRemoveBoxes');

  [movePlayerBtn, placeBoxesBtn, removeBoxesBtn].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const on = btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });






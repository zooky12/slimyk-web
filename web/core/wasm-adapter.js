// Assets/Tools/wasm-adapter.js
// Lightweight adapter to load .NET WASM and expose typed JS wrappers.

let __wasmSingleton = null;
let __wasmBooting = null;

export async function initWasm(baseUrl) {
  if (__wasmSingleton) return __wasmSingleton;
  if (__wasmBooting) return __wasmBooting;

  __wasmBooting = (async () => {
    const baseResolved = new URL(
    baseUrl ? (typeof baseUrl === 'string' ? baseUrl : baseUrl.href) : '../wasm/',
    import.meta.url
  ).href;
  const fw = new URL('_framework/', baseResolved).href;

  // Prefer fixed relative import to keep bundlers happy; fall back to dynamic on error
  let dotnetMod;
  try {
    dotnetMod = await import('../wasm/_framework/dotnet.js');
  } catch (e) {
    dotnetMod = await import(/* @vite-ignore */ (fw + 'dotnet.js'));
  }

  const { getAssemblyExports, getConfig } = await dotnetMod.dotnet
    .withModuleConfig({
      locateFile: (p) => new URL(p, fw).href,
      // GitHub Pages + SRI: bypass integrity fetch for optional symbol files
      loadBootResource: (type, name, defaultUri, integrity) => {
        try {
          if (typeof name === 'string' && name.endsWith('.symbols')) {
            // Provide an empty successful response so the runtime doesn't fail on SRI mismatch
            return new Response(new Blob(['']), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
          }
        } catch {}
        return defaultUri;
      }
    })
    .create();
    const cfg = getConfig();

    // Try to obtain exports from plausible assemblies
    const tried = new Set();
    const typeNames = new Set();
    function addTypes(obj){ for (const k of Object.keys(obj||{})) typeNames.add(k); }
    async function tryExports(name){
      if (!name || tried.has(name)) return null;
      tried.add(name);
      try {
        const ex = await getAssemblyExports(name);
        addTypes(ex||{});
        return ex;
      } catch {
        return null;
      }
    }

    const cands = [];
    const main = cfg?.mainAssemblyName;
    if (main) cands.push(main);
    if (main && main.endsWith('.dll')) cands.push(main.slice(0, -4));
    cands.push('EngineWasm');

    let ex = {};
    for (const nm of cands) {
      const candidate = await tryExports(nm);
      if (candidate && Object.keys(candidate).length) { ex = candidate; break; }
    }
    // If still empty, try once more with all candidates to gather names for error messages
    if (!ex || !Object.keys(ex).length) {
      for (const nm of cands) await tryExports(nm);
    }

  const toJsonString = (value) => {
    if (value == null) throw new Error('Expected non-null JSON value');
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) throw new Error('Empty string');
      return s;
    }
    return JSON.stringify(value);
  };

    // Resolve exported type that contains Engine_* methods; if not available, fall back to binding static methods
    let E = ex && ex.Exports;
    if (!E || typeof E.Engine_Init !== 'function') {
      for (const k of Object.keys(ex || {})) {
        const t = ex[k];
        if (t && typeof t.Engine_Init === 'function') { E = t; break; }
      }
    }

    if (!E || typeof E.Engine_Init !== 'function') {
      // Fallback: use runtime binder to bind static methods by signature
      let runtime = null;
      try {
        if (typeof globalThis.getDotnetRuntime === 'function') {
          runtime = await globalThis.getDotnetRuntime(0);
        }
      } catch {}
      const binder = runtime && (runtime.BINDING || runtime.binding || runtime.mono_bind_static_method && { bind_static_method: runtime.mono_bind_static_method });
      if (binder && typeof binder.bind_static_method === 'function') {
        const asm = (cfg?.mainAssemblyName || 'EngineWasm').replace(/\.dll$/i, '');
        const bind = (sig) => binder.bind_static_method(sig);
        try {
          const tryMethod = (name) => {
            try { return bind(`[${asm}] Exports:${name}`); } catch { return null; }
          };
          const Engine_Init = tryMethod('Engine_Init');
          if (!Engine_Init) throw new Error('bind Engine_Init failed');
          E = {
            Engine_Init,
            Engine_GetState: tryMethod('Engine_GetState'),
            Engine_SetState: tryMethod('Engine_SetState'),
            Engine_Step: tryMethod('Engine_Step'),
            Engine_Undo: tryMethod('Engine_Undo'),
            Engine_Reset: tryMethod('Engine_Reset'),
            Engine_StepAndState: tryMethod('Engine_StepAndState'),
            Catalog_GetTiles: tryMethod('Catalog_GetTiles'),
            Catalog_GetEntities: tryMethod('Catalog_GetEntities'),
            Catalog_GetBehaviors: tryMethod('Catalog_GetBehaviors'),
            Level_SetTile: tryMethod('Level_SetTile'),
            Level_SpawnEntity: tryMethod('Level_SpawnEntity'),
            Level_RemoveEntityAt: tryMethod('Level_RemoveEntityAt'),
            Level_SetEntityOrientation: tryMethod('Level_SetEntityOrientation'),
            Level_SetPlayer: tryMethod('Level_SetPlayer'),
            Level_Resize: tryMethod('Level_Resize'),
            State_TraitsAt: tryMethod('State_TraitsAt'),
            Level_ApplyEdit: tryMethod('Level_ApplyEdit')
          };
        } catch {}
      }
    }

    if (!E || typeof E.Engine_Init !== 'function') {
      const keys = Object.keys(ex || {});
      const all = Array.from(typeNames);
      // eslint-disable-next-line no-console
      console.error('[wasm-adapter] Unable to locate Engine_Init export', { mainAssemblyName: cfg?.mainAssemblyName, tried: Array.from(tried), availableTypes: all });
      throw new Error('WASM exports not found (Engine_Init). Available export types: ' + all.join(', '));
    }
    const has = (name) => E && typeof E[name] === 'function';
    const asmName = (cfg?.mainAssemblyName || 'EngineWasm').replace(/\.dll$/i, '');
    async function ensureBound(name) {
      if (has(name)) return E[name];
      // try late-bind via runtime binder without replacing other members
      try {
        let runtime = null;
        if (typeof globalThis.getDotnetRuntime === 'function') {
          runtime = await globalThis.getDotnetRuntime(0);
        }
        const binder = runtime && (runtime.BINDING || runtime.binding || (runtime.mono_bind_static_method && { bind_static_method: runtime.mono_bind_static_method }));
        if (binder && typeof binder.bind_static_method === 'function') {
          const candidates = [];
          // Basic form
          candidates.push(`[${asmName}] Exports:${name}`);
          // With explicit parameter signature for known methods
          const sigMap = {
            'Solver_Analyze': '(System.String,System.String)',
            'ALD_TryMutate': '(System.String)',
            'ALD_PlaceOne': '(System.String,System.String)',
            'ALD_RemoveOne': '(System.String,System.String)',
            'ALD_SelectBase': '(System.String,System.Int32,System.Double)',
            'ALD_SolutionSimilarityMoves': '(System.String,System.String)',
            'ALD_LayoutSimilarity': '(System.String,System.String)',
            'ALD_NewContext': '(System.String)',
            'ALD_CloseContext': '(System.String)',
            'ALD_InsertCandidate': '(System.String,System.String,System.String)',
            'ALD_GetBucketsSummary': '(System.String)',
            'ALD_SelectBaseCtx': '(System.String,System.Int32,System.Double)',
            'ALD_Mutate': '(System.String,System.String,System.String)',
            'Level_ApplyEdit': '(System.String,System.Int32,System.Int32,System.Int32,System.Int32,System.Int32)',
            'Level_SetTile': '(System.String,System.Int32,System.Int32,System.Int32)',
            'Level_SpawnEntity': '(System.String,System.Int32,System.Int32,System.Int32)',
            'Level_RemoveEntityAt': '(System.String,System.Int32,System.Int32)',
            'Level_SetEntityOrientation': '(System.String,System.Int32,System.Int32)',
            'Level_SetPlayer': '(System.String,System.Int32,System.Int32)',
          };
          if (sigMap[name]) candidates.push(`[${asmName}] Exports:${name}${sigMap[name]}`);
          try { for (const t of Object.keys(ex || {})) { candidates.push(`[${asmName}] ${t}:${name}`); } } catch {}
          for (const sig of candidates) {
            try { console.debug && console.debug('[wasm-adapter] late-bind try', sig); } catch {}
            try {
              const fn = binder.bind_static_method(sig);
              if (fn) { E[name] = fn; return fn; }
            } catch {}
          }
        }
      } catch {}
      return undefined;
    }

    const api = {
    // Engine lifecycle
    initLevel: (level) => E.Engine_Init(toJsonString(level)),
    getState:  (sid)   => JSON.parse(E.Engine_GetState(sid)),
    setState:  (sid, level) => E.Engine_SetState(sid, toJsonString(level)),

    // Steps
    step:      (sid, dir) => JSON.parse(E.Engine_Step(sid, dir)),
    stepAndState: (sid, dir) => JSON.parse(E.Engine_StepAndState(sid, dir)),
    undo:      (sid)   => E.Engine_Undo(sid),
    reset:     (sid)   => E.Engine_Reset(sid),
    commitBaseline: (sid) => E.Engine_CommitBaseline(sid),

    // Catalog
    getTiles:      () => JSON.parse(E.Catalog_GetTiles()),
    getEntities:   () => JSON.parse(E.Catalog_GetEntities()),
    getBehaviors:  () => JSON.parse(E.Catalog_GetBehaviors()),
    // Builder ops
    setTile: (sid, x, y, tileId) => JSON.parse(E.Level_SetTile(sid, x, y, tileId)),
    spawnEntity: (sid, typeId, x, y) => JSON.parse(E.Level_SpawnEntity(sid, typeId, x, y)),
    removeEntityAt: (sid, x, y) => JSON.parse(E.Level_RemoveEntityAt(sid, x, y)),
    setEntityOrientation: (sid, entityId, rot) => JSON.parse(E.Level_SetEntityOrientation(sid, entityId, rot)),
    setPlayer: (sid, x, y) => JSON.parse(E.Level_SetPlayer(sid, x, y)),
    applyEdit: (sid, kind, x, y, type, rot) => JSON.parse(E.Level_ApplyEdit(sid, kind, x, y, type, rot)),
    resize: async (sid, add, dir) => {
      const fn = has('Level_Resize') ? E.Level_Resize : await ensureBound('Level_Resize');
      if (!fn) throw new Error('Level_Resize not available');
      return JSON.parse(fn(sid, !!add, dir));
    },

    // Introspection
    stateTraitsAt: (sid, x, y) => E.State_TraitsAt(sid, x, y),
    rotateEntityAt: (sid, x, y, rot) => JSON.parse(E.Level_ApplyEdit(sid, 4, x, y, -1, rot)),

    // Optional features (Unity-Editor-only in this repo)
    solverAnalyze: async (level, cfg) => {
      let fn = has('Solver_Analyze') ? E.Solver_Analyze : await ensureBound('Solver_Analyze');
      if (!fn) throw new Error('Solver_Analyze not available in this build');
      return JSON.parse(fn(toJsonString(level), cfg ? JSON.stringify(cfg) : null));
    },
    aldTryMutate: async (level) => {
      let fn = has('ALD_TryMutate') ? E.ALD_TryMutate : await ensureBound('ALD_TryMutate');
      if (!fn) throw new Error('ALD_TryMutate not available in this build');
      return JSON.parse(fn(toJsonString(level)));
    },
    // Context manager APIs
    aldNewContext: async (settings) => {
      let fn = has('ALD_NewContext') ? E.ALD_NewContext : await ensureBound('ALD_NewContext');
      if (!fn) throw new Error('ALD_NewContext not available');
      return JSON.parse(fn(toJsonString(settings)));
    },
    aldCloseContext: async (ctxId) => {
      let fn = has('ALD_CloseContext') ? E.ALD_CloseContext : await ensureBound('ALD_CloseContext');
      if (!fn) throw new Error('ALD_CloseContext not available');
      return JSON.parse(fn(String(ctxId||'')));
    },
    aldInsertCandidate: async (ctxId, level, solverCfg) => {
      let fn = has('ALD_InsertCandidate') ? E.ALD_InsertCandidate : await ensureBound('ALD_InsertCandidate');
      if (!fn) throw new Error('ALD_InsertCandidate not available');
      return JSON.parse(fn(String(ctxId||''), toJsonString(level), solverCfg ? JSON.stringify(solverCfg) : null));
    },
    aldGetBucketsSummary: async (ctxId) => {
      let fn = has('ALD_GetBucketsSummary') ? E.ALD_GetBucketsSummary : await ensureBound('ALD_GetBucketsSummary');
      if (!fn) throw new Error('ALD_GetBucketsSummary not available');
      return JSON.parse(fn(String(ctxId||'')));
    },
    aldSelectBaseCtx: async (ctxId, topK, skew) => {
      let fn = has('ALD_SelectBaseCtx') ? E.ALD_SelectBaseCtx : await ensureBound('ALD_SelectBaseCtx');
      if (!fn) throw new Error('ALD_SelectBaseCtx not available');
      return JSON.parse(fn(String(ctxId||''), (topK|0), Number(skew)));
    },
    aldMutate: async (ctxId, level, mutate) => {
      let fn = has('ALD_Mutate') ? E.ALD_Mutate : await ensureBound('ALD_Mutate');
      if (!fn) throw new Error('ALD_Mutate not available');
      return JSON.parse(fn(String(ctxId||''), toJsonString(level), mutate ? JSON.stringify(mutate) : null));
    },
    aldSelectBase: async (entries, topK, skew) => {
      let fn = has('ALD_SelectBase') ? E.ALD_SelectBase : await ensureBound('ALD_SelectBase');
      if (!fn) throw new Error('ALD_SelectBase not available in this build');
      return JSON.parse(fn(toJsonString(entries), (topK|0), Number(skew)));
    },
    aldSolutionSimilarityMoves: async (movesA, movesB) => {
      let fn = has('ALD_SolutionSimilarityMoves') ? E.ALD_SolutionSimilarityMoves : await ensureBound('ALD_SolutionSimilarityMoves');
      if (!fn) throw new Error('ALD_SolutionSimilarityMoves not available in this build');
      return Number(fn(String(movesA||''), String(movesB||'')));
    },
    aldLayoutSimilarity: async (levelA, levelB) => {
      let fn = has('ALD_LayoutSimilarity') ? E.ALD_LayoutSimilarity : await ensureBound('ALD_LayoutSimilarity');
      if (!fn) throw new Error('ALD_LayoutSimilarity not available in this build');
      return Number(fn(toJsonString(levelA), toJsonString(levelB)));
    },
    aldPlaceOne: async (level, opts) => {
      let fn = has('ALD_PlaceOne') ? E.ALD_PlaceOne : await ensureBound('ALD_PlaceOne');
      if (!fn) throw new Error('ALD_PlaceOne not available in this build');
      return JSON.parse(fn(toJsonString(level), opts ? JSON.stringify(opts) : null));
    },
    aldRemoveOne: async (level, opts) => {
      let fn = has('ALD_RemoveOne') ? E.ALD_RemoveOne : await ensureBound('ALD_RemoveOne');
      if (!fn) throw new Error('ALD_RemoveOne not available in this build');
      return JSON.parse(fn(toJsonString(level), opts ? JSON.stringify(opts) : null));
    },

    // Debug helpers (not for production): surface what exports we can see/bind
    __debugExports: async () => {
      const keysE = Object.keys(E || {});
      const sol = has('Solver_Analyze');
      let bound = false;
      if (!sol) bound = !!(await ensureBound('Solver_Analyze'));
      // also probe debug helpers if present
      let pingOk = false;
      let solAvail = false;
      try {
        let ping = has('Debug_Ping') ? E.Debug_Ping : await ensureBound('Debug_Ping');
        if (ping) pingOk = !!ping();
      } catch {}
      try {
        let av = has('Solver_ExportsPresent') ? E.Solver_ExportsPresent : await ensureBound('Solver_ExportsPresent');
        if (av) solAvail = !!av();
      } catch {}
      return { asm: asmName, hasSolver: sol, boundAfter: bound, pingOk, solverExportsPresent: solAvail, exportKeys: keysE };
    },
    };
    __wasmSingleton = api;
    return api;
  })();

  try {
    const api = await __wasmBooting;
    return api;
  } finally {
    __wasmBooting = null;
  }
}

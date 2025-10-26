// Assets/Tools/wasm-adapter.js
// Lightweight adapter to load .NET WASM and expose typed JS wrappers.

export async function initWasm(baseUrl) {
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
    .withModuleConfig({ locateFile: (p) => new URL(p, fw).href })
    .create();
  const cfg = getConfig();
  const ex = await getAssemblyExports(cfg.mainAssemblyName);

  const toJsonString = (value) => {
    if (value == null) throw new Error('Expected non-null JSON value');
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) throw new Error('Empty string');
      return s;
    }
    return JSON.stringify(value);
  };

  const E = ex.Exports;
  const has = (name) => E && typeof E[name] === 'function';

  return {
    // Engine lifecycle
    initLevel: (level) => E.Engine_Init(toJsonString(level)),
    getState:  (sid)   => JSON.parse(E.Engine_GetState(sid)),
    setState:  (sid, level) => E.Engine_SetState(sid, toJsonString(level)),

    // Steps
    step:      (sid, dir) => JSON.parse(E.Engine_Step(sid, dir)),
    stepAndState: (sid, dir) => JSON.parse(E.Engine_StepAndState(sid, dir)),
    undo:      (sid)   => E.Engine_Undo(sid),
    reset:     (sid)   => E.Engine_Reset(sid),

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

    // Introspection
    stateTraitsAt: (sid, x, y) => E.State_TraitsAt(sid, x, y),
    rotateEntityAt: (sid, x, y, rot) => JSON.parse(E.Level_ApplyEdit(sid, 4, x, y, -1, rot)),

    // Optional features (Unity-Editor-only in this repo)
    solverAnalyze: (level, cfg) => {
      if (!has('Solver_Analyze')) throw new Error('Solver_Analyze not available in this build');
      return JSON.parse(E.Solver_Analyze(toJsonString(level), cfg ? JSON.stringify(cfg) : null));
    },
    aldTryMutate: (level) => {
      if (!has('ALD_TryMutate')) throw new Error('ALD_TryMutate not available in this build');
      return JSON.parse(E.ALD_TryMutate(toJsonString(level)));
    },
  };
}
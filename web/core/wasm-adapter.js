export async function initWasm(base = '/wasm/') {
  const fw = base.endsWith('/') ? base + '_framework/' : base + '/_framework/';
  const { dotnet } = await import(fw + 'dotnet.js');
  const { getAssemblyExports, getConfig } = await dotnet
    .withModuleConfig({ locateFile: (path) => fw + path })
    .create();
  const cfg = getConfig();
  const ex = await getAssemblyExports(cfg.mainAssemblyName);

  return {
    initLevel: (json) => ex.Exports.Engine_Init(json),
    getState:  (sid)  => JSON.parse(ex.Exports.Engine_GetState(sid)),
    step:      (sid, dir) => JSON.parse(ex.Exports.Engine_Step(sid, dir)),
    undo:      (sid)  => ex.Exports.Engine_Undo(sid),
    reset:     (sid)  => ex.Exports.Engine_Reset(sid),

    getTiles:     () => JSON.parse(ex.Exports.Catalog_GetTiles()),
    getEntities:  () => JSON.parse(ex.Exports.Catalog_GetEntities()),
    applyEdit: (sid, kind, x, y, type, rot) =>
        JSON.parse(ex.Exports.Level_ApplyEdit(sid, kind, x, y, type, rot)),
  };

}

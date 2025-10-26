# WASM API Surface

JavaScript entry: `Assets/Tools/wasm-adapter.js` -> `initWasm(baseUrl)`.
C# exports: `Assets/Tools/Exports.cs`.

## Engine
- initLevel(levelJson|object) -> `sid`
  - Input: Level JSON (Loader schema). Returns session id string.
- getState(sid) -> `{ w,h,tiles[], player{ x,y,attached,entryDir }, entities[] }`
- setState(sid, levelJson|object) -> `sid`
- step(sid, dir) -> `{ moved, win, lose, deltas[] }`
  - `dir`: 0=N,1=E,2=S,3=W
  - `deltas[]` items:
    - `{ k:"Attempt", actor, verb, dir, entityId? }`
    - `{ k:"Blocked", actor, verb, dir, at:{x,y}, reason }`
    - `{ k:"MoveStraight", id, from:{x,y}, to:{x,y}, dir, tiles, kind }`
    - `{ k:"MoveEntity", id, from:{x,y}, to:{x,y}, kind }`
    - `{ k:"DestroyEntity", id, at:{x,y}, kind }`
    - `{ k:"SetAttachment", entityId, entryDir|null }`
    - `{ k:"SetGameOver" }`
    - `{ k:"SetWin" }`
    - `{ k:"ButtonStateChanged", anyPressed }`
    - `{ k:"AnimationCue", cue, at?:{x,y}, intensity }`
- stepAndState(sid, dir) -> `{ step:{...}, state:{...} }`
- undo(sid) -> `bool`
- reset(sid) -> `void`

## Catalog
- getTiles() -> `[ { id:int, name:string } ]`
- getEntities() -> `[ { id:int, name:string } ]` (excludes `PlayerSpawn`)
- getBehaviors() -> `[ { id:int, name:string } ]`

## Builder (simple edits)
- applyEdit(sid, kind, x, y, type, rot) -> `{ ok, err? }`
  - kind: 0=SetTile, 1=PlaceEntity, 2=Remove, 3=MovePlayer, 4=RotateEntity (by entityId if >0, else at x,y)
- setTile(sid, x, y, tileId) -> `{ ok, err? }`
- spawnEntity(sid, typeId, x, y) -> `{ ok, id?, err? }`
- removeEntityAt(sid, x, y) -> `{ ok, id?, err? }`
- setEntityOrientation(sid, entityId, rot) -> `{ ok, err? }` (`rot`: 0..3)
- setPlayer(sid, x, y) -> `{ ok, err? }``n- rotateEntityAt(sid, x, y, rot) -> `{ ok, err? }`

## Introspection
- stateTraitsAt(sid, x, y) -> `int` (bitmask of Traits at cell)

## Optional (Unity Editor builds only)
- solverAnalyze(levelJson|object, cfg?) -> `SolverReport`
  - `cfg` maps to `SolverConfig` (`nodesCap`, `depthCap`, `timeCapSeconds`, `enforceTimeCap`).
  - Returns the serialized `SolverReport` (see `Assets/Tools/Solver/ReportModels.cs`).
- aldTryMutate(levelJson|object) -> `{ ok, level? }`
  - Returns a mutated level DTO when a change was applied.

## Notes
- All methods that take a JSON accept either a JSON string or a plain JS object; the adapter stringifies for you.
- Tile ids and entity ids are the integer values of `TileType` and `EntityType` enums defined under `Assets/Code/Logic/Core.cs`.
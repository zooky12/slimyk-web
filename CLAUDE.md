# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Slimyk is a puzzle game. The web repo is for fast iteration — game logic runs as C# compiled to WebAssembly, served as static files with a vanilla JS frontend. The `.cs` files will eventually move to Unity; the level creation/editor system is web-only and will not go to Unity.

## Commands

**Build C# WASM engine:**
```bash
cd wasm/EngineWasm
dotnet build -c Release --os browser --arch wasm
# Output: bin/Release/net9.0/browser-wasm/AppBundle/
# Copy resulting .wasm and .js files to web/wasm/
```

**Serve the web app:**
```bash
cd web
python3 -m http.server 8000
# Open http://localhost:8000
```

No npm/node build step — pure ES6 modules served as-is.

## Architecture

### Boundary: Unity-bound vs web-only

**Will go to Unity (`.cs` files in `wasm/EngineWasm/`):**
- `Core.cs` — primitives (`Dir`, `V2`, `Traits` bitmask, `TileType`, `EntityType` enums)
- `State.cs` — runtime state (`GameState`, `Grid2D`, `Entity`, `Cell`)
- `Engine.cs` — main game loop (`Step()`)
- `Mechanics.cs` — movement verbs (`Walk`, `PushChain`, `Tumble`, `Fly`)
- `Decisions.cs` — verb selection from input+state
- `TileTraits.cs` — trait definitions per tile type
- `Loader.cs` — JSON → `GameState` parsing
- `EditOps.cs` — authoring operations (`SetTile`, `PlaceEntity`, etc.)
- `BruteForceSolver.cs` — DFS/BFS solver
- `Exports.cs` — JS bridge (`[JSExport]` methods); this layer is WASM-specific

**Web-only (level creation, will NOT go to Unity):**
- `ALDContext.cs`, `ALDTypes.cs` — automated level design mutation engine
- `web/ui/auto-lite.js` — automated creator UI
- `web/workers/ald-worker.js` — ALD runs in a web worker to avoid blocking UI
- `web/ui/build.js` — manual level editor UI
- `web/ui/io.js` — level load/save/export/import

### Game loop data flow

```
JS keypress → dir (0–3) → Exports.Engine_Step() → Engine.Step()
  → Decisions.Decide() → picks Verb (Walk/PushChain/Tumble/Fly)
  → Mechanics.[Verb]() mutates GameState, appends Deltas
  → Engine resolves tile-swaps, checks win/lose
  → returns StepResult JSON to JS → canvas.js renders deltas
```

### Traits system

`Traits` is a 64-bit bitmask defined in `Core.cs`. Each `TileType` has a static trait set in `TileTraits.cs`. The engine checks traits at runtime instead of switch-casing on tile type — this is the main extensibility mechanism. When adding new tile behaviors, add a `Traits` flag and update `TileTraits.cs` rather than branching on type.

### Session model

`Exports.cs` maintains a static dictionary of `Session` objects keyed by GUID. Each session holds a `GameState` plus an undo stack. JS always passes a `sessionId` string to WASM calls. Multiple sessions can exist simultaneously (used by the ALD worker).

### State serialization boundary

- **WASM → JS:** JSON with camelCase, nulls omitted. Tile/entity IDs are numeric in draw DTOs (`DrawDto`), string names in authoring format.
- **JS → WASM:** JSON with string tile/entity names for levels; numeric `dir` (0–3) for input; GUID string for session ID.
- The `tileIdToName` / `entIdToName` maps in `Exports.cs` handle the numeric↔string conversion.

### Level format

Levels are JSON files under `levels/{world}/{name}.json`. Two formats exist (legacy `tileGrid` array-of-arrays and `dto-v2`); `Loader.cs` handles both. The world/level index is:
- `levels/worlds.json` → list of world folder names
- `levels/{world}/index.json` → ordered list of level filenames

### Rendering

`web/ui/canvas.js` draws tiles and entities onto an HTML5 Canvas. Player is rendered as a triangular wedge. Deltas from `StepResult` drive per-frame animations. No game-state diffing — canvas redraws from full state each frame.

## Efficiency notes (per user request)

When reviewing code for efficiency improvements:
- Game functionality must not change — same observable behavior required.
- The `.cs` engine files are the performance-critical path; JS UI code is secondary.
- The ALD system (`ALDContext.cs`, web workers) is web-only and can be optimized independently without affecting Unity-bound code.
- `BruteForceSolver.cs` is used both by the web editor and potentially in Unity; keep it self-contained.
- Avoid allocations in hot paths (inside `Engine.Step()` / `Mechanics.*`); `Deltas` lists and `StepResult` are allocated per step — reuse opportunities exist here.
- `Grid2D` uses a flat array internally; access patterns in `Mechanics.cs` should prefer sequential/row-major traversal.

// JS interop exports for running the logic engine via .NET WebAssembly
// Kept self-contained and safe to include in this Unity project.
// - When building as .NET WASM, methods are annotated with [JSExport]
// - Inside Unity, the same methods exist without attributes so the file compiles

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using SlimeGrid.Logic;

#if EXPOSE_WASM
using System.Runtime.InteropServices.JavaScript;
#endif

public partial class Exports
{
    public static void Main() { }

    // Sessions ---------------------------------------------------------------

    private static readonly Dictionary<string, Session> Sessions = new();

    private static JsonSerializerOptions J => new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    // Engine: lifecycle ------------------------------------------------------

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Engine_Init(string levelJson)
    {
        var start = Loader.FromJson(levelJson);
        var id = Guid.NewGuid().ToString("N");
        Sessions[id] = new Session(start);
        return id;
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Engine_GetState(string sid)
        => JsonSerializer.Serialize(Sessions[sid].ToDto(), J);

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Engine_SetState(string sid, string levelJson)
    {
        var start = Loader.FromJson(levelJson);
        Sessions[sid] = new Session(start);
        return sid;
    }

    // dir: 0=N, 1=E, 2=S, 3=W
#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Engine_Step(string sid, int dir)
    {
        var s = Sessions[sid];
        var before = CloneState(s.StateRef());
        var res = Engine.Step(s.StateRef(), (Dir)dir);
        bool changed = !ShallowEqual(before, s.StateRef());
        var dto = new StepExDto
        {
            moved = changed,
            win = res.Win,
            lose = res.GameOver,
            deltas = MapDeltas(res.Deltas)
        };
        return JsonSerializer.Serialize(dto, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static bool Engine_Undo(string sid) => Sessions[sid].Undo();

#if EXPOSE_WASM
    [JSExport]
#endif
    public static void Engine_Reset(string sid) => Sessions[sid].Reset();

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Engine_StepAndState(string sid, int dir)
    {
        var stepJson = Engine_Step(sid, dir);
        var stateJson = Engine_GetState(sid);
        return JsonSerializer.Serialize(new { step = JsonSerializer.Deserialize<object>(stepJson), state = JsonSerializer.Deserialize<object>(stateJson) }, J);
    }

    // Catalog / metadata -----------------------------------------------------

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Catalog_GetTiles()
    {
        var list = new List<object>();
        foreach (TileType tt in Enum.GetValues(typeof(TileType)))
        {
            list.Add(new { id = (int)tt, name = tt.ToString() });
        }
        return JsonSerializer.Serialize(list, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Catalog_GetEntities()
    {
        var list = new List<object>();
        foreach (EntityType et in Enum.GetValues(typeof(EntityType)))
        {
            if (et == EntityType.PlayerSpawn) continue; // authoring marker only
            list.Add(new { id = (int)et, name = et.ToString() });
        }
        return JsonSerializer.Serialize(list, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Catalog_GetBehaviors()
    {
        var list = new List<object>();
        foreach (BehaviorId b in Enum.GetValues(typeof(BehaviorId)))
        {
            list.Add(new { id = (int)b, name = b.ToString() });
        }
        return JsonSerializer.Serialize(list, J);
    }

    // Builder: simple level edits -------------------------------------------

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Level_SetTile(string sid, int x, int y, int tileTypeId)
    {
        var s = Sessions[sid].StateRef();
        var p = new V2(x, y);
        if (!s.Grid.InBounds(p)) return JsonSerializer.Serialize(new { ok = false, err = "out_of_bounds" }, J);

        var tt = (TileType)tileTypeId;
        var cell = s.Grid.CellRef(p);
        cell.Type = tt;
        ApplyRecipeToCell(ref cell, TileTraits.For(tt));
        cell.Toggled = false;
        s.Grid.CellRef(p) = cell;

        return JsonSerializer.Serialize(new { ok = true }, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Level_SpawnEntity(string sid, int typeId, int x, int y)
    {
        var s = Sessions[sid].StateRef();
        var p = new V2(x, y);
        if (!s.Grid.InBounds(p)) return JsonSerializer.Serialize(new { ok = false, err = "out_of_bounds" }, J);
        if (s.EntityAt.ContainsKey(p)) return JsonSerializer.Serialize(new { ok = false, err = "occupied" }, J);
        var e = EntityCatalog.Spawn(s, (EntityType)typeId, p);
        return JsonSerializer.Serialize(new { ok = true, id = e.Id }, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Level_RemoveEntityAt(string sid, int x, int y)
    {
        var s = Sessions[sid].StateRef();
        var p = new V2(x, y);
        if (!s.EntityAt.TryGetValue(p, out var id)) return JsonSerializer.Serialize(new { ok = false, err = "none" }, J);
        s.EntityAt.Remove(p);
        s.EntitiesById.Remove(id);
        if (s.AttachedEntityId == id) { s.AttachedEntityId = null; s.EntryDir = null; }
        return JsonSerializer.Serialize(new { ok = true, id }, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Level_SetEntityOrientation(string sid, int entityId, int orientation)
    {
        var s = Sessions[sid].StateRef();
        if (!s.EntitiesById.TryGetValue(entityId, out var e)) return JsonSerializer.Serialize(new { ok = false, err = "no_entity" }, J);
        e.Orientation = (Orientation)orientation;
        return JsonSerializer.Serialize(new { ok = true }, J);
    }

#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Level_SetPlayer(string sid, int x, int y)
    {
        var s = Sessions[sid].StateRef();
        var p = new V2(x, y);
        if (!s.Grid.InBounds(p)) return JsonSerializer.Serialize(new { ok = false, err = "out_of_bounds" }, J);
        s.PlayerPos = p;
        s.AttachedEntityId = null; s.EntryDir = null;
        return JsonSerializer.Serialize(new { ok = true }, J);
    }

    // Introspection helpers --------------------------------------------------

#if EXPOSE_WASM
    [JSExport]
#endif
    public static int State_TraitsAt(string sid, int x, int y)
    {
        var s = Sessions[sid].StateRef();
        return (int)TraitsUtil.ResolveEffectiveMask(s, new V2(x, y));
    }

    // Optional: Solver / ALD (Editor-only in this repo) ----------------------

#if UNITY_EDITOR
    // Run brute-force analyze with default caps or provided config JSON
    public static string Solver_Analyze(string levelJson, string configJson = null)
    {
        var s = Loader.FromJson(levelJson);
        var cfg = new SlimeGrid.Tools.Solver.SolverConfig();
        if (!string.IsNullOrWhiteSpace(configJson))
        {
            try { cfg = JsonSerializer.Deserialize<SlimeGrid.Tools.Solver.SolverConfig>(configJson, J) ?? cfg; } catch { }
        }
        var report = SlimeGrid.Tools.Solver.BruteForceSolver.Analyze(s, cfg);
        return Newtonsoft.Json.JsonConvert.SerializeObject(report);
    }

    // Apply a single ALD replace operator using default generator settings
    public static string ALD_TryMutate(string levelJson)
    {
        var dto = Newtonsoft.Json.JsonConvert.DeserializeObject<LevelDTO>(levelJson);
        var state = Loader.FromDTO(dto);
        var mask = SlimeGrid.Tools.ALD.InfluenceMask.Compute(state);
        var settings = SlimeGrid.Tools.ALD.Controller.DefaultSettings();
        bool ok = SlimeGrid.Tools.ALD.ReplaceOperator.TryApply(new System.Random(), settings, state, dto, mask, out var dtoOut);
        return Newtonsoft.Json.JsonConvert.SerializeObject(new { ok, level = dtoOut });
    }
#endif

    // DTOs -------------------------------------------------------------------

    private sealed class StepExDto
    {
        public bool moved { get; set; }
        public bool win { get; set; }
        public bool lose { get; set; }
        public List<object> deltas { get; set; } = new();
    }

    private sealed class DrawDto
    {
        public int w { get; set; }
        public int h { get; set; }
        public int[] tiles { get; set; } = Array.Empty<int>();
        public PlayerDto player { get; set; } = new();
        public List<EntityDto> entities { get; set; } = new();
    }

    private sealed class PlayerDto
    {
        public int x { get; set; }
        public int y { get; set; }
        public bool attached { get; set; }
        public int entryDir { get; set; }
    }

    private sealed class EntityDto
    {
        public int id { get; set; }
        public int type { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int rot { get; set; }
    }

    // Session ----------------------------------------------------------------

    private sealed class Session
    {
        public GameState StateRef() => _cur;
        private readonly GameState _start;
        private GameState _cur;
        private readonly Stack<GameState> _undo = new();

        public Session(GameState start)
        {
            _start = CloneState(start);
            _cur = CloneState(start);
        }

        public bool Undo()
        {
            if (_undo.Count == 0) return false;
            _cur = _undo.Pop();
            return true;
        }

        public void Reset()
        {
            _cur = CloneState(_start);
            _undo.Clear();
        }

        public DrawDto ToDto()
        {
            int w = _cur.Grid.W;
            int h = _cur.Grid.H;
            var tiles = new int[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    var p = new V2(x, y);
                    ref var cell = ref _cur.Grid.CellRef(p);
                    tiles[y * w + x] = (int)cell.Type;
                }

            var ents = new List<EntityDto>(_cur.EntitiesById.Count);
            foreach (var kv in _cur.EntitiesById)
            {
                var e = kv.Value;
                ents.Add(new EntityDto
                {
                    id = e.Id,
                    type = (int)e.Type,
                    x = e.Pos.x,
                    y = e.Pos.y,
                    rot = (int)e.Orientation
                });
            }

            return new DrawDto
            {
                w = w,
                h = h,
                tiles = tiles,
                player = new PlayerDto
                {
                    x = _cur.PlayerPos.x,
                    y = _cur.PlayerPos.y,
                    attached = _cur.AttachedEntityId != null,
                    entryDir = _cur.EntryDir.HasValue ? (int)_cur.EntryDir.Value : -1
                },
                entities = ents
            };
        }
    }

    // Helpers ----------------------------------------------------------------

    private static bool ShallowEqual(GameState a, GameState b)
    {
        if (a.PlayerPos.x != b.PlayerPos.x || a.PlayerPos.y != b.PlayerPos.y) return false;
        if (a.EntryDir != b.EntryDir) return false;
        if ((a.AttachedEntityId ?? -1) != (b.AttachedEntityId ?? -1)) return false;
        if (a.AnyButtonPressed != b.AnyButtonPressed) return false;
        if (a.Win != b.Win || a.GameOver != b.GameOver) return false;
        if (a.EntitiesById.Count != b.EntitiesById.Count) return false;
        foreach (var kv in a.EntitiesById)
        {
            var id = kv.Key;
            if (!b.EntitiesById.TryGetValue(id, out var be)) return false;
            var ae = kv.Value;
            if (ae.Pos.x != be.Pos.x || ae.Pos.y != be.Pos.y) return false;
            if (ae.Orientation != be.Orientation) return false;
            if (ae.Type != be.Type) return false;
        }
        return true;
    }

    private static GameState CloneState(GameState s)
    {
        var c = new GameState
        {
            Grid = s.Grid,
            PlayerPos = s.PlayerPos,
            AttachedEntityId = s.AttachedEntityId,
            EntryDir = s.EntryDir,
            LastMoveDir = s.LastMoveDir,
            AnyButtonPressed = s.AnyButtonPressed,
            LastAnyButtonPressed = s.LastAnyButtonPressed,
            GameOver = s.GameOver,
            Win = s.Win,
        };
        foreach (var kv in s.EntitiesById)
        {
            var e = kv.Value;
            var ne = new Entity
            {
                Id = e.Id,
                Type = e.Type,
                Pos = e.Pos,
                Traits = e.Traits,
                Orientation = e.Orientation,
                Behavior = e.Behavior
            };
            c.EntitiesById[ne.Id] = ne;
        }
        foreach (var kv in s.EntityAt) c.EntityAt[kv.Key] = kv.Value;
        return c;
    }

    private static void ApplyRecipeToCell(ref Cell cell, TT recipe)
    {
        cell.ActiveMask = recipe.Active;
        cell.InactiveMask = recipe.Inactive;
        cell.ToggleMask = cell.InactiveMask.HasValue ? (cell.ActiveMask ^ cell.InactiveMask.Value) : 0;
        if (cell.InactiveMask.HasValue)
        {
            var cond = (cell.ActiveMask & (Traits.ToggleableByButton | Traits.ToggleableByEntity | Traits.ToggleableByPlayer));
            cell.InactiveMask = cell.InactiveMask.Value | cond;
            cell.ToggleMask = cell.ActiveMask ^ cell.InactiveMask.Value;
        }
    }

    private static List<object> MapDeltas(List<Delta> deltas)
    {
        var list = new List<object>(deltas.Count);
        foreach (var d in deltas)
        {
            switch (d)
            {
                case AttemptAction a:
                    list.Add(new { k = "Attempt", actor = a.Actor.ToString(), verb = a.Verb.ToString(), dir = a.Dir.ToString(), entityId = a.EntityId });
                    break;
                case Blocked b:
                    list.Add(new { k = "Blocked", actor = b.Actor.ToString(), verb = b.Verb.ToString(), dir = b.Dir.ToString(), at = new { x = b.At.x, y = b.At.y }, reason = b.Reason.ToString() });
                    break;
                case MoveStraight ms:
                    list.Add(new { k = "MoveStraight", id = ms.Id, from = new { x = ms.From.x, y = ms.From.y }, to = new { x = ms.To.x, y = ms.To.y }, dir = ms.Dir.ToString(), tiles = ms.Tiles, kind = ms.Kind });
                    break;
                case MoveEntity me:
                    list.Add(new { k = "MoveEntity", id = me.Id, from = new { x = me.From.x, y = me.From.y }, to = new { x = me.To.x, y = me.To.y }, kind = me.Kind });
                    break;
                case DestroyEntity de:
                    list.Add(new { k = "DestroyEntity", id = de.Id, at = new { x = de.At.x, y = de.At.y }, kind = de.Kind });
                    break;
                case SetAttachment sa:
                    list.Add(new { k = "SetAttachment", entityId = sa.EntityId, entryDir = sa.EntryDir.HasValue ? sa.EntryDir.Value.ToString() : null });
                    break;
                case SetGameOver:
                    list.Add(new { k = "SetGameOver" });
                    break;
                case SetWin:
                    list.Add(new { k = "SetWin" });
                    break;
                case ButtonStateChanged bc:
                    list.Add(new { k = "ButtonStateChanged", anyPressed = bc.AnyPressed });
                    break;
                case AnimationCue ac:
                    list.Add(new { k = "AnimationCue", cue = ac.Type.ToString(), at = ac.At.HasValue ? new { x = ac.At.Value.x, y = ac.At.Value.y } : null, intensity = ac.Intensity });
                    break;
            }
        }
        return list;
    }
#if EXPOSE_WASM
    [JSExport]
#endif
    public static string Level_ApplyEdit(string sid, int kind, int x, int y, int type, int rot)
    {
        var s = Sessions[sid].StateRef();
        string err;
        bool ok = SlimeGrid.Logic.EditOps.Apply(s, kind, x, y, type, rot, out err);
        return System.Text.Json.JsonSerializer.Serialize(new { ok, err }, J);
    }
}

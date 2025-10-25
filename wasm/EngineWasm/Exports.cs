using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using SlimeGrid.Logic;

public partial class Exports
{
    public static void Main() { }

    private static readonly Dictionary<string, Session> Sessions = new();

    // ---------- JS API ----------

    [JSExport]
    public static string Engine_Init(string levelJson)
    {
        var start = Loader.FromJson(levelJson);
        var id = Guid.NewGuid().ToString("N");
        Sessions[id] = new Session(start);
        return id;
    }

    [JSExport]
    public static string Engine_GetState(string sid)
        => JsonSerializer.Serialize(Sessions[sid].ToDto());

    // dir: 0=N, 1=E, 2=S, 3=W
    [JSExport]
    public static string Engine_Step(string sid, int dir)
    {
        var s = Sessions[sid];
        var moved = s.Step((Dir)dir, out bool win, out bool lose);
        return JsonSerializer.Serialize(new StepDto { moved = moved, win = win, lose = lose });
    }

    [JSExport] public static bool Engine_Undo(string sid) => Sessions[sid].Undo();
    [JSExport] public static void Engine_Reset(string sid) => Sessions[sid].Reset();

    // ---------- DTOs (properties so System.Text.Json serializes them) ----------

    private sealed class StepDto
    {
        public bool moved { get; set; }
        public bool win { get; set; }
        public bool lose { get; set; }
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
        public int type { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int rot { get; set; }
    }

    // ---------- Session ----------

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

        public bool Step(Dir d, out bool win, out bool lose)
        {
            win = false; lose = false;

            // Take a snapshot for undo
            var before = CloneState(_cur);

            // Run one input; Engine mutates _cur and returns deltas/flags
            var res = Engine.Step(_cur, d);

            win = res.Win;
            lose = res.GameOver;

            // Robust "did anything actually change?"
            bool changed = !ShallowEqual(before, _cur);

            // Record undo if something changed OR we hit a terminal flag
            if (changed || win || lose)
                _undo.Push(before);

            return changed;
        }

        private static bool ShallowEqual(GameState a, GameState b)
        {
            if (a.PlayerPos.x != b.PlayerPos.x || a.PlayerPos.y != b.PlayerPos.y) return false;
            if (a.EntryDir != b.EntryDir) return false;
            if ((a.AttachedEntityId ?? -1) != (b.AttachedEntityId ?? -1)) return false;
            if (a.AnyButtonPressed != b.AnyButtonPressed) return false;
            if (a.Win != b.Win || a.GameOver != b.GameOver) return false;

            if (a.EntitiesById.Count != b.EntitiesById.Count) return false;

            // assume same keys; compare per-entity position & orientation
            foreach (var kv in a.EntitiesById)
            {
                var id = kv.Key;
                if (!b.EntitiesById.TryGetValue(id, out var be)) return false;

                var ae = kv.Value;
                if (ae.Pos.x != be.Pos.x || ae.Pos.y != be.Pos.y) return false;
                if (ae.Orientation != be.Orientation) return false;
                if (ae.Type != be.Type) return false; // types should match
            }

            return true;
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

            // basic tile mapping; expand as needed
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    var p = new V2(x, y);
                    ref var cell = ref _cur.Grid.CellRef(p);
                    tiles[y * w + x] = cell.Type switch
                    {
                        TileType.Wall => 1,
                        TileType.Hole => 2,
                        TileType.Exit => 3,
                        _ => 0
                    };
                }

            var ents = new List<EntityDto>(_cur.EntitiesById.Count);
            foreach (var kv in _cur.EntitiesById)
            {
                var e = kv.Value;
                ents.Add(new EntityDto
                {
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
                entities = ents ?? new List<EntityDto>(0)
            };
        }
    }

    // ---------- local clone (no DeepClone() in your model) ----------
    private static GameState CloneState(GameState s)
    {
        var c = new GameState
        {
            Grid = s.Grid, // grid is immutable per level; safe to share
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
        foreach (var kv in s.EntityAt)
            c.EntityAt[kv.Key] = kv.Value;

        return c;
    }
    // ---------- Builder: Palette ----------
    [JSExport]
    public static string Catalog_GetTiles()
    {
        var list = new List<object>();
        foreach (TileType tt in System.Enum.GetValues(typeof(TileType)))
        {
            // skip "None" if you have it
            if ((int)tt == 0) continue;
            list.Add(new { id = (int)tt, name = tt.ToString() });
        }
        return JsonSerializer.Serialize(list);
    }

    [JSExport]
    public static string Catalog_GetEntities()
    {
        var list = new List<object>();
        foreach (EntityType et in System.Enum.GetValues(typeof(EntityType)))
        {
            // include the ones you want initially
            if (et == EntityType.PlayerSpawn || et == EntityType.BoxBasic)
                list.Add(new { id = (int)et, name = et.ToString() });
        }
        return JsonSerializer.Serialize(list);
    }

    // ---------- Builder: Apply edits ----------
    // kind: 0=tile-set, 1=entity-place, 2=entity-remove, 3=entity-rotate
    [JSExport]
    public static string Level_ApplyEdit(string sid, int kind, int x, int y, int type, int rot)
    {
        var s = Sessions[sid].StateRef(); // add a small helper to Session (below)
        string err = "";
        bool ok = EditOps.Apply(s, kind, x, y, type, rot, out err);
        return JsonSerializer.Serialize(new { ok, err });
    }

}

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

            var before = CloneState(_cur);    // snapshot for undo
            var res = Engine.Step(_cur, d);   // mutates _cur

            // AttemptAction is always added; if >1 delta, something meaningful happened.
            bool moved = res.Deltas != null && res.Deltas.Count > 1;

            win = res.Win;
            lose = res.GameOver;

            if (moved || win || lose)
                _undo.Push(before);

            return moved;
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
}

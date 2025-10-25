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
        var id = System.Guid.NewGuid().ToString("N");
        Sessions[id] = new Session(start);
        return id;
    }

    [JSExport]
    public static string Engine_GetState(string sid)
    {
        return JsonSerializer.Serialize(Sessions[sid].ToDto());
    }

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

    // ---------- DTOs ----------

    private sealed class StepDto { public bool moved; public bool win; public bool lose; }

    private sealed class DrawDto
    {
        public int w, h;
        public int[] tiles = default!;          // 0=floor,1=wall,2=hole,3=exit (add more if you like)
        public PlayerDto player = default!;
        public List<EntityDto> entities = default!;
    }
    private sealed class PlayerDto { public int x, y; public bool attached; public int entryDir; }
    private sealed class EntityDto { public int type; public int x, y; public int rot; }

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

            var before = CloneState(_cur);         // snapshot for undo
            var res = Engine.Step(_cur, d);        // mutates _cur

            // Heuristic: AttemptAction is always added; if we have >1 delta, something happened.
            bool moved = res.Deltas != null && res.Deltas.Count > 1;

            win = res.Win;
            lose = res.GameOver;

            // Record undo only if meaningful (or terminal)
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

            // very simple tile mapping for now; expand as needed
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
                entities = ents
            };
        }
    }

    // ---------- local clone (no DeepClone() in your model) ----------
    // Adapted from your solver’s BruteForceSolverReplay.CloneState
    private static GameState CloneState(GameState s)
    {
        var c = new GameState
        {
            Grid = s.Grid, // grid is immutable recipe per level; safe to share
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

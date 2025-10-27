using System.Collections.Generic;
using SlimeGrid.Logic;

namespace SlimeGrid.Tools.ALD
{
    public static class InfluenceMask
    {
        // Returns a bool[W,H] of flood cells (non-wall) plus their 4-neighbor walls as true.
        public static bool[,] Compute(GameState s)
        {
            var W = s.Grid.W; var H = s.Grid.H;
            var flood = new bool[W, H];
            var mask = new bool[W, H];
            var q = new Queue<V2>();
            if (!s.Grid.InBounds(s.PlayerPos)) return mask;
            q.Enqueue(s.PlayerPos); flood[s.PlayerPos.x, s.PlayerPos.y] = true;

            while (q.Count > 0)
            {
                var p = q.Dequeue();
                foreach (var d in new[] { Dir.N, Dir.E, Dir.S, Dir.W })
                {
                    var v = d.Vec(); var np = new V2(p.x + v.dx, p.y + v.dy);
                    if (!s.Grid.InBounds(np)) continue;
                    if (flood[np.x, np.y]) continue;
                    var cell = s.Grid.CellRef(np);
                    if (cell.Type == TileType.Wall) continue; // walls are boundaries
                    flood[np.x, np.y] = true; q.Enqueue(np);
                }
            }

            // Influence = flood + their adjacent walls (4-neighbor)
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    if (flood[x, y]) { mask[x, y] = true; continue; }
                    // If a neighbor flood cell exists and this is a wall, include
                    var p = new V2(x, y);
                    if (s.Grid.CellRef(p).Type != TileType.Wall) continue;
                    if ((x > 0 && flood[x - 1, y]) || (x < W - 1 && flood[x + 1, y]) ||
                        (y > 0 && flood[x, y - 1]) || (y < H - 1 && flood[x, y + 1]))
                        mask[x, y] = true;
                }

            return mask;
        }

        public static string ReachableSignature(GameState s, bool[,] mask)
        {
            unchecked
            {
                ulong h = 1469598103934665603UL;
                for (int y = 0; y < s.Grid.H; y++)
                    for (int x = 0; x < s.Grid.W; x++)
                    {
                        if (!mask[x, y]) continue;
                        var p = new V2(x, y);
                        var c = s.Grid.CellRef(p);
                        h ^= (ulong)c.Type; h *= 1099511628211UL;
                        if (s.EntityAt.TryGetValue(p, out var id))
                        {
                            var e = s.EntitiesById[id];
                            h ^= ((ulong)e.Type << 8) ^ (ulong)(byte)e.Orientation; h *= 1099511628211UL;
                        }
                    }
                // include player pos
                h ^= (ulong)(uint)s.PlayerPos.x; h *= 1099511628211UL;
                h ^= (ulong)(uint)s.PlayerPos.y; h *= 1099511628211UL;
                return h.ToString("X16");
            }
        }
    }
}

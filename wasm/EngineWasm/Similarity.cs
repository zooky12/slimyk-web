#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using SlimeGrid.Logic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    public static class Similarity
    {
        // Solution similarity: editDistance / maxLen
        public static float SolutionSimilarity(PackedMoves a, PackedMoves b)
        {
            int n = a.Length, m = b.Length;
            if (n == 0 && m == 0) return 0f;
            int dist = EditDistance(a, b);
            return (float)dist / Math.Max(n, m);
        }

        static int EditDistance(PackedMoves a, PackedMoves b)
        {
            int n = a.Length, m = b.Length;
            var dp = new int[n + 1, m + 1];
            for (int i = 0; i <= n; i++) dp[i, 0] = i;
            for (int j = 0; j <= m; j++) dp[0, j] = j;
            for (int i = 1; i <= n; i++)
            {
                for (int j = 1; j <= m; j++)
                {
                    int cost = a.GetAt(i - 1) == b.GetAt(j - 1) ? 0 : 1;
                    int del = dp[i - 1, j] + 1;
                    int ins = dp[i, j - 1] + 1;
                    int sub = dp[i - 1, j - 1] + cost;
                    int v = del < ins ? del : ins; if (sub < v) v = sub;
                    dp[i, j] = v;
                }
            }
            return dp[n, m];
        }

        // Layout similarity over influence mask
        public static float LayoutSimilarity(GameState a, GameState b, bool[,] mask, int spatialHashSize, float wTiles, float wEntities, float wSpatial)
        {
            var histA = TileTraitHistogram(a, mask);
            var histB = TileTraitHistogram(b, mask);
            float dTiles = TotalVariation(histA, histB);

            var entA = EntitySpectrum(a, mask);
            var entB = EntitySpectrum(b, mask);
            float dEnt = TotalVariation(entA, entB);

            var spA = SpatialHash(a, mask, spatialHashSize);
            var spB = SpatialHash(b, mask, spatialHashSize);
            float dSp = Hamming(spA, spB);

            return wTiles * dTiles + wEntities * dEnt + wSpatial * dSp;
        }

        static Dictionary<string, int> TileTraitHistogram(GameState s, bool[,] mask)
        {
            var d = new Dictionary<string, int>(32);
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    if (!mask[x, y]) continue;
                    var m = s.Grid.CellRef(new V2(x, y)).ActiveMask; // authored traits
                    Acc(d, "W", (m & Traits.StopsPlayer) != 0);
                    Acc(d, "SE", (m & Traits.StopsEntity) != 0);
                    Acc(d, "SF", (m & Traits.StopsFlight) != 0);
                    Acc(d, "ST", (m & Traits.StopsTumble) != 0);
                    Acc(d, "HO", (m & Traits.HoleForPlayer) != 0 || (m & Traits.HoleForEntity) != 0);
                    Acc(d, "SL", (m & Traits.Slipery) != 0);
                    Acc(d, "EX", (m & Traits.ExitPlayer) != 0);
                    Acc(d, "BT", (m & Traits.ButtonToggle) != 0);
                    Acc(d, "BA", (m & Traits.ButtonAllowExit) != 0);
                }
            return d;
        }

        static Dictionary<string, int> EntitySpectrum(GameState s, bool[,] mask)
        {
            var d = new Dictionary<string, int>(32);
            foreach (var kv in s.EntitiesById)
            {
                var e = kv.Value;
                var p = e.Pos;
                if (!s.Grid.InBounds(p)) continue;
                if (!mask[p.x, p.y]) continue;
                string key = e.Type.ToString() + ":" + e.Orientation.ToString();
                if (!d.TryGetValue(key, out var c)) d[key] = 1; else d[key] = c + 1;
            }
            return d;
        }

        static float TotalVariation(Dictionary<string, int> A, Dictionary<string, int> B)
        {
            float sumA = 0, sumB = 0; foreach (var v in A.Values) sumA += v; foreach (var v in B.Values) sumB += v;
            if (sumA == 0 && sumB == 0) return 0f;
            var keys = new HashSet<string>(A.Keys); foreach (var k in B.Keys) keys.Add(k);
            float tv = 0f;
            foreach (var k in keys)
            {
                float pa = A.TryGetValue(k, out var ca) ? (ca / sumA) : 0f;
                float pb = B.TryGetValue(k, out var cb) ? (cb / sumB) : 0f;
                tv += Math.Abs(pa - pb);
            }
            return 0.5f * tv;
        }

        static byte[,] SpatialHash(GameState s, bool[,] mask, int N)
        {
            int W = s.Grid.W, H = s.Grid.H;
            var bins = new byte[N, N];
            var count = new int[N, N];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    if (!mask[x, y]) continue;
                    int bx = x * N / W; int by = y * N / H;
                    var t = s.Grid.CellRef(new V2(x, y)).Type;
                    byte code = (byte)(t == TileType.Wall ? 1 : t == TileType.Hole ? 2 : t == TileType.Exit ? 3 : 4);
                    if (s.EntityAt.ContainsKey(new V2(x, y))) code = (byte)(10 + code);
                    bins[bx, by] ^= code; // lightweight mixing
                    count[bx, by]++;
                }
            return bins;
        }

        static float Hamming(byte[,] A, byte[,] B)
        {
            int N = A.GetLength(0);
            int diff = 0, tot = N * N;
            for (int y = 0; y < N; y++)
                for (int x = 0; x < N; x++)
                    if (A[x, y] != B[x, y]) diff++;
            return (float)diff / tot;
        }

        static void Acc(Dictionary<string, int> d, string k, bool on)
        { if (!on) return; if (!d.TryGetValue(k, out var c)) d[k] = 1; else d[k] = c + 1; }
    }
}
#endif


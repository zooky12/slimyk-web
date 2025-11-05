using System;
using System.Collections.Generic;
using SlimeGrid.Tools.Solver;
using SlimeGrid.Logic;

namespace SlimeGrid.Tools.ALD
{
    public sealed class Bucket
    {
        public readonly BucketConfig Config;
        // Min-heap by normalizedScore
        private readonly List<LevelCandidate> heap = new();

        public Bucket(BucketConfig cfg) { Config = cfg; }

        public IReadOnlyList<LevelCandidate> Items => heap;

        public bool TryInsert(LevelCandidate cand)
        {
            // Prune near-duplicates that only differ by player position and trivial path length change
            if (PruneByPlayerOnlyDifference(cand, out bool rejectCand))
            {
                if (rejectCand) return false; // worse than existing; do not insert
            }
            // If topK <= 0, treat as unlimited capacity
            if (Config.topK <= 0)
            {
                heap.Add(cand); HeapUp(heap.Count - 1); return true;
            }
            if (heap.Count < Config.topK)
            {
                heap.Add(cand); HeapUp(heap.Count - 1); return true;
            }
            if (heap.Count > 0 && cand.normalizedScore > heap[0].normalizedScore)
            {
                heap[0] = cand; HeapDown(0); return true;
            }
            return false;
        }

        bool PruneByPlayerOnlyDifference(LevelCandidate cand, out bool rejectCand)
        {
            rejectCand = false;
            // Helper: extract PlayerSpawn positions; and compare layout ignoring player
            static (int x, int y)? FindPlayer(LevelDTO d)
            {
                foreach (var e in d.entities ?? new System.Collections.Generic.List<SlimeGrid.Logic.EntityDTO>())
                    if (e != null && e.type == SlimeGrid.Logic.EntityType.PlayerSpawn) return (e.x, e.y);
                return null;
            }
            bool SameTiles(LevelDTO a, LevelDTO b)
            {
                var ga = a.tileGrid; var gb = b.tileGrid;
                if (ga == null || gb == null) return false;
                if (ga.Length != gb.Length) return false;
                for (int y = 0; y < ga.Length; y++)
                {
                    var ra = ga[y]; var rb = gb[y]; if (ra == null || rb == null) return false; if (ra.Length != rb.Length) return false;
                    for (int x = 0; x < ra.Length; x++) if (!string.Equals(ra[x], rb[x], System.StringComparison.OrdinalIgnoreCase)) return false;
                }
                return true;
            }
            bool SameEntitiesIgnoringPlayer(LevelDTO a, LevelDTO b)
            {
                var la = new System.Collections.Generic.List<SlimeGrid.Logic.EntityDTO>(a.entities ?? new System.Collections.Generic.List<SlimeGrid.Logic.EntityDTO>());
                var lb = new System.Collections.Generic.List<SlimeGrid.Logic.EntityDTO>(b.entities ?? new System.Collections.Generic.List<SlimeGrid.Logic.EntityDTO>());
                la.RemoveAll(e => e == null || e.type == SlimeGrid.Logic.EntityType.PlayerSpawn);
                lb.RemoveAll(e => e == null || e.type == SlimeGrid.Logic.EntityType.PlayerSpawn);
                if (la.Count != lb.Count) return false;
                // simple multiset compare of (type,x,y)
                var ma = new System.Collections.Generic.Dictionary<string,int>(System.StringComparer.Ordinal);
                foreach (var e in la) { var k = $"{e.type}:{e.x}:{e.y}"; ma.TryGetValue(k, out var c); ma[k]=c+1; }
                foreach (var e in lb) { var k = $"{e.type}:{e.x}:{e.y}"; if (!ma.TryGetValue(k,out var c) || c==0) return false; ma[k]=c-1; }
                foreach (var kv in ma) if (kv.Value != 0) return false;
                return true;
            }

            int bestIdx = -1; bool preferCand = false;
            for (int i = 0; i < heap.Count; i++)
            {
                var it = heap[i];
                if (!SameTiles(it.dto, cand.dto)) continue;
                if (!SameEntitiesIgnoringPlayer(it.dto, cand.dto)) continue;
                var pa = FindPlayer(it.dto); var pb = FindPlayer(cand.dto);
                if (!pa.HasValue || !pb.HasValue) continue;
                int md = System.Math.Abs(pa.Value.x - pb.Value.x) + System.Math.Abs(pa.Value.y - pb.Value.y);
                float lenA = it.features != null && it.features.TryGetValue("solutionLength", out var va) ? va : (it.report?.topSolutions?.Count > 0 ? it.report.topSolutions[0].length : 0);
                float lenB = cand.features != null && cand.features.TryGetValue("solutionLength", out var vb) ? vb : (cand.report?.topSolutions?.Count > 0 ? cand.report.topSolutions[0].length : 0);
                if (System.Math.Abs(lenA - lenB) <= md)
                {
                    bestIdx = i;
                    preferCand = lenB > lenA;
                    break;
                }
            }
            if (bestIdx >= 0)
            {
                if (preferCand)
                {
                    // remove existing inferior and allow insert
                    RemoveAt(bestIdx);
                    return false; // continue normal insert
                }
                else
                {
                    // reject candidate
                    rejectCand = true; return true;
                }
            }
            return false;
        }

        void RemoveAt(int idx)
        {
            int n = heap.Count; if (idx < 0 || idx >= n) return;
            int last = n - 1;
            heap[idx] = heap[last]; heap.RemoveAt(last);
            if (idx < heap.Count) { HeapDown(idx); HeapUp(idx); }
        }

        public bool PassSimilarity(LevelCandidate cand, DedupeSettings global)
        {
            // First gate: solution similarity vs each kept (global thresholds)
            foreach (var item in heap)
            {
                var A = item.report.topSolutions.Count > 0 ? Unpack(item.report.topSolutions[0]) : default;
                var B = cand.report.topSolutions.Count > 0 ? Unpack(cand.report.topSolutions[0]) : default;
                float solSim = Similarity.SolutionSimilarity(A, B);
                if (solSim > (float)(global?.T_sol ?? Config.T_sol)) continue; // keep both, don't test layout

                // Otherwise test layout similarity on full mask with global weights
                var levelA = SlimeGrid.Logic.Loader.FromDTO(item.dto);
                var levelB = SlimeGrid.Logic.Loader.FromDTO(cand.dto);
                int N = 8;
                var maskAll = new bool[levelA.Grid.W, levelA.Grid.H];
                for (int y = 0; y < levelA.Grid.H; y++) for (int x = 0; x < levelA.Grid.W; x++) maskAll[x, y] = true;
                float wT = global != null ? global.w_tiles : Config.w_tiles;
                float wE = global != null ? global.w_entities : Config.w_entities;
                float wS = global != null ? global.w_spatial : Config.w_spatial;
                float lay = Similarity.LayoutSimilarity(levelA, levelB, maskAll, N, wT, wE, wS);
                if (lay <= (float)(global?.T_layout ?? Config.T_layout))
                {
                    // Too similar – keep higher-scoring
                    return cand.normalizedScore > item.normalizedScore;
                }
            }
            return true;
        }

        static SlimeGrid.Tools.Solver.PackedMoves Unpack(SolutionEntry e)
        {
            return new SlimeGrid.Tools.Solver.PackedMoves { Buffer = e.movesPacked, Length = e.length };
        }

        void HeapUp(int i)
        {
            while (i > 0)
            {
                int p = (i - 1) >> 1;
                if (heap[i].normalizedScore >= heap[p].normalizedScore) break;
                (heap[i], heap[p]) = (heap[p], heap[i]);
                i = p;
            }
        }
        void HeapDown(int i)
        {
            int n = heap.Count;
            while (true)
            {
                int l = i * 2 + 1, r = l + 1, s = i;
                if (l < n && heap[l].normalizedScore < heap[s].normalizedScore) s = l;
                if (r < n && heap[r].normalizedScore < heap[s].normalizedScore) s = r;
                if (s == i) break;
                (heap[i], heap[s]) = (heap[s], heap[i]);
                i = s;
            }
        }
    }
}

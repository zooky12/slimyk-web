using System;
using System.Collections.Generic;
using SlimeGrid.Tools.Solver;

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

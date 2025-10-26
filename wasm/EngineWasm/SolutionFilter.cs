#if UNITY_EDITOR
using System;
using System.Collections.Generic;

namespace SlimeGrid.Tools.Solver
{
    public static class SolutionFilter
    {
        // Greedy shortest→longest: keep shorter representative when similar.
        // Drop candidate A if there exists kept B with lenDiff <= 3 and editDistance <= 3.
        public static List<PackedMoves> FilterSimilar(IReadOnlyList<PackedMoves> solutions)
        {
            var list = new List<PackedMoves>(solutions);
            list.Sort((a, b) => a.Length.CompareTo(b.Length)); // shortest first

            var kept = new List<PackedMoves>(Math.Min(10, list.Count));
            for (int i = 0; i < list.Count; i++)
            {
                var cand = list[i];
                bool drop = false;
                for (int k = 0; k < kept.Count; k++)
                {
                    var s = kept[k];
                    int lenDiff = Math.Abs(cand.Length - s.Length);
                    if (lenDiff <= 3 && PackedMoves.EditDistanceLeq(cand, s, 3))
                    {
                        drop = true; break;
                    }
                }
                if (!drop) kept.Add(cand);
            }
            // Return at most 10 shortest kept
            kept.Sort((a, b) => a.Length.CompareTo(b.Length));
            if (kept.Count > 10) kept.RemoveRange(10, kept.Count - 10);
            return kept;
        }
    }
}
#endif


#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    public static class Heuristics
    {
        public static Dictionary<string, float> ComputeFeatures(SolverReport report)
        {
            var f = new Dictionary<string, float>();
            f["solutionLength"] = report.topSolutions.Count > 0 ? report.topSolutions[0].length : 0;
            f["solutionsFilteredCount"] = report.solutionsFilteredCount;
            f["solutionsTotalCount"] = report.solutionsTotalCount;
            f["deadEndsCount"] = report.deadEndsCount;
            f["deadEndsNearTop1Count"] = report.deadEndsNearTop1Count;
            f["deadEndsNearTop3Count"] = report.deadEndsNearTop3Count;
            f["precheck.hasExitInComponent"] = report.solvedTag == "false" && report.nodesExplored == 0 ? 0 : 1;
            f["capped"] = report.solvedTag == "capped" ? 1 : 0;
            return f;
        }

        public static (float raw, bool reject) Score(BucketConfig bucket, Dictionary<string, float> features, float acceptCappedWeight)
        {
            float raw = 0f; bool reject = false;
            foreach (var fc in bucket.features)
            {
                float val = features.TryGetValue(fc.id, out var v) ? v : 0f;
                float s = 0f;
                if (fc.mode == FeatureMode.Band)
                {
                    if (val >= fc.bandMin && val <= fc.bandMax) s = 1f; else
                    {
                        float d = val < fc.bandMin ? (fc.bandMin - val) : (val - fc.bandMax);
                        s = Math.Max(0f, 1f - d / Math.Max(1f, fc.bandMax - fc.bandMin));
                    }
                }
                else // Infinite (monotonic increasing) – simple identity for now
                {
                    s = val;
                }
                if (fc.hard && s <= 0f) { reject = true; break; }
                raw += fc.weight * s;
            }
            // If capped, weight down
            if (features.TryGetValue("capped", out var capped) && capped > 0.5f)
                raw *= acceptCappedWeight;
            return (raw, reject);
        }
    }
}
#endif


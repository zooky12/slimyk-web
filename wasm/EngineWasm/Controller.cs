using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using SlimeGrid.Logic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    public static class Controller
    {
        public static GeneratorSettings DefaultSettings()
        {
            var gs = new GeneratorSettings();
            gs.buckets.Add(new BucketConfig
            {
                name = "TrapRich_MidLength",
                topK = 20,
                features = new List<FeatureConfig>
                {
                    new FeatureConfig{ id = "solutionLength", mode=FeatureMode.Band, bandMin=12, bandMax=20, weight=1.0f },
                    new FeatureConfig{ id = "solutionsFilteredCount", mode=FeatureMode.Band, bandMin=1, bandMax=1, weight=1.5f },
                    new FeatureConfig{ id = "deadEndsCount", mode=FeatureMode.Band, bandMin=6, bandMax=12, weight=1.0f },
                    new FeatureConfig{ id = "deadEndsNearTop1Count", mode=FeatureMode.Band, bandMin=2, bandMax=5, weight=1.2f },
                    new FeatureConfig{ id = "minSolutionLength", mode=FeatureMode.Band, bandMin=10, bandMax=999, weight=0f, hard=true },
                }
            });
            return gs;
        }

        public static void RunOnceFromDTO(LevelDTO seedDto, GeneratorSettings settings, int candidatesToTry = 20)
        {
            var seed = Loader.FromDTO(seedDto);
            var mask = InfluenceMask.Compute(seed);
            var seedSig = InfluenceMask.ReachableSignature(seed, mask);

            var buckets = settings.buckets.Select(b => new Bucket(b)).ToList();
            var seen = new HashSet<string> { seedSig };
            var rng = new Random();

            // Evaluate seed
            var seedReport = BruteForceSolver.Analyze(seed, new SolverConfig());
            var seedCand = new LevelCandidate { dto = seedDto, reachableHash = seedSig, report = seedReport };
            seedCand.features = Heuristics.ComputeFeatures(seedReport);
            foreach (var b in buckets)
            {
                var (raw, reject) = Heuristics.Score(b.Config, seedCand.features, settings.accept_capped_weight);
                seedCand.rawScore = raw; seedCand.normalizedScore = raw; // first insert; min/max not tracked yet
                if (!reject && b.PassSimilarity(seedCand, new DedupeSettings())) b.TryInsert(seedCand);
            }

            var cfg = new SolverConfig();
            var bag = new ConcurrentBag<LevelCandidate>();

            Parallel.For(0, candidatesToTry, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, settings.parallelism) }, i =>
            {
                // Each candidate derived from latest seed state (for demo simplicity)
                var state = Loader.FromDTO(seedCand.dto);
                var infMask = InfluenceMask.Compute(state);
                if (!ReplaceOperator.TryApply(new Random(rng.Next()), settings, state, seedCand.dto, infMask, out var dtoOut)) return;
                var mutated = Loader.FromDTO(dtoOut);
                var sig = InfluenceMask.ReachableSignature(mutated, infMask);
                if (!seen.Add(sig)) return;

                var report = BruteForceSolver.Analyze(mutated, cfg);
                var cand = new LevelCandidate { dto = dtoOut, reachableHash = sig, report = report };
                cand.features = Heuristics.ComputeFeatures(report);
                bag.Add(cand);
            });

            // Compute normalization per bucket and insert
            foreach (var b in buckets)
            {
                // compute raw scores
                var scored = new List<LevelCandidate>();
                foreach (var cand in bag)
                {
                    var (raw, reject) = Heuristics.Score(b.Config, cand.features, settings.accept_capped_weight);
                    if (reject) continue;
                    cand.rawScore = raw;
                    scored.Add(cand);
                }
                if (scored.Count == 0) continue;
                float min = scored.Min(c => c.rawScore);
                float max = scored.Max(c => c.rawScore);
                foreach (var c in scored)
                {
                    c.normalizedScore = Normalize(c.rawScore, min, max);
                    if (b.PassSimilarity(c, new DedupeSettings())) b.TryInsert(c);
                }
            }
        }

        static float Normalize(float raw, float min, float max)
        {
            if (max <= min + 1e-5f) return 0f;
            float t = (raw - min) / (max - min);
            return Math.Max(-1f, Math.Min(1f, 2f * t - 1f));
        }
    }
}

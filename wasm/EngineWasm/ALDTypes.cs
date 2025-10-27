using System;
using System.Collections.Generic;
using SlimeGrid.Logic;

namespace SlimeGrid.Tools.ALD
{
    // Feature modes
    public enum FeatureMode { Band, Infinite }

    // A single scoring feature config
    [Serializable]
    public sealed class FeatureConfig
    {
        public string id;
        public FeatureMode mode = FeatureMode.Band;
        public float bandMin = 0f;
        public float bandMax = 0f;
        public float weight = 1f;
        public bool hard = false; // if true, failing rejects candidate
    }

    [Serializable]
    public sealed class BucketConfig
    {
        public string name = "Default";
        public int topK = 20;
        public List<FeatureConfig> features = new();
        public float T_sol = 0.12f;     // solution similarity gate
        public float T_layout = 0.25f;  // layout similarity gate
        public float w_tiles = 0.4f, w_entities = 0.4f, w_spatial = 0.2f;
    }

    [Serializable]
    public sealed class GeneratorSettings
    {
        public int topKDefault = 20;
        public float strategy_mix = 0.7f; // beam vs anneal mix
        public float mix_ga = 0.03f;      // rare GA
        public float p_reachableFocus = 0.9f;
        public float similarity_bias = 0.7f;
        public float accept_capped_weight = 0.8f;
        public float p_ignoreExitRule = 0.1f;
        public int spatialHashSize = 8;
        public int parallelism = 4;
        public List<BucketConfig> buckets = new();
    }

    // Derived feature from a formula; future‑proof heuristic composition
    [Serializable]
    public sealed class DerivedFeatureConfig
    {
        public string id;
        public string expr; // references other features by id (e.g., "(a+b)/(c+d)")
    }

    // Candidate with metadata
    public sealed class LevelCandidate
    {
        public LevelDTO dto;               // authoring state
        public string reachableHash;       // dedupe
        public SlimeGrid.Tools.Solver.SolverReport report; // solver output
        public Dictionary<string, float> features = new(); // computed values
        public float rawScore;
        public float normalizedScore;
    }
}

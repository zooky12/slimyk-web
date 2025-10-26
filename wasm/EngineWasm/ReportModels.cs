#if UNITY_EDITOR || EXPOSE_WASM
using System.Collections.Generic;
using Newtonsoft.Json;

namespace SlimeGrid.Tools.Solver
{
    public sealed class SolverReport
    {
        public string solverVersion { get; set; }
        public string dirOrder { get; set; }
        public CapsInfo caps { get; set; }
        public LevelHeader level { get; set; }

        public int nodesExplored { get; set; }
        public int maxDepthReached { get; set; }
        public double elapsedSeconds { get; set; }
        public string solvedTag { get; set; } // "true" | "false" | "capped"

        public int solutionsTotalCount { get; set; }
        public int solutionsFilteredCount { get; set; }

        public List<SolutionEntry> topSolutions { get; set; } = new();

        public int deadEndsCount { get; set; }
        public double deadEndsAverageDepth { get; set; }
        public int deadEndsNearTop1Count { get; set; }
        public int deadEndsNearTop3Count { get; set; }
    }

    public sealed class CapsInfo
    {
        public int nodesCap { get; set; }
        public int depthCap { get; set; }
        public double timeCapSeconds { get; set; }
        public bool timeCapEnabled { get; set; }
        public bool nodesHit { get; set; }
        public bool depthHit { get; set; }
        public bool timeHit { get; set; }
    }

    public sealed class LevelHeader
    {
        public int width { get; set; }
        public int height { get; set; }
        public string levelHash { get; set; }
    }

    public sealed class SolutionEntry
    {
        public int length { get; set; }
        public byte[] movesPacked { get; set; }
    }
}
#endif

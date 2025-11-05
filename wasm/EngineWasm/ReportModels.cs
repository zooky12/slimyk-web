#if UNITY_EDITOR || EXPOSE_WASM
using System;
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

        // NEW: Full snapshot for reproducibility (kept separate to preserve existing 'level')
        public LevelSnapshot levelSnapshot { get; set; }

        public int nodesExplored { get; set; }
        public int maxDepthReached { get; set; }
        public double elapsedSeconds { get; set; }
        public string solvedTag { get; set; } // "true" | "false" | "capped"

        public int solutionsTotalCount { get; set; }
        public int solutionsFilteredCount { get; set; }

        public List<SolutionEntry> topSolutions { get; set; } = new();

        // NEW: Optional traces for top solutions (top1 or top3)
        public SolutionTrace[] solutionTraces { get; set; }

        // NEW: mechanics summary (optional)
        public MechanicsSummary mechanics { get; set; }

        public int deadEndsCount { get; set; }
        public double deadEndsAverageDepth { get; set; }
        public int deadEndsNearTop1Count { get; set; }
        public int deadEndsNearTop3Count { get; set; }

        // Extra move-analysis metrics (top solutions)
        public int stepsInBoxTop1 { get; set; }
        public int stepsFreeTop1 { get; set; }
        public int dedupMovesLenTop1 { get; set; }
        public double stepsInBoxTop3Avg { get; set; }
        public double stepsFreeTop3Avg { get; set; }
        public double dedupMovesLenTop3Avg { get; set; }

        // Diagnostics
        public int noOpSkips { get; set; }
        public int keyEqNonNoop { get; set; }
        public int visitedPrunes { get; set; } // prunes due to visited-depth
        public int frontierAtMaxDepth { get; set; } // nodes dequeued at maxDepth
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

    // --- NEW: Snapshot (grid names only + minimal entities) ---
    public sealed class LevelSnapshot
    {
        public int width { get; set; }
        public int height { get; set; }
        public string hash { get; set; }
        public string[][] tileGrid { get; set; } // [y][x]
        public EntitySnapshot[] entities { get; set; } // index == ei (stable order in snapshot)
    }

    public struct EntitySnapshot
    {
        public int eid { get; set; }
        public string type { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public char orientation { get; set; } // 'N','E','S','W'
    }

    public sealed class SolutionEntry
    {
        public int length { get; set; }
        public byte[] movesPacked { get; set; }
        // NEW: decoded NESW string
        public string movesNESW { get; set; }
    }

    // --- NEW: Traces ---
    public sealed class SolutionTrace
    {
        public string which { get; set; } // "top1" | "top2" | "top3"
        public TraceStep[] steps { get; set; }
    }

    public struct TraceStep
    {
        public char input { get; set; }                  // 'N','E','S','W'
        public string moveKind { get; set; }             // "move"|"push"|"tumble"|"slide"|"fly"
        public int tilesMoved { get; set; }              // >=1

        public Vec2i playerFrom { get; set; }
        public Vec2i playerTo { get; set; }
        public bool playerOnSlipPrev { get; set; }
        public bool playerOnSlipNext { get; set; }
        public ulong playerDestTraitsMask { get; set; }  // tile-only

        public EntityDelta[] moved { get; set; }
        public TileTraitDelta[] tileDeltas { get; set; }

        public bool exitActivePrev { get; set; }
        public bool exitActiveNext { get; set; }
        public bool anyButtonPrev { get; set; }
        public bool anyButtonNext { get; set; }

        // Heuristics may fill for top1 only
        public string[] events { get; set; }
        public SpecialLists special { get; set; }
    }

    public struct EntityDelta
    {
        public int eid { get; set; }
        public string type { get; set; }
        public Vec2i from { get; set; }
        public Vec2i to { get; set; }
        public char orientPrev { get; set; }
        public char orientNext { get; set; }
        public ulong destTraitsMask { get; set; } // tile-only
    }

    public struct TileTraitDelta
    {
        public Vec2i pos { get; set; }
        public ulong traitsPrevMask { get; set; }
        public ulong traitsNextMask { get; set; }
    }

    public struct SpecialLists
    {
        public Dictionary<string, SpecialHit[]> byAction { get; set; }
        public Dictionary<string, SpecialHit[]> byEntity { get; set; }
    }

    public struct SpecialHit { public string tag { get; set; } public int x { get; set; } public int y { get; set; } }
    public struct Vec2i { public int x { get; set; } public int y { get; set; } }

    // --- NEW: Mechanics summary ---
    public sealed class MechanicsSummary
    {
        public MechanicsTop1 top1 { get; set; }
        public MechanicsTop[] top3 { get; set; }
        public MechanicsClassification classification { get; set; }
    }
    public sealed class MechanicsTop1
    {
        public string[] interactions { get; set; }
        public Dictionary<string, int> counts { get; set; }
    }
    public sealed class MechanicsTop
    {
        public string[] interactions { get; set; }
    }
    public sealed class MechanicsClassification
    {
        public string[] strong { get; set; }
        public string[] soft { get; set; }
        public string[] common { get; set; }
    }
}
#endif

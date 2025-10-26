#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using Newtonsoft.Json;
using SlimeGrid.Logic;

namespace SlimeGrid.Tools.Solver
{
    public sealed class SolverConfig
    {
        public int NodesCap = 200_000;
        public int DepthCap = 10_000;
        public double TimeCapSeconds = 10.0;
        public bool EnforceTimeCap = false; // implemented, off by default
    }

    public static class BruteForceSolver
    {
        // Deterministic order
        static readonly Dir[] DIRS = new[] { Dir.N, Dir.E, Dir.S, Dir.W };

        public static SolverReport Analyze(GameState initial, SolverConfig cfg)
        {
            var ctx = StateHasher.BuildLevelContext(initial.Grid);
            var report = new SolverReport
            {
                solverVersion = "bf-1",
                dirOrder = "N,E,S,W",
                caps = new CapsInfo
                {
                    nodesCap = cfg.NodesCap,
                    depthCap = cfg.DepthCap,
                    timeCapSeconds = cfg.TimeCapSeconds,
                    timeCapEnabled = cfg.EnforceTimeCap
                },
                level = new LevelHeader { width = initial.Grid.W, height = initial.Grid.H, levelHash = ComputeLevelHash(initial) }
            };

            // Precheck: exit in player's wall component?
            if (!PrecheckHasExitReachableByWalls(initial))
            {
                report.solvedTag = "false";
                report.elapsedSeconds = 0;
                return report;
            }

            var sw = Stopwatch.StartNew();

            var visited = new HashSet<StateKey>(4096);
            var solutionsRaw = new List<PackedMoves>(256);
            var deadEnds = new List<PackedMoves>(1024);

            var rootKey = StateHasher.Compute(initial, ctx);
            visited.Add(rootKey);

            int nodes = 1;
            int maxDepth = 0;
            bool nodesHit = false, depthHit = false, timeHit = false;

            var path = new PackedMoves(128);
            var stack = new Stack<Frame>(256);
            stack.Push(new Frame(CloneState(initial), 0, false, false, rootKey));

            while (stack.Count > 0)
            {
                if (cfg.EnforceTimeCap && sw.Elapsed.TotalSeconds > cfg.TimeCapSeconds)
                { timeHit = true; break; }

                var frame = stack.Pop();

                if (frame.NextDirIndex >= DIRS.Length || nodesHit || depthHit)
                {
                    // Finished this node; dead-end detection
                    if (!frame.SubtreeHasWin && frame.HadFreshChild)
                    {
                        deadEnds.Add(path.Snapshot());
                    }
                    if (stack.Count > 0)
                    {
                        var parent = stack.Pop();
                        parent.SubtreeHasWin |= frame.SubtreeHasWin;
                        stack.Push(parent);
                        if (path.Length > 0) path.Pop();
                    }
                    continue;
                }

                // Expand next move for this frame
                var dir = DIRS[frame.NextDirIndex];
                frame.NextDirIndex++;
                stack.Push(frame); // put back with incremented index

                // Apply move
                var child = CloneState(frame.State);
                var res = Engine.Step(child, dir);

                // Compute hash to detect no-op and canonical state
                var childKey = StateHasher.Compute(child, ctx);
                if (childKey.Equals(frame.Key))
                {
                    // no-op; ignore
                    continue;
                }

                bool fresh = visited.Add(childKey);
                if (!fresh)
                {
                    // revisit; ignore
                    continue;
                }

                frame.HadFreshChild = true;
                stack.Pop(); stack.Push(frame); // update frame on stack

                nodes++;
                maxDepth = Math.Max(maxDepth, path.Length + 1);
                if (nodes >= cfg.NodesCap) nodesHit = true;
                if (path.Length + 1 >= cfg.DepthCap) depthHit = true;

                // Extend path
                path.Push((byte)dir);

                if (child.Win)
                {
                    // Record solution (shortest to this terminal due to visited pruning)
                    solutionsRaw.Add(path.Snapshot());
                    // Mark win for this subtree and backtrack one step (pop path handled in finish block)
                    // Set on top frame to propagate when it finishes its children
                    var top = stack.Pop();
                    top.SubtreeHasWin = true;
                    stack.Push(top);
                    // Pop path here to maintain correct sequence for parent continuation
                    path.Pop();
                    continue;
                }
                if (child.GameOver)
                {
                    // Terminal but not a dead end by definition; just backtrack
                    path.Pop();
                    continue;
                }

                // Continue deeper if caps allow
                if (!(nodesHit || depthHit))
                {
                    stack.Push(new Frame(child, 0, false, false, childKey));
                }
                else
                {
                    path.Pop();
                }
            }

            sw.Stop();
            report.elapsedSeconds = sw.Elapsed.TotalSeconds;
            report.nodesExplored = nodes;
            report.maxDepthReached = maxDepth;
            report.caps.nodesHit = nodesHit;
            report.caps.depthHit = depthHit;
            report.caps.timeHit = timeHit;

            bool finished = stack.Count == 0 && !nodesHit && !depthHit && !timeHit;

            // Filter solutions and compute aggregates
            report.solutionsTotalCount = solutionsRaw.Count;
            var filtered = SolutionFilter.FilterSimilar(solutionsRaw);
            report.solutionsFilteredCount = filtered.Count;

            for (int i = 0; i < Math.Min(10, filtered.Count); i++)
            {
                var s = filtered[i];
                report.topSolutions.Add(new SolutionEntry { length = s.Length, movesPacked = s.Snapshot().Buffer });
            }

            // Dead-end metrics (depth computed locally from the dead-end state, loop-aware)
            report.deadEndsCount = deadEnds.Count;
            double sumDepth = 0;
            var levelCtx = StateHasher.BuildLevelContext(initial.Grid);
            foreach (var d in deadEnds)
            {
                int dd = DeadEndAnalyzer.ComputeDeadEndDepth(initial, levelCtx, d);
                sumDepth += dd;
            }
            report.deadEndsAverageDepth = deadEnds.Count > 0 ? sumDepth / deadEnds.Count : 0;

            // Near-optimal counts
            if (filtered.Count > 0)
            {
                var top1 = filtered[0];
                int nearTop1 = 0, nearTop3 = 0;
                var top3 = new List<PackedMoves>();
                for (int i = 0; i < Math.Min(3, filtered.Count); i++) top3.Add(filtered[i]);
                foreach (var d in deadEnds)
                {
                    if (PackedMoves.EditDistanceLeq(d, top1, 5)) nearTop1++;
                    bool anyTop3 = false;
                    foreach (var t in top3) { if (PackedMoves.EditDistanceLeq(d, t, 5)) { anyTop3 = true; break; } }
                    if (anyTop3) nearTop3++;
                }
                report.deadEndsNearTop1Count = nearTop1;
                report.deadEndsNearTop3Count = nearTop3;
            }

            report.solvedTag = finished ? (filtered.Count > 0 ? "true" : "false") : "capped";
            return report;
        }

        static string ComputeLevelHash(GameState s)
        {
            unchecked
            {
                ulong h = 1469598103934665603UL;
                for (int y = 0; y < s.Grid.H; y++)
                    for (int x = 0; x < s.Grid.W; x++)
                    {
                        var p = new V2(x, y);
                        var c = s.Grid.CellRef(p);
                        h ^= (ulong)c.Type; h *= 1099511628211UL;
                        h ^= (ulong)c.ActiveMask; h *= 1099511628211UL;
                        if (c.InactiveMask.HasValue) { h ^= (ulong)c.InactiveMask.Value; h *= 1099511628211UL; }
                    }
                return h.ToString("X16");
            }
        }

        static bool PrecheckHasExitReachableByWalls(GameState s)
        {
            var grid = s.Grid;
            var start = s.PlayerPos;
            var seen = new bool[grid.W, grid.H];
            var q = new Queue<V2>();
            if (!grid.InBounds(start)) return true;
            q.Enqueue(start); seen[start.x, start.y] = true;
            bool hasExit = false;
            while (q.Count > 0)
            {
                var p = q.Dequeue();
                var cell = grid.CellRef(p);
                if (cell.Type == TileType.Exit) hasExit = true;
                foreach (var d in DIRS)
                {
                    var v = d.Vec(); var np = new V2(p.x + v.dx, p.y + v.dy);
                    if (!grid.InBounds(np)) continue;
                    if (seen[np.x, np.y]) continue;
                    var nc = grid.CellRef(np);
                    if (nc.Type == TileType.Wall) continue;
                    seen[np.x, np.y] = true; q.Enqueue(np);
                }
            }
            return hasExit;
        }

        static GameState CloneState(GameState s)
        {
            var c = new GameState
            {
                Grid = s.Grid,
                PlayerPos = s.PlayerPos,
                AttachedEntityId = s.AttachedEntityId,
                EntryDir = s.EntryDir,
                LastMoveDir = s.LastMoveDir,
                AnyButtonPressed = s.AnyButtonPressed,
                LastAnyButtonPressed = s.LastAnyButtonPressed,
                GameOver = s.GameOver,
                Win = s.Win,
            };
            foreach (var kv in s.EntitiesById)
            {
                var e = kv.Value;
                var ne = new Entity
                {
                    Id = e.Id,
                    Type = e.Type,
                    Pos = e.Pos,
                    Traits = e.Traits,
                    Orientation = e.Orientation,
                    Behavior = e.Behavior
                };
                c.EntitiesById[ne.Id] = ne;
            }
            foreach (var kv in s.EntityAt)
            {
                c.EntityAt[kv.Key] = kv.Value;
            }
            return c;
        }

        struct Frame
        {
            public GameState State;
            public int NextDirIndex;
            public bool HadFreshChild;
            public bool SubtreeHasWin;
            public StateKey Key;
            public Frame(GameState s, int next, bool hadFresh, bool subWin, StateKey key)
            { State = s; NextDirIndex = next; HadFreshChild = hadFresh; SubtreeHasWin = subWin; Key = key; }
        }
    }
}
#endif

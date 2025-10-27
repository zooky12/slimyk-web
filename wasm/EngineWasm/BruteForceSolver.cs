#if UNITY_EDITOR || EXPOSE_WASM
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
        public bool LightReport = true;
    }

    public static class BruteForceSolver
    {
        // Deterministic order
        static readonly Dir[] DIRS = new[] { Dir.N, Dir.E, Dir.S, Dir.W };

        static bool PrefixEqual(PackedMoves a, PackedMoves b, int len)
        {

            if (len < 0) return false;
            if (a.Length < len || b.Length < len) return false;
            for (int i = 0; i < len; i++) if (a.GetAt(i) != b.GetAt(i)) return false;
            return true;
        }
        static void ComputeMoveStats(GameState initial, List<PackedMoves> filtered, out int stepsInBoxTop1, out int stepsFreeTop1, out int dedupLenTop1,
            out double stepsInBoxTop3Avg, out double stepsFreeTop3Avg, out double dedupLenTop3Avg)
        {
            stepsInBoxTop1 = 0; stepsFreeTop1 = 0; dedupLenTop1 = 0;
            stepsInBoxTop3Avg = 0; stepsFreeTop3Avg = 0; dedupLenTop3Avg = 0;
            int k = Math.Min(3, filtered.Count);
            if (k <= 0) return;

            for (int i = 0; i < k; i++)
            {
                var pm = filtered[i];
                // Replay moves
                var s = CloneState(initial);
                int inBox = 0, free = 0;
                int dedupLen = 0;
                int lastMove = -1;
                for (int m = 0; m < pm.Length; m++)
                {
                    var code = pm.GetAt(m); // 0=N,1=E,2=S,3=W
                    // Dedup compressed length (count direction changes)
                    if (code != lastMove) { dedupLen++; lastMove = code; }
                    var dir = DIRS[code];
                    Engine.Step(s, dir);
                    if (s.AttachedEntityId != null) inBox++; else free++;
                }
                if (i == 0)
                {
                    stepsInBoxTop1 = inBox;
                    stepsFreeTop1 = free;
                    dedupLenTop1 = dedupLen;
                }
                stepsInBoxTop3Avg += inBox;
                stepsFreeTop3Avg += free;
                dedupLenTop3Avg += dedupLen;
            }
            stepsInBoxTop3Avg /= k;
            stepsFreeTop3Avg /= k;
            dedupLenTop3Avg /= k;
        }

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

            // Track minimal depth seen for each visited state to avoid pruning shorter revisits
            var visited = new Dictionary<StateKey, int>(4096);
            var solutionsRaw = new List<PackedMoves>(256);
            var pathByKey = new Dictionary<StateKey, PackedMoves>(4096);
            var processed = new HashSet<StateKey>(4096);
            var goals = new HashSet<StateKey>();
            var adj = new Dictionary<StateKey, HashSet<StateKey>>(4096);
            var rev = new Dictionary<StateKey, HashSet<StateKey>>(4096);
            var deadEnds = new List<PackedMoves>(1024);

            var rootKey = StateHasher.ComputeZobrist(initial, ctx);
            visited[rootKey] = 0;

            int nodes = 1;
            int maxDepth = 0;
            bool nodesHit = false, depthHit = false, timeHit = false;
            int bestSolutionLen = int.MaxValue;

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
                var childKey = StateHasher.ComputeZobrist(child, ctx);
                if (childKey.Equals(frame.Key))
                {
                    // no-op; ignore
                    continue;
                }

                int newDepth = path.Length + 1;
                if (visited.TryGetValue(childKey, out var seenDepth) && seenDepth <= newDepth)
                {
                    // revisit not better; ignore
                    continue;
                }
                visited[childKey] = newDepth;

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
                    if (path.Length < bestSolutionLen) bestSolutionLen = path.Length;
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

                // Prune if we already have a solution and this path can't be shorter
                if (bestSolutionLen != int.MaxValue && path.Length >= bestSolutionLen)
                {
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

            // Moves analysis (top1 and top3 averages)
            if (filtered.Count > 0)
            {
                ComputeMoveStats(initial, filtered, out int inBox1, out int free1, out int dlen1, out double inBox3, out double free3, out double dlen3);
                report.stepsInBoxTop1 = inBox1;
                report.stepsFreeTop1 = free1;
                report.dedupMovesLenTop1 = dlen1;
                report.stepsInBoxTop3Avg = inBox3;
                report.stepsFreeTop3Avg = free3;
                report.dedupMovesLenTop3Avg = dlen3;
            }

            // Dead-end metrics (count and near counts); depth skipped in LightReport
            report.deadEndsCount = deadEnds.Count;
            if (cfg.LightReport)
            {
                report.deadEndsAverageDepth = 0;
            }
            else
            {
                double sumDepth = 0;
                var levelCtx = StateHasher.BuildLevelContext(initial.Grid);
                foreach (var d in deadEnds)
                {
                    int dd = DeadEndAnalyzer.ComputeDeadEndDepth(initial, levelCtx, d);
                    sumDepth += dd;
                }
                report.deadEndsAverageDepth = deadEnds.Count > 0 ? sumDepth / deadEnds.Count : 0;
            }

            // Near counts via strict prefix equality with K=5
            if (filtered.Count > 0 && deadEnds.Count > 0)
            {
                int K = 5;
                var top1 = filtered[0];
                int nearTop1 = 0, nearTop3 = 0;
                int top3N = Math.Min(3, filtered.Count);
                foreach (var d in deadEnds)
                {
                    int L = d.Length; if (L <= K) continue; int pref = L - K;
                    if (PrefixEqual(d, top1, pref)) nearTop1++;
                    for (int t = 0; t < top3N; t++) { if (PrefixEqual(d, filtered[t], pref)) { nearTop3++; break; } }
                }
                report.deadEndsNearTop1Count = nearTop1;
                report.deadEndsNearTop3Count = nearTop3;
            }

            report.solvedTag = finished ? (filtered.Count > 0 ? "true" : "false") : "capped";
            return report;
        }

        // Breadth-first variant prioritizing shortest paths and speed on simple levels
        public static SolverReport AnalyzeBfs(GameState initial, SolverConfig cfg)
        {
            var ctx = StateHasher.BuildLevelContext(initial.Grid);
            var report = new SolverReport
            {
                solverVersion = "bf-bfs-1",
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

            if (!PrecheckHasExitReachableByWalls(initial))
            {
                report.solvedTag = "false";
                report.elapsedSeconds = 0;
                return report;
            }

            var sw = Stopwatch.StartNew();
            var visited = new Dictionary<StateKey, int>(4096);
            var solutionsRaw = new List<PackedMoves>(256);
            var pathByKey = new Dictionary<StateKey, PackedMoves>(4096);
            var processed = new HashSet<StateKey>(4096);
            var goals = new HashSet<StateKey>();
            var adj = new Dictionary<StateKey, HashSet<StateKey>>(4096);
            var rev = new Dictionary<StateKey, HashSet<StateKey>>(4096);

            var rootKey = StateHasher.ComputeZobrist(initial, ctx);
            visited[rootKey] = 0;

            int nodes = 0;
            int maxDepth = 0;
            bool nodesHit = false, depthHit = false, timeHit = false;

            var q = new Queue<(GameState state, StateKey key, PackedMoves path, int depth)>();
            var rootPathBfs = new PackedMoves(64);
            q.Enqueue((CloneState(initial), rootKey, rootPathBfs, 0));
            pathByKey[rootKey] = rootPathBfs;

            while (q.Count > 0)
            {
                if (cfg.EnforceTimeCap && sw.Elapsed.TotalSeconds > cfg.TimeCapSeconds)
                { timeHit = true; break; }

                var (state, key, path, depth) = q.Dequeue();
                nodes++;
                if (nodes >= cfg.NodesCap) { nodesHit = true; break; }
                if (depth >= cfg.DepthCap) { depthHit = true; continue; }

                foreach (var dir in DIRS)
                {
                    var child = CloneState(state);
                    var _ = Engine.Step(child, dir);
                    var childKey = StateHasher.ComputeZobrist(child, ctx);
                    if (childKey.Equals(key)) continue;

                    int newDepth = depth + 1;
                    if (visited.TryGetValue(childKey, out var seenDepth) && seenDepth <= newDepth) continue;
                    visited[childKey] = newDepth;

                    var next = path.Snapshot(); next.Push((byte)dir);
                    if (next.Length > maxDepth) maxDepth = next.Length;
                    pathByKey[childKey] = next;

                    // Build adjacency excluding losing edges
                    if (!child.GameOver)
                    {
                        if (!adj.TryGetValue(key, out var outs)) { outs = new HashSet<StateKey>(); adj[key] = outs; }
                        outs.Add(childKey);
                        if (!rev.TryGetValue(childKey, out var parents)) { parents = new HashSet<StateKey>(); rev[childKey] = parents; }
                        parents.Add(key);
                    }

                    if (child.GameOver) continue;
                    if (child.Win)
                    {
                        solutionsRaw.Add(next);
                        goals.Add(childKey);
                        continue;
                    }
                    q.Enqueue((child, childKey, next, newDepth));
                }
                // Mark expanded
                processed.Add(key);
            }

            sw.Stop();
            report.elapsedSeconds = sw.Elapsed.TotalSeconds;
            report.nodesExplored = nodes;
            report.maxDepthReached = maxDepth;
            report.caps.nodesHit = nodesHit;
            report.caps.depthHit = depthHit;
            report.caps.timeHit = timeHit;

            bool finished = q.Count == 0 && !nodesHit && !depthHit && !timeHit;

            report.solutionsTotalCount = solutionsRaw.Count;
            var filtered = SolutionFilter.FilterSimilar(solutionsRaw);
            report.solutionsFilteredCount = filtered.Count;
            for (int i = 0; i < Math.Min(10, filtered.Count); i++)
            {
                var s = filtered[i];
                report.topSolutions.Add(new SolutionEntry { length = s.Length, movesPacked = s.Snapshot().Buffer });
            }

            if (filtered.Count > 0)
            {
                ComputeMoveStats(initial, filtered, out int inBox1, out int free1, out int dlen1, out double inBox3, out double free3, out double dlen3);
                report.stepsInBoxTop1 = inBox1;
                report.stepsFreeTop1 = free1;
                report.dedupMovesLenTop1 = dlen1;
                report.stepsInBoxTop3Avg = inBox3;
                report.stepsFreeTop3Avg = free3;
                report.dedupMovesLenTop3Avg = dlen3;
            }

            // Dead-end detection using reverse BFS from goals
            var solvable = new HashSet<StateKey>(goals);
            var rq = new Queue<StateKey>();
            foreach (var g in goals) rq.Enqueue(g);
            while (rq.Count > 0)
            {
                var cur = rq.Dequeue();
                if (!rev.TryGetValue(cur, out var parents)) continue;
                foreach (var p in parents)
                {
                    if (solvable.Add(p)) rq.Enqueue(p);
                }
            }

            var deadEndKeys = new HashSet<StateKey>();
            foreach (var kv in adj)
            {
                var parent = kv.Key; var outs = kv.Value;
                if (!solvable.Contains(parent)) continue;
                foreach (var child in outs)
                {
                    if (solvable.Contains(child)) continue;
                    if (!processed.Contains(child)) continue;
                    bool hasEscape = false;
                    if (adj.TryGetValue(child, out var outs2))
                    {
                        foreach (var o in outs2) { if (solvable.Contains(o)) { hasEscape = true; break; } }
                    }
                    if (!hasEscape) deadEndKeys.Add(child);
                }
            }

            report.deadEndsCount = deadEndKeys.Count;
            if (cfg.LightReport)
            {
                report.deadEndsAverageDepth = 0;
            }
            else
            {
                if (deadEndKeys.Count > 0)
                {
                    double sumLen = 0;
                    foreach (var k in deadEndKeys)
                    {
                        if (pathByKey.TryGetValue(k, out var pm)) sumLen += pm.Length;
                    }
                    report.deadEndsAverageDepth = sumLen / deadEndKeys.Count;
                }
                else report.deadEndsAverageDepth = 0;
            }
            // Near counts via strict prefix equality with K=5
            {
                int near1 = 0, near3 = 0; int K = 5;
                if (filtered.Count > 0 && deadEndKeys.Count > 0)
                {
                    var top1 = filtered[0]; int top3N = Math.Min(3, filtered.Count);
                    foreach (var k in deadEndKeys)
                    {
                        if (!pathByKey.TryGetValue(k, out var d)) continue;
                        int L = d.Length; if (L <= K) continue; int pref = L - K;
                        if (PrefixEqual(d, top1, pref)) near1++;
                        for (int t = 0; t < top3N; t++) { if (PrefixEqual(d, filtered[t], pref)) { near3++; break; } }
                    }
                }
                report.deadEndsNearTop1Count = near1;
                report.deadEndsNearTop3Count = near3;
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

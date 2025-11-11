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
        // Mode selector: true = BFS (AnalyzeBfs), false = DFS (Analyze)
        public bool UseBfs = true;
        // Disable visited-depth pruning (diagnostic; slower but more complete)
        public bool DisableVisited = false;
        // Optional: relax visited pruning starting at this depth (keep duplicates)
        // Default 60 helps work around edge-sensitive merges on toggle-heavy levels
        public int RelaxVisitedFromDepth = 60;
        // NEW: emit traces for top K solutions (1 or 3; 0 disables)
        public int EmitTraceTopK = 3;
        // NEW: minimum acceptable steps. If a solution with length <= MinSteps is found in BFS, stop early and discard.
        public int MinSteps = 0;
        // When true and MinSteps > 0: if a solution longer than MinSteps is found, stop search early and return that
        // solution (used by greedy single-edit search to adopt first improvement).
        public bool StopOnFirstLongerThanMin = false;
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
            // Build snapshot (names only) up front
            report.levelSnapshot = BuildLevelSnapshot(initial);

            // Precheck disabled: some solvable levels rely on button/toggle routing
            // that violates simple wall-component reachability. Let the search decide.

            var sw = Stopwatch.StartNew();

            // Track minimal depth seen for each visited state to avoid pruning shorter revisits
            var visited = cfg.DisableVisited ? null : new Dictionary<StateKey, int>(4096);
            var solutionsRaw = new List<PackedMoves>(256);
            var pathByKey = new Dictionary<StateKey, PackedMoves>(4096);
            var processed = new HashSet<StateKey>(4096);
            var goals = new HashSet<StateKey>();
            var adj = new Dictionary<StateKey, HashSet<StateKey>>(4096);
            var rev = new Dictionary<StateKey, HashSet<StateKey>>(4096);
            var deadEnds = new List<PackedMoves>(1024);

            var rootKey = StateHasher.ComputeZobrist(initial, ctx);
            if (visited != null) visited[rootKey] = 0;

            int nodes = 1;
            int maxDepth = 0;
            bool nodesHit = false, depthHit = false, timeHit = false;
            int bestSolutionLen = int.MaxValue;

            var path = new PackedMoves(128);
            int noOpSkips = 0, keyEqNonNoop = 0;
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
                var _ = Engine.Step(child, dir, out SlimeGrid.Logic.Engine.StepEffects eff);
                
                // Compute hash to detect no-op and canonical state
                var childKey = StateHasher.ComputeZobrist(child, ctx);
                bool onlyKeyEq = childKey.Equals(frame.Key);
                bool isNoOp = (eff == SlimeGrid.Logic.Engine.StepEffects.None) && onlyKeyEq;
                if (isNoOp) noOpSkips++;
                else if (onlyKeyEq) keyEqNonNoop++;
                if (isNoOp)
                {
                    // no-op; ignore
                    continue;
                }

                int newDepth = path.Length + 1;
                if (visited != null)
                {
                    if (visited.TryGetValue(childKey, out var seenDepth) && seenDepth <= newDepth)
                        continue; // revisit not better; ignore
                    visited[childKey] = newDepth;
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
            report.frontierAtMaxDepth = 0; // not tracked precisely; keep for completeness
            report.noOpSkips = noOpSkips;
            report.keyEqNonNoop = keyEqNonNoop;
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
                report.topSolutions.Add(new SolutionEntry { length = s.Length, movesPacked = s.Snapshot().Buffer, movesNESW = s.ToNESWString(s.Length) });
            }

            // Build traces for Top-1 or Top-3 depending on config
            if (filtered.Count > 0 && cfg.EmitTraceTopK > 0)
            {
                int K = Math.Min(cfg.EmitTraceTopK, Math.Min(3, filtered.Count));
                var traces = new SolutionTrace[K];
                for (int i = 0; i < K; i++)
                {
                    traces[i] = BuildTrace($"top{(i + 1)}", initial, filtered[i]);
                }
                report.solutionTraces = traces;
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
            // Precompute exit positions for lightweight heuristic ordering within depth
            var exitCells = new List<V2>();
            for (int y = 0; y < initial.Grid.H; y++)
                for (int x = 0; x < initial.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    if (initial.Grid.CellRef(p).Type == TileType.Exit) exitCells.Add(p);
                }
            int H(V2 pos)
            {
                if (exitCells.Count == 0) return 0;
                int best = int.MaxValue;
                foreach (var epos in exitCells)
                {
                    int d = Math.Abs(pos.x - epos.x) + Math.Abs(pos.y - epos.y);
                    if (d < best) best = d;
                }
                return best == int.MaxValue ? 0 : best;
            }
            int AllowExitMiss(GameState s)
            {
                int miss = 0;
                for (int y = 0; y < s.Grid.H; y++)
                    for (int x = 0; x < s.Grid.W; x++)
                    {
                        var p = new V2(x, y);
                        var tile = TileTraits.For(s.Grid.CellRef(p).Type).Active;
                        if ((tile & Traits.ButtonAllowExit) != 0)
                        {
                            if (!s.EntityAt.TryGetValue(p, out var id) || (s.EntitiesById[id].Traits & Traits.PressesButtons) == 0)
                                miss++;
                        }
                    }
                return miss;
            }
            var report = new SolverReport
            {
                solverVersion = "bf-bfs-2",
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
            report.levelSnapshot = BuildLevelSnapshot(initial);

            // Precheck disabled here as well; proceed with BFS search.

            var sw = Stopwatch.StartNew();
            var visited = cfg.DisableVisited ? null : new Dictionary<StateKey, int>(4096);
            var solutionsRaw = new List<PackedMoves>(256);
            var pathByKey = new Dictionary<StateKey, PackedMoves>(4096);
            var processed = new HashSet<StateKey>(4096);
            var goals = new HashSet<StateKey>();
            var adj = new Dictionary<StateKey, HashSet<StateKey>>(4096);
            var rev = new Dictionary<StateKey, HashSet<StateKey>>(4096);

            var rootKey = StateHasher.ComputeZobrist(initial, ctx);
            if (visited != null) visited[rootKey] = 0;

            int nodes = 0;
            int noOpSkips = 0, keyEqNonNoop = 0;
            int visitedPrunes = 0;
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

                // Build children then order within this layer by a light heuristic
                var children = new List<(GameState s, StateKey key2, PackedMoves next, int newDepth, int score)>();
                foreach (var dir in DIRS)
                {
                    var child = CloneState(state);
                    var __ = Engine.Step(child, dir, out SlimeGrid.Logic.Engine.StepEffects eff);
                    var childKey = StateHasher.ComputeZobrist(child, ctx);
                    bool onlyKeyEq = childKey.Equals(key);
                    bool isNoOp = (eff == SlimeGrid.Logic.Engine.StepEffects.None) && onlyKeyEq;
                    if (isNoOp) { noOpSkips++; continue; }
                    else if (onlyKeyEq) keyEqNonNoop++;

                    int newDepth = depth + 1;
                    if (visited != null)
                    {
                        // Strict BFS visited pruning: prune if we have seen this key at equal or lower depth
                        if (visited.TryGetValue(childKey, out var seenDepth) && seenDepth <= newDepth) { visitedPrunes++; continue; }
                        visited[childKey] = newDepth;
                    }

                    var next = path.Snapshot(); next.Push((byte)dir);
                    if (next.Length > maxDepth) maxDepth = next.Length;
                    pathByKey[childKey] = next;

                    // adjacency for dead-end analysis
                    if (!child.GameOver)
                    {
                        if (!adj.TryGetValue(key, out var outs)) { outs = new HashSet<StateKey>(); adj[key] = outs; }
                        outs.Add(childKey);
                        if (!rev.TryGetValue(childKey, out var parents)) { parents = new HashSet<StateKey>(); rev[childKey] = parents; }
                        parents.Add(key);
                    }
                    // Do not expand terminal losing states
                    if (child.GameOver) continue;
                    if (child.Win)
                    {
                        // Early-out: if found a too-short (or equal) solution, stop and return empty solutions (discard).
                        if (cfg.MinSteps > 0 && next.Length <= cfg.MinSteps)
                        {
                            sw.Stop();
                            report.solutionsTotalCount = 0;
                            report.solutionsFilteredCount = 0;
                            report.topSolutions.Clear();
                            report.solvedTag = "too_short";
                            return report;
                        }
                        // Early-accept: if configured and first solution is strictly longer than MinSteps, accept immediately
                        if (cfg.MinSteps > 0 && cfg.StopOnFirstLongerThanMin && next.Length > cfg.MinSteps)
                        {
                            sw.Stop();
                            report.topSolutions.Clear();
                            report.topSolutions.Add(new SolutionEntry { length = next.Length, movesPacked = next.Snapshot().Buffer, movesNESW = next.ToNESWString(next.Length) });
                            report.solutionsTotalCount = 1;
                            report.solutionsFilteredCount = 1;
                            report.deadEndsCount = 0;
                            report.solvedTag = "improved";
                            return report;
                        }
                        solutionsRaw.Add(next);
                        goals.Add(childKey);
                        continue;
                    }

                    int sc = H(child.PlayerPos) + (AllowExitMiss(child) * 2);
                    // small bias toward steps that changed tiles/buttons
                    if ((eff & (SlimeGrid.Logic.Engine.StepEffects.Tiles | SlimeGrid.Logic.Engine.StepEffects.Buttons)) != 0) sc = sc > 0 ? sc - 1 : 0;
                    children.Add((child, childKey, next, newDepth, sc));
                }
                // Order by score asc (more promising first)
                if (children.Count > 1) children.Sort((a, b) => a.score.CompareTo(b.score));
                foreach (var c in children) q.Enqueue((c.s, c.key2, c.next, c.newDepth));
                // Mark expanded
                processed.Add(key);
            }

            sw.Stop();
            report.elapsedSeconds = sw.Elapsed.TotalSeconds;
            report.nodesExplored = nodes;
            report.maxDepthReached = maxDepth;
            report.noOpSkips = noOpSkips;
            report.keyEqNonNoop = keyEqNonNoop;
            report.visitedPrunes = visitedPrunes;
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
                report.topSolutions.Add(new SolutionEntry { length = s.Length, movesPacked = s.Snapshot().Buffer, movesNESW = s.ToNESWString(s.Length) });
            }

            if (filtered.Count > 0 && cfg.EmitTraceTopK > 0)
            {
                int K = Math.Min(cfg.EmitTraceTopK, Math.Min(3, filtered.Count));
                var traces = new SolutionTrace[K];
                for (int i = 0; i < K; i++) traces[i] = BuildTrace($"top{(i + 1)}", initial, filtered[i]);
                report.solutionTraces = traces;
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
                        var tt = TileTraits.For(c.Type);
                        h ^= (ulong)tt.Active; h *= 1099511628211UL;
                        h ^= (ulong)(tt.ToggledTo.HasValue ? (ulong)(byte)tt.ToggledTo.Value + 0xBEEF : 0x1234UL);
                        h *= 1099511628211UL;
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

        static Grid2D CloneGrid(Grid2D g)
        {
            if (g == null) return null;
            var ng = new Grid2D(g.W, g.H);
            for (int y = 0; y < g.H; y++)
                for (int x = 0; x < g.W; x++)
                {
                    var p = new V2(x, y);
                    ref var oc = ref g.CellRef(p);
                    var nc = new Cell { Type = oc.Type, Orientation = oc.Orientation };
                    ng.SetCell(p, nc);
                }
            return ng;
        }

        // ---------- Helpers for snapshot/trace ----------
        static char DirToChar(Dir d) => d switch { Dir.N => 'N', Dir.E => 'E', Dir.S => 'S', _ => 'W' };
        static char OrientToChar(Orientation o) => o switch { Orientation.N => 'N', Orientation.E => 'E', Orientation.S => 'S', _ => 'W' };

        static SlimeGrid.Tools.Solver.LevelSnapshot BuildLevelSnapshot(GameState s)
        {
            var snap = new SlimeGrid.Tools.Solver.LevelSnapshot
            {
                width = s.Grid.W,
                height = s.Grid.H,
                hash = ComputeLevelHash(s),
                tileGrid = new string[s.Grid.H][],
            };
            for (int y = 0; y < s.Grid.H; y++)
            {
                var row = new string[s.Grid.W];
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    row[x] = s.Grid.CellRef(p).Type.ToString();
                }
                snap.tileGrid[y] = row;
            }
            // Stable entity order: row-major by position, then id
            var list = new List<(int id, Entity e)>();
            foreach (var kv in s.EntitiesById) list.Add((kv.Key, kv.Value));
            list.Sort((a, b) =>
            {
                int cy = a.e.Pos.y.CompareTo(b.e.Pos.y); if (cy != 0) return cy;
                int cx = a.e.Pos.x.CompareTo(b.e.Pos.x); if (cx != 0) return cx;
                return a.id.CompareTo(b.id);
            });
            var ents = new List<EntitySnapshot>(list.Count + 1);
            // Runtime entities (does not include PlayerSpawn)
            for (int i = 0; i < list.Count; i++)
            {
                var e = list[i].e;
                ents.Add(new EntitySnapshot
                {
                    eid = e.Id,
                    type = e.Type.ToString(),
                    x = e.Pos.x,
                    y = e.Pos.y,
                    orientation = OrientToChar(e.Orientation)
                });
            }
            // Inject PlayerSpawn from current player position for reproducibility
            try
            {
                ents.Add(new EntitySnapshot
                {
                    eid = 0,
                    type = SlimeGrid.Logic.EntityType.PlayerSpawn.ToString(),
                    x = s.PlayerPos.x,
                    y = s.PlayerPos.y,
                    orientation = 'N'
                });
            }
            catch { }
            snap.entities = ents.ToArray();
            return snap;
        }

        static ulong TileMaskAt(GameState s, V2 p)
        {
            var m = SlimeGrid.Logic.TraitsUtil.ResolveTileMask(s, p);
            return (ulong)m;
        }

        static SolutionTrace BuildTrace(string which, GameState initial, PackedMoves pm)
        {
            var s = CloneState(initial);
            int len = pm.Length;
            var steps = new TraceStep[len];
            for (int i = 0; i < len; i++)
            {
                var code = pm.GetAt(i); var dir = (Dir)code; char input = DirToChar(dir);

                bool exitPrev = SlimeGrid.Logic.Engine.AllAllowExitPressed(s);
                bool anyBtnPrev = s.AnyButtonPressed;

                var from = s.PlayerPos;
                bool slipPrev = SlimeGrid.Logic.TraitsUtil.TileIsSlippery(s, from);

                // Snapshot tile-only masks BEFORE step
                var masksPre = new ulong[s.Grid.W, s.Grid.H];
                for (int y = 0; y < s.Grid.H; y++)
                    for (int x = 0; x < s.Grid.W; x++)
                        masksPre[x, y] = TileMaskAt(s, new V2(x, y));

                // Snapshot orientations BEFORE step for moved-entity detection
                var orientPrev = new Dictionary<int, Orientation>(s.EntitiesById.Count);
                foreach (var kv in s.EntitiesById) orientPrev[kv.Key] = kv.Value.Orientation;

                var res = SlimeGrid.Logic.Engine.Step(s, dir);

                var to = s.PlayerPos;
                bool slipNext = SlimeGrid.Logic.TraitsUtil.TileIsSlippery(s, to);
                ulong playerToMask = TileMaskAt(s, to);

                // Collect movement details
                string moveKind = "move"; int tilesMoved = Math.Abs(to.x - from.x) + Math.Abs(to.y - from.y);
                var moved = new List<EntityDelta>();
                var togglePos = new List<V2>();
                // Try to pick player MoveStraight for kind/tiles
                foreach (var d in res.Deltas)
                {
                    if (d is SlimeGrid.Logic.MoveStraight ms && ms.Id == -1)
                    {
                        // Player move
                        tilesMoved = ms.Tiles > 0 ? ms.Tiles : tilesMoved;
                        if (!string.IsNullOrEmpty(ms.Kind))
                        {
                            var k = ms.Kind.ToLowerInvariant();
                            if (k == "fly") moveKind = "fly";
                            else if (k == "slide") moveKind = "slide";
                            else if (k == "step") moveKind = moveKind; // keep existing
                        }
                    }
                    else if (d is SlimeGrid.Logic.MoveEntity me)
                    {
                        var id = me.Id;
                        var e = s.EntitiesById.ContainsKey(id) ? s.EntitiesById[id] : null;
                        var typeName = e != null ? e.Type.ToString() : string.Empty;
                        var prevO = orientPrev.TryGetValue(id, out var po) ? po : (e != null ? e.Orientation : Orientation.N);
                        var nextO = e != null ? e.Orientation : prevO;
                        moved.Add(new EntityDelta
                        {
                            eid = id,
                            type = typeName,
                            from = new Vec2i { x = me.From.x, y = me.From.y },
                            to = new Vec2i { x = me.To.x, y = me.To.y },
                            orientPrev = OrientToChar(prevO),
                            orientNext = OrientToChar(nextO),
                            destTraitsMask = TileMaskAt(s, me.To)
                        });
                        // Movement kind priority: if any entity tumbled, prefer tumble; else if any moved and not slide/fly, pick push
                        if (!string.IsNullOrEmpty(me.Kind))
                        {
                            var mk = me.Kind.ToLowerInvariant();
                            if (mk == "tumble") moveKind = "tumble";
                            else if (mk == "push" && moveKind == "move") moveKind = "push";
                        }
                        else if (moveKind == "move") moveKind = "push";
                    }
                    else if (d is SlimeGrid.Logic.AnimationCue cue && cue.Type == SlimeGrid.Logic.CueType.ToggleSweep && cue.At.HasValue)
                    {
                        togglePos.Add(cue.At.Value);
                    }
                }

                var toggles = new List<TileTraitDelta>(togglePos.Count);
                foreach (var p in togglePos)
                {
                    ulong prevMask = masksPre[p.x, p.y];
                    ulong nextMask = TileMaskAt(s, p);
                    toggles.Add(new TileTraitDelta { pos = new Vec2i { x = p.x, y = p.y }, traitsPrevMask = prevMask, traitsNextMask = nextMask });
                }

                bool exitNext = SlimeGrid.Logic.Engine.AllAllowExitPressed(s);
                bool anyBtnNext = s.AnyButtonPressed;

                steps[i] = new TraceStep
                {
                    input = input,
                    moveKind = moveKind,
                    tilesMoved = tilesMoved <= 0 ? 1 : tilesMoved,
                    playerFrom = new Vec2i { x = from.x, y = from.y },
                    playerTo = new Vec2i { x = to.x, y = to.y },
                    playerOnSlipPrev = slipPrev,
                    playerOnSlipNext = slipNext,
                    playerDestTraitsMask = playerToMask,
                    moved = moved.ToArray(),
                    tileDeltas = toggles.ToArray(),
                    exitActivePrev = exitPrev,
                    exitActiveNext = exitNext,
                    anyButtonPrev = anyBtnPrev,
                    anyButtonNext = anyBtnNext
                };
            }

            return new SolutionTrace { which = which, steps = steps };
        }

        static GameState CloneState(GameState s)
        {
            var c = new GameState
            {
                Grid = CloneGrid(s.Grid),
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

        // Diagnostic: run a BFS pass and return the visited dictionary (minimal depth per key)
        public static Dictionary<StateKey, int> CollectVisitedBfs(GameState initial, SolverConfig cfg)
        {
            var ctx = StateHasher.BuildLevelContext(initial.Grid);
            var visited = new Dictionary<StateKey, int>(4096);
            var rootKey = StateHasher.ComputeZobrist(initial, ctx);
            visited[rootKey] = 0;

            var q = new Queue<(GameState s, StateKey key, int depth)>();
            q.Enqueue((CloneState(initial), rootKey, 0));

            var sw = Stopwatch.StartNew();
            int nodes = 0;
            while (q.Count > 0)
            {
                if (cfg.EnforceTimeCap && sw.Elapsed.TotalSeconds > cfg.TimeCapSeconds) break;
                var (state, key, depth) = q.Dequeue();
                nodes++; if (nodes >= cfg.NodesCap) break;
                if (depth >= cfg.DepthCap) continue;

                foreach (var dir in DIRS)
                {
                    var child = CloneState(state);
                    var __ = Engine.Step(child, dir, out SlimeGrid.Logic.Engine.StepEffects eff);
                    var childKey = StateHasher.ComputeZobrist(child, ctx);
                    bool onlyKeyEq = childKey.Equals(key);
                    bool isNoOp = (eff == SlimeGrid.Logic.Engine.StepEffects.None) && onlyKeyEq;
                    if (isNoOp) continue;

                    int newDepth = depth + 1;
                    // Use strict visited (no relax) so we expose true minimal depths
                    if (visited.TryGetValue(childKey, out var seen) && seen <= newDepth) continue;
                    visited[childKey] = newDepth;
                    if (!child.GameOver && !child.Win)
                        q.Enqueue((child, childKey, newDepth));
                }
            }
            return visited;
        }
    }
}
#endif

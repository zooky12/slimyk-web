#if UNITY_EDITOR || EXPOSE_WASM
using System.Collections.Generic;
using SlimeGrid.Logic;

namespace SlimeGrid.Tools.Solver
{
    public static class DeadEndAnalyzer
    {
        // Replays path to reach the dead-end state, then explores locally to compute
        // the maximum further legal moves without reaching Win, stopping on local revisits.
        public static int ComputeDeadEndDepth(GameState root, LevelContext ctx, in PackedMoves path)
        {
            var s = BruteForceSolverReplay.CloneState(root);
            for (int i = 0; i < path.Length; i++)
            {
                var d = (Dir)path.GetAt(i);
                Engine.Step(s, d);
            }

            var localVisited = new HashSet<StateKey>(128);
            var startKey = StateHasher.Compute(s, ctx);
            localVisited.Add(startKey);

            int maxDepth = 0;
            var stack = new Stack<Frame>(128);
            stack.Push(new Frame(BruteForceSolverReplay.CloneState(s), 0, 0));

            while (stack.Count > 0)
            {
                var f = stack.Pop();
                if (f.NextIdx >= 4)
                {
                    if (f.Depth > maxDepth) maxDepth = f.Depth;
                    if (stack.Count > 0)
                    {
                        var p = stack.Pop();
                        // keep parent's depth
                        stack.Push(p);
                    }
                    continue;
                }

                var dir = (Dir)f.NextIdx; // 0..3 == N,E,S,W (enum values)
                f.NextIdx++;
                stack.Push(f);

                var child = BruteForceSolverReplay.CloneState(f.State);
                Engine.Step(child, dir);
                var ck = StateHasher.Compute(child, ctx);
                if (localVisited.Contains(ck)) continue; // loop stops here
                if (child.Win || child.GameOver) continue; // terminal stop

                localVisited.Add(ck);
                stack.Push(new Frame(child, 0, f.Depth + 1));
            }

            return maxDepth;
        }

        struct Frame
        {
            public GameState State;
            public int NextIdx;
            public int Depth;
            public Frame(GameState s, int next, int depth)
            { State = s; NextIdx = next; Depth = depth; }
        }
    }

    internal static class BruteForceSolverReplay
    {
        public static GameState CloneState(GameState s)
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
    }
}
#endif



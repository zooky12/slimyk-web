#if UNITY_EDITOR || EXPOSE_WASM
using System;
using System.Collections.Generic;
using SlimeGrid.Logic;

namespace SlimeGrid.Tools.Solver
{
    public readonly struct StateKey : IEquatable<StateKey>
    {
        public readonly ulong A;
        public readonly ulong B;
        public StateKey(ulong a, ulong b) { A = a; B = b; }
        public bool Equals(StateKey other) => A == other.A && B == other.B;
        public override bool Equals(object obj) => obj is StateKey k && Equals(k);
        public override int GetHashCode() => (int)(A ^ (B * 0x9E3779B97F4A7C15UL));
    }

    // Precomputed level context data used to compute toggle parity and canonical ordering.
    public sealed class LevelContext
    {
        public readonly Grid2D Grid;
        public readonly ToggleCell[] Togglables; // row-major order

        public LevelContext(Grid2D grid, ToggleCell[] togglables)
        { Grid = grid; Togglables = togglables; }
    }

    public readonly struct ToggleCell
    {
        public readonly V2 Pos;
        public readonly bool ByButton;
        public readonly bool ByEntity;
        public readonly bool ByPlayer;
        public ToggleCell(V2 pos, bool byButton, bool byEntity, bool byPlayer)
        { Pos = pos; ByButton = byButton; ByEntity = byEntity; ByPlayer = byPlayer; }
    }

    public static class StateHasher
    {
        const ulong FNV_OFFSET = 1469598103934665603UL;
        const ulong FNV_PRIME = 1099511628211UL;

        static void Mix(ref ulong h, ulong v)
        { h ^= v; h *= FNV_PRIME; }

        public static LevelContext BuildLevelContext(Grid2D grid)
        {
            var list = new List<ToggleCell>();
            for (int y = 0; y < grid.H; y++)
            for (int x = 0; x < grid.W; x++)
            {
                var p = new V2(x, y);
                ref var c = ref grid.CellRef(p);
                if (c.ToggleMask == 0) continue;
                var active = c.ActiveMask;
                bool byButton = (active & Traits.ToggleableByButton) != 0;
                bool byEntity = (active & Traits.ToggleableByEntity) != 0;
                bool byPlayer = (active & Traits.ToggleableByPlayer) != 0;
                if (byButton || byEntity || byPlayer)
                    list.Add(new ToggleCell(p, byButton, byEntity, byPlayer));
            }
            return new LevelContext(grid, list.ToArray());
        }

        static bool ComputeAnyButtonPressed(GameState s)
        {
            foreach (var kv in s.EntitiesById)
            {
                var e = kv.Value;
                if ((e.Traits & Traits.PressesButtons) == 0) continue;
                // Avoid parity read; ButtonToggle bit is static in ActiveMask recipe.
                if ((s.Grid.CellRef(e.Pos).ActiveMask & Traits.ButtonToggle) != 0)
                    return true;
            }
            return false;
        }

        public static StateKey Compute(GameState s, LevelContext ctx)
        {
            // Two parallel FNV hashes for low collision risk.
            ulong h1 = FNV_OFFSET;
            ulong h2 = 0xCBF29CE484222325UL; // different offset

            // 1) Canonicalize entities by (Type, Pos.x, Pos.y, Orientation, Traits)
            var tmp = s.EntitiesById.Count > 0 ? new List<Entity>(s.EntitiesById.Count) : new List<Entity>();
            foreach (var kv in s.EntitiesById) tmp.Add(kv.Value);
            tmp.Sort((a, b) =>
            {
                int c = ((int)a.Type).CompareTo((int)b.Type);
                if (c != 0) return c;
                c = a.Pos.x.CompareTo(b.Pos.x); if (c != 0) return c;
                c = a.Pos.y.CompareTo(b.Pos.y); if (c != 0) return c;
                c = ((int)a.Orientation).CompareTo((int)b.Orientation); if (c != 0) return c;
                return 0; // ignore Traits for canonical ordering
            });

            // Map entity id -> canonical index
            var idToIdx = new Dictionary<int, int>(tmp.Count);
            for (int i = 0; i < tmp.Count; i++) idToIdx[tmp[i].Id] = i;

            // 2) Player core fields
            Mix(ref h1, (ulong)(uint)s.PlayerPos.x); Mix(ref h2, (ulong)(uint)s.PlayerPos.y);
            int attachedIdx = s.AttachedEntityId.HasValue && idToIdx.TryGetValue(s.AttachedEntityId.Value, out var idx) ? idx : -1;
            Mix(ref h1, (ulong)(attachedIdx + 1)); // -1 -> 0
            Mix(ref h2, (ulong)(s.EntryDir.HasValue ? (byte)s.EntryDir.Value + 1 : 0));

            // 3) Canonical entity list
            foreach (var e in tmp)
            {
                Mix(ref h1, (ulong)(byte)e.Type);
                Mix(ref h1, (ulong)(uint)e.Pos.x); Mix(ref h1, (ulong)(uint)e.Pos.y);
                Mix(ref h1, (ulong)(byte)e.Orientation);

                Mix(ref h2, (ulong)(byte)e.Type * 1315423911UL);
                Mix(ref h2, (ulong)(((uint)e.Pos.x << 16) ^ (uint)(e.Pos.y)));
                Mix(ref h2, (ulong)(byte)e.Orientation * 1099511628211UL);
            }

            // 4) Toggle parity signature (derived from positions)
            bool anyBtn = ComputeAnyButtonPressed(s);
            foreach (var t in ctx.Togglables)
            {
                bool on = (t.ByButton && anyBtn);
                if (t.ByEntity && s.EntityAt.ContainsKey(t.Pos)) on ^= true;
                if (t.ByPlayer && t.Pos.Equals(s.PlayerPos)) on ^= true;
                Mix(ref h1, on ? 0xFFUL : 0x1UL);
                Mix(ref h2, on ? 0xA5A5A5A5A5A5A5A5UL : 0x5A5A5A5A5A5A5A5AUL);
            }

            return new StateKey(h1, h2);
        }
    }
}
#endif

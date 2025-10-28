using System;

namespace SlimeGrid.Logic
{
    public static class TraitsUtil
    {
        /// Tile-only mask (no entity OR), with stateless parity-XOR applied.
        public static Traits ResolveTileMask(GameState s, V2 p)
        {
            if (!s.Grid.InBounds(p))
                return Traits.StopsPlayer | Traits.StopsEntity | Traits.StopsFlight;

            ref var cell = ref s.Grid.CellRef(p);
            Traits m = cell.ActiveMask;

            if (cell.ToggleMask != 0)
            {
                if ((m & Traits.ToggleableByButton) != 0 && s.AnyButtonPressed) m ^= cell.ToggleMask;
                if ((m & Traits.ToggleableByEntity) != 0 && s.EntityAt.ContainsKey(p)) m ^= cell.ToggleMask;
                if ((m & Traits.ToggleableByPlayer) != 0 && p.Equals(s.PlayerPos)) m ^= cell.ToggleMask;
            }
            return m;
        }

        /// Full effective mask = tile (after toggles) OR entity traits (if present).
        /// Use this only when entity traits should also block (e.g., StopsPlayer from an entity).
        public static Traits ResolveEffectiveMask(GameState s, V2 p)
        {
            var m = ResolveTileMask(s, p);
            if (s.EntityAt.TryGetValue(p, out var id))
                m |= s.EntitiesById[id].Traits;
            return m;
        }

        // Convenience tests (keep the precedence “stop > stick > pass” in mind at call sites)
        public static bool TileStopsPlayer(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsPlayer) != 0;
        public static bool TileStopsEntity(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsEntity) != 0;
        public static bool TileSticksEntity(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.SticksEntity) != 0;
        public static bool TileStopsTumble(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsTumble) != 0;
        public static bool TileStopsFlight(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsFlight) != 0;
        public static bool TileSticksFlight(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.SticksFlight) != 0;
        public static bool TileIsSlippery(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.Slipery) != 0;
    }
}

using System;

namespace SlimeGrid.Logic
{
    public static class TraitsUtil
    {
        // Tile-only mask (no entity OR), derived from the current tile type.
        public static Traits ResolveTileMask(GameState s, V2 p)
        {
            if (!s.Grid.InBounds(p))
                return Traits.StopsPlayer | Traits.StopsEntity | Traits.StopsFlight;

            ref var cell = ref s.Grid.CellRef(p);
            return TileTraits.For(cell.Type).Active;
        }

        // Full effective mask = tile traits OR entity traits (if present).
        public static Traits ResolveEffectiveMask(GameState s, V2 p)
        {
            var m = ResolveTileMask(s, p);
            if (s.EntityAt.TryGetValue(p, out var id))
                m |= s.EntitiesById[id].Traits;
            return m;
        }

        // Convenience tests
        public static bool TileStopsPlayer(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsPlayer) != 0;
        public static bool TileStopsEntity(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsEntity) != 0;
        public static bool TileSticksEntity(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.SticksEntity) != 0;
        public static bool TileStopsTumble(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsTumble) != 0;
        public static bool TileStopsFlight(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.StopsFlight) != 0;
        public static bool TileSticksFlight(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.SticksFlight) != 0;
        public static bool TileIsSlipperyForPlayer(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.SlipperyForPlayer) != 0;
        public static bool TileIsSlipperyForEntity(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & Traits.SlipperyForEntity) != 0;
        // Back-compat helper (treat as slippery for either)
        public static bool TileIsSlippery(GameState s, V2 p) => (ResolveEffectiveMask(s, p) & (Traits.SlipperyForPlayer | Traits.SlipperyForEntity)) != 0;
    }
}

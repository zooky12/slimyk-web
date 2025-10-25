using System.Collections.Generic;
using static SlimeGrid.Logic.Traits;

namespace SlimeGrid.Logic
{
    public readonly struct TT
    {
        public readonly Traits Active;
        public readonly Traits? Inactive;
        public TT(Traits active, Traits? inactive = null) { Active = active; Inactive = inactive; }

        public static TT Of(Traits active, Traits? inactive = null) => new(active, inactive);

        public static TT operator |(TT a, Traits add) =>
            new TT(a.Active | add, a.Inactive.HasValue ? a.Inactive.Value | add : (Traits?)null);

        public static TT operator -(TT a, Traits rem) =>
            new TT(a.Active & ~rem, a.Inactive.HasValue ? a.Inactive.Value & ~rem : (Traits?)null);

        public static TT operator ^(TT a, Traits xor) =>
            new TT(a.Active ^ xor, a.Inactive.HasValue ? a.Inactive.Value ^ xor : (Traits?)null);

        public static TT operator |(TT a, TT b)
        {
            var active = a.Active | b.Active;
            Traits? inactive = (a.Inactive.HasValue, b.Inactive.HasValue) switch
            {
                (true, true) => a.Inactive.Value | b.Inactive.Value,
                (true, false) => a.Inactive,
                (false, true) => b.Inactive,
                _ => null
            };
            return new TT(active, inactive);
        }
    }

    public static class TileTraits
    {
        // Base constants
        public static readonly TT Floor = TT.Of(None);
        public static readonly TT Wall = TT.Of(StopsPlayer | StopsEntity | StopsFlight);
        public static readonly TT Hole = TT.Of(HoleForPlayer | HoleForEntity);
        public static readonly TT Spike = TT.Of(SticksFlight | StopsEntity | SticksEntity | ToggleableByButton, inactive: ToggleableByButton);
        public static readonly TT Grill = TT.Of(HoleForPlayer);
        public static readonly TT SlimPath = TT.Of(StopsEntity);
        public static readonly TT ExitTile = TT.Of(ExitPlayer);
        public static readonly TT BtnAllow = TT.Of(ButtonAllowExit);
        public static readonly TT BtnToggle = TT.Of(ButtonToggle);

        // Ice variants = base | Slipery
        public static readonly TT Ice = TT.Of(Slipery);
        public static readonly TT IceSpike = TT.Of(Spike.Active, inactive: Spike.Inactive | Slipery);
        public static readonly TT IceGrill = Grill | Slipery;
        public static readonly TT IceSlimPath = SlimPath | Slipery;
        public static readonly TT IceExit = ExitTile | Slipery;

        // Composed variants
        public static readonly TT SpikeHole = TT.Of(Spike.Active | HoleForPlayer, inactive: Spike.Inactive | HoleForPlayer | HoleForEntity);
        public static readonly TT SlimPathHole = SlimPath | Hole;

        public static readonly Dictionary<TileType, TT> Map = new Dictionary<TileType, TT>
        {
            [TileType.Floor] = Floor,
            [TileType.Wall] = Wall,
            [TileType.Hole] = Hole,

            [TileType.Spike] = Spike,
            [TileType.SpikeHole] = SpikeHole,

            [TileType.Grill] = Grill,

            [TileType.SlimPath] = SlimPath,
            [TileType.SlimPathHole] = SlimPathHole,

            [TileType.Ice] = Ice,
            [TileType.IceSpike] = IceSpike,
            [TileType.IceGrill] = IceGrill,
            [TileType.IceSlimPath] = IceSlimPath,
            [TileType.IceExit] = IceExit,

            [TileType.Exit] = ExitTile,

            [TileType.ButtonAllowExit] = BtnAllow,
            [TileType.ButtonToggle] = BtnToggle,
        };

        public static TT For(TileType t) => Map.TryGetValue(t, out var def) ? def : TT.Of(None);
    }
}

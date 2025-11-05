using System.Collections.Generic;
using static SlimeGrid.Logic.Traits;

namespace SlimeGrid.Logic
{
    public readonly struct TT
    {
        public readonly Traits Active;
        public readonly TileType? ToggledTo; // optional pair tile to swap into
        public TT(Traits active, TileType? toggledTo = null) { Active = active; ToggledTo = toggledTo; }

        public static TT Of(Traits active, TileType? toggledTo = null) => new(active, toggledTo);

        public static TT operator |(TT a, Traits add) => new TT(a.Active | add, a.ToggledTo);
        public static TT operator -(TT a, Traits rem) => new TT(a.Active & ~rem, a.ToggledTo);
        public static TT operator ^(TT a, Traits xor) => new TT(a.Active ^ xor, a.ToggledTo);

        public static TT operator |(TT a, TT b)
        {
            var active = a.Active | b.Active;
            var toggled = a.ToggledTo ?? b.ToggledTo;
            return new TT(active, toggled);
        }
    }

    public static class TileTraits
    {
        // Base constants
        public static readonly TT Floor = TT.Of(None);
        public static readonly TT Wall = TT.Of(StopsPlayer | StopsEntity | StopsFlight);
        public static readonly TT Hole = TT.Of(HoleForPlayer | HoleForEntity);
        public static readonly TT Spike = TT.Of(SticksFlight | StopsEntity | SticksEntity | ToggleableByButton, toggledTo: TileType.InactiveSpike);
        public static readonly TT InactiveSpike = TT.Of(UntoggleableByButton, toggledTo: TileType.Spike);
        public static readonly TT Grill = TT.Of(HoleForPlayer);
        public static readonly TT SlimPath = TT.Of(StopsEntity);
        public static readonly TT ExitTile = TT.Of(ExitPlayer);
        public static readonly TT BtnAllow = TT.Of(ButtonAllowExit);
        public static readonly TT BtnToggle = TT.Of(ButtonToggle);

        // Ice variants = base | SlipperyForPlayer | SlipperyForEntity
        public static readonly TT Ice = TT.Of(SlipperyForPlayer | SlipperyForEntity);
        public static readonly TT IceSpike = TT.Of(Spike.Active | Ice.Active ^ SlipperyForPlayer, toggledTo: TileType.InactiveIceSpike);
        public static readonly TT InactiveIceSpike = TT.Of(InactiveSpike.Active | Ice.Active, toggledTo: TileType.IceSpike);
        public static readonly TT IceGrill = Grill | Ice.Active ^ SlipperyForPlayer;
        public static readonly TT IceSlimPath = SlimPath | Ice.Active;
        public static readonly TT IceExit = ExitTile | Ice.Active;

        // Composed variants
        public static readonly TT SpikeHole = TT.Of(Spike.Active | HoleForPlayer, toggledTo: TileType.InactiveSpikeHole);
        public static readonly TT InactiveSpikeHole = TT.Of(InactiveSpike.Active | Hole.Active, toggledTo: TileType.SpikeHole);
        public static readonly TT SlimPathHole = SlimPath | Hole;

        public static readonly Dictionary<TileType, TT> Map = new Dictionary<TileType, TT>
        {
            [TileType.Floor] = Floor,
            [TileType.Wall] = Wall,
            [TileType.Hole] = Hole,

            [TileType.Spike] = Spike,
            [TileType.InactiveSpike] = InactiveSpike,
            [TileType.SpikeHole] = SpikeHole,
            [TileType.InactiveSpikeHole] = InactiveSpikeHole,

            [TileType.Grill] = Grill,

            [TileType.SlimPath] = SlimPath,
            [TileType.SlimPathHole] = SlimPathHole,

            [TileType.Ice] = Ice,
            [TileType.IceSpike] = IceSpike,
            [TileType.InactiveIceSpike] = InactiveIceSpike,
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

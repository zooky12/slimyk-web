// File: Assets/Code/Logic/Core.cs
// Scope: primitives + flags + metadata identifiers (NO game rules)

using System;
using System.Runtime.CompilerServices;

namespace SlimeGrid.Logic
{
    // ---- Directions ---------------------------------------------------------

    public enum Dir : byte { N = 0, E = 1, S = 2, W = 3 }

    public static class DirX
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static (int dx, int dy) Vec(this Dir d) => d switch
        {
            Dir.N => (0, 1),
            Dir.E => (1, 0),
            Dir.S => (0, -1),
            _ => (-1, 0)
        };

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static Dir Opposite(this Dir d) => (Dir)(((int)d + 2) & 3);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static Dir RotateCW(this Dir d) => (Dir)(((int)d + 1) & 3);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static Dir RotateCCW(this Dir d) => (Dir)(((int)d + 3) & 3);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static Dir FromDelta(int dx, int dy)
        {
            if (Math.Abs(dx) >= Math.Abs(dy))
                return dx >= 0 ? Dir.E : Dir.W;
            return dy >= 0 ? Dir.N : Dir.S;
        }
    }

    // ---- 2D integer vector (grid coords) -----------------------------------

    public readonly struct V2 : IEquatable<V2>
    {
        public readonly int x, y;
        public V2(int x, int y) { this.x = x; this.y = y; }

        public static V2 operator +(V2 a, V2 b) => new(a.x + b.x, a.y + b.y);
        public static V2 operator +(V2 a, (int dx, int dy) v) => new(a.x + v.dx, a.y + v.dy);
        public static V2 operator -(V2 a, V2 b) => new(a.x - b.x, a.y - b.y);

        public bool Equals(V2 o) => x == o.x && y == o.y;
        public override bool Equals(object o) => o is V2 v && Equals(v);
        public override int GetHashCode() => (x * 397) ^ y;
        public override string ToString() => $"({x},{y})";
    }

    // ---- Orientations -------------------------------------------------------

    public enum Orientation : byte { N = 0, E = 1, S = 2, W = 3 }
    public enum OrientationTriangular : byte { NE = 0, SE = 1, SW = 2, NW = 3 }

    public static class OrientationX
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static Dir ToDir(this Orientation o) => (Dir)o;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static OrientationTriangular ToTri(this Orientation o) => o switch
        {
            Orientation.N => OrientationTriangular.NE,
            Orientation.E => OrientationTriangular.SE,
            Orientation.S => OrientationTriangular.SW,
            _ => OrientationTriangular.NW
        };

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static (Dir a, Dir b) FaceDirs(this OrientationTriangular t) => t switch
        {
            OrientationTriangular.NE => (Dir.N, Dir.E),
            OrientationTriangular.SE => (Dir.S, Dir.E),
            OrientationTriangular.SW => (Dir.S, Dir.W),
            _ => (Dir.N, Dir.W)
        };
    }

    // ---- Trait flags (64-bit for headroom) ----------------------------------

    [Flags]
    public enum Traits : ulong
    {
        None = 0,

        // Collisions / motion (0..15)
        StopsPlayer = 1UL << 0,
        StopsEntity = 1UL << 1,  // (renamed from StopsBox)
        StopsFlight = 1UL << 2,
        SticksFlight = 1UL << 3,
        SticksEntity = 1UL << 4,
        StopsTumble = 1UL << 5,
        Slipery = 1UL << 6,  // ice-like slip

        // Holes (8..15)
        HoleForEntity = 1UL << 8,  // (renamed from HoleForBox)
        HoleForPlayer = 1UL << 9,

        // Identity / interaction (16..23)
        Attachable = 1UL << 16, // player can attach here
        Pushable = 1UL << 17, // participates in push chains
        PressesButtons = 1UL << 18, // counts as weight on buttons
        Breakable = 1UL << 19, // destroyed on hit/flight

        // Goals & toggles (24..31)
        ExitPlayer = 1UL << 24,
        ButtonAllowExit = 1UL << 25, // (kept)
        ButtonToggle = 1UL << 26, // this tile IS a button
        ToggleableByButton = 1UL << 27, // tile flips when any button pressed
        ToggleableByEntity = 1UL << 28, // tile flips while any entity stands on it
        ToggleableByPlayer = 1UL << 29, // tile flips while player stands on it
        ButtonRotateCW = 1UL << 30, // button that rotates CW while pressed
        ButtonRotateCCW = 1UL << 31, // button that rotates CCW while pressed

        // Reserved (32..63)
    }

    // ---- Metadata enums (authoring IDs; logic reads masks) ------------------

    public enum TileType : byte
    {
        Floor = 0, Wall, Hole,
        Spike, SpikeHole,
        Grill,
        SlimPath, SlimPathHole,
        Ice, IceSpike, IceGrill, IceSlimPath, IceExit,
        Exit,
        ButtonAllowExit, ButtonToggle
    }

    public enum EntityType : byte
    {
        PlayerSpawn = 0,
        BoxBasic,
        BoxTriangle,
        BoxTipping,
        BoxUnattachable,   // NEW
        BreakableWall
    }

    // ---- Cell: runtime masks (+ metadata) -----------------------------------

    public sealed class Cell
    {
        // Metadata (debug/tools only)
        public TileType Type;

        // Runtime truth used by logic:
        public Traits ActiveMask;          // current live mask
        public Traits? InactiveMask;       // null => no alternate state
        public Traits ToggleMask; // = (InactiveMask ?? 0) ^ ActiveMask
        public bool Toggled;               // true if tile is flipped
        public Orientation? Orientation;   // null if not oriented
    }
}

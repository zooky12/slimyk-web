// File: Assets/Code/Logic/State.cs
// Scope: runtime world state (grid, entities, lookups) + parity-XOR EffectiveTraitsAt

using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    // ---------- Grid ---------------------------------------------------------

    public sealed class Grid2D
    {
        public readonly int W;
        public readonly int H;
        private readonly Cell[] _cells;

        public Grid2D(int w, int h)
        {
            W = w; H = h;
            _cells = new Cell[W * H];
            for (int i = 0; i < _cells.Length; i++)
                _cells[i] = new Cell(); // Core.Cell (from Core.cs)
        }

        public bool InBounds(V2 p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;

        public ref Cell CellRef(V2 p) => ref _cells[p.y * W + p.x];

        public void SetCell(V2 p, in Cell c) => _cells[p.y * W + p.x] = c;
    }

    // ---------- Entity (single model; id != type) ----------------------------

    public sealed class Entity
    {
        // Unique instance handle for this level (NOT the type).
        public int Id;

        // Authoring/metadata kind (BoxBasic, BoxUnattachable, BreakableWall, ...)
        public EntityType Type;

        // Runtime fields
        public V2 Pos;

        // Traits drive all collisions/reactions (Attachable, Pushable, PressesButtons, Breakable, ...)
        public Traits Traits;

        // For oriented behaviors/visuals
        public Orientation Orientation;

        // Which attached behavior to use when the player is on this entity.
        public BehaviorId Behavior;
    }

    // ---------- Game state ---------------------------------------------------

    public sealed class GameState
    {
        public Grid2D Grid;

        // Entities
        public readonly Dictionary<int, Entity> EntitiesById = new Dictionary<int, Entity>();
        public readonly Dictionary<V2, int> EntityAt = new Dictionary<V2, int>(); // pos -> entity Id

        // Player (kept separate so the player can share a cell with an entity when attached)
        public V2 PlayerPos;
        public int? AttachedEntityId;   // null if free
        public Dir? EntryDir;           // direction used to attach (null => over-top)
        public Dir LastMoveDir;


        // Global buttons (recomputed each step)
        public bool AnyButtonPressed;
        public bool LastAnyButtonPressed;  // for ButtonStateChanged deltas only (masks still parity-based)
        public bool GameOver;
        public bool Win;


        // Convenience
        public bool HasEntityAt(V2 p) => EntityAt.ContainsKey(p);

        public Entity TryGetEntityAt(V2 p)
        {
            int id;
            return EntityAt.TryGetValue(p, out id) ? EntitiesById[id] : null;
        }

        /// <summary>
        /// Effective tile+entity traits at cell p using stateless parity-XOR for toggles.
        /// </summary>
        public Traits EffectiveTraitsAt(V2 p)
        {
            return TraitsUtil.ResolveEffectiveMask(this, p);
        }
    }
}

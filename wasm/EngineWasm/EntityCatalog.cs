// File: Assets/Code/Logic/EntityCatalog.cs
// Scope: invariant mapping from EntityType -> (Traits, BehaviorId) + spawn helper.

using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    public readonly struct EntityDef
    {
        public readonly Traits Traits;
        public readonly BehaviorId Behavior;
        public EntityDef(Traits traits, BehaviorId behavior)
        { Traits = traits; Behavior = behavior; }
    }

    public static class EntityCatalog
    {
        // Invariant definitions (one place to change global entity rules)
        // NOTE: Keep these aligned with your design docs.
        public static readonly Dictionary<EntityType, EntityDef> Map = new()
        {
            // Boxes the player can attach to (share cell)
            [EntityType.BoxBasic] = new EntityDef(
                traits: Traits.Attachable | Traits.Pushable | Traits.PressesButtons | Traits.SticksFlight | Traits.StopsTumble,
                behavior: BehaviorId.Basic),

            [EntityType.BoxTriangle] = new EntityDef(
                traits: Traits.Attachable | Traits.Pushable | Traits.PressesButtons | Traits.SticksFlight | Traits.StopsTumble,
                behavior: BehaviorId.Triangle),

            [EntityType.BoxTipping] = new EntityDef(
                traits: Traits.Attachable | Traits.Pushable | Traits.PressesButtons | Traits.SticksFlight | Traits.StopsTumble,
                behavior: BehaviorId.Tipping),

            // Unattachable box: can be pushed, presses buttons, but blocks player/flight and cannot be attached
            [EntityType.BoxUnattachable] = new EntityDef(
                traits: Traits.Pushable | Traits.PressesButtons | Traits.StopsPlayer | Traits.StopsFlight | Traits.StopsTumble,
                behavior: BehaviorId.None),

            // Breakable wall entity (blocks until destroyed by flight)
            [EntityType.BreakableWall] = new EntityDef(
                traits: Traits.Breakable | Traits.StopsPlayer | Traits.StopsEntity | Traits.StopsFlight,
                behavior: BehaviorId.None),

            // PlayerSpawn is metadata; no runtime entity is created for it
            [EntityType.PlayerSpawn] = new EntityDef(
                traits: Traits.None,
                behavior: BehaviorId.None),
        };

        // -------- Spawn helper ------------------------------------------------

        // Simple id allocator; you can move this to GameState later if you prefer.
        static int _nextId = 1;

        public static Entity Spawn(GameState s, EntityType type, V2 pos)
        {
            var def = Map[type];

            var e = new Entity
            {
                Id = _nextId++,
                Type = type,
                Pos = pos,
                Traits = def.Traits,
                Orientation = Orientation.N, // default; your loader can override
                Behavior = def.Behavior
            };

            s.EntitiesById[e.Id] = e;
            s.EntityAt[pos] = e.Id;
            return e;
        }
    }
}

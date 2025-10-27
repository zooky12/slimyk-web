using System;
using SlimeGrid.Logic;

namespace SlimeGrid.Logic
{
    // Editor/runtime level edit helpers for GameState
    // Kinds are intentionally minimal and orthogonal.
    public enum EditKind : int { SetTile = 0, PlaceEntity = 1, Remove = 2, MovePlayer = 3, RotateEntity = 4 }

    public static class EditOps
    {
        // Overload for loosely-typed callers (e.g., JS bridge)
        public static bool Apply(GameState s, int kind, int x, int y, int type, int rot, out string err)
            => Apply(s, (EditKind)kind, x, y, type, rot, out err);

        // Strongly-typed core
        public static bool Apply(GameState s, EditKind kind, int x, int y, int id, int rot, out string err)
        {
            err = "";
            var p = new V2(x, y);
            if (!s.Grid.InBounds(p)) { err = "Out of bounds"; return false; }

            switch (kind)
            {
                case EditKind.SetTile:
                    return SetTile(s, p, (TileType)id, (Orientation)rot, out err);
                case EditKind.PlaceEntity:
                    return PlaceEntity(s, p, (EntityType)id, (Orientation)rot, out err);
                case EditKind.Remove:
                    return RemoveAt(s, p, out err);
                case EditKind.MovePlayer:
                    return MovePlayer(s, p, out err);
                case EditKind.RotateEntity:
                    return RotateEntity(s, p, id, (Orientation)rot, out err);
                default:
                    err = "Unknown edit kind"; return false;
            }
        }

        static bool SetTile(GameState s, V2 p, TileType t, Orientation rot, out string err)
        {
            err = "";
            ref var cell = ref s.Grid.CellRef(p);
            bool changed = cell.Type != t || cell.Orientation != rot;

            // Save old cell to allow revert on failed guards
            var old = cell;

            cell.Type = t;
            cell.Orientation = rot;

            // same recipe logic as in Loader
            var def = TileTraits.For(t);
            ApplyRecipeToCell(ref cell, def);
            s.Grid.SetCell(p, cell);

            // Guards: reject turning a walkable tile into a blocker/hole under occupants
            var tileMask = TraitsUtil.ResolveTileMask(s, p);
            if (s.EntityAt.ContainsKey(p))
            {
                if ((tileMask & Traits.StopsEntity) != 0) { err = "Entity present; tile stops entities"; cell = old; s.Grid.SetCell(p, cell); return false; }
                if ((tileMask & Traits.HoleForEntity) != 0) { err = "Entity present; tile holes entities"; cell = old; s.Grid.SetCell(p, cell); return false; }
            }
            if (s.PlayerPos.Equals(p))
            {
                if ((tileMask & Traits.StopsPlayer) != 0) { err = "Player on tile; tile stops player"; cell = old; s.Grid.SetCell(p, cell); return false; }
                if ((tileMask & Traits.HoleForPlayer) != 0) { err = "Player on tile; tile holes player"; cell = old; s.Grid.SetCell(p, cell); return false; }
            }

            return changed;
        }

        static bool PlaceEntity(GameState s, V2 p, EntityType type, Orientation rot, out string err)
        {
            err = "";
            // Special-case: PlayerSpawn is metadata; do not create a runtime entity
            if (type == EntityType.PlayerSpawn)
            {
                if (s.HasEntityAt(p)) { err = "Occupied"; return false; }
                var tileMask = TraitsUtil.ResolveTileMask(s, p);
                if ((tileMask & Traits.StopsPlayer) != 0) { err = "Tile blocks player"; return false; }
                s.PlayerPos = p; s.AttachedEntityId = null; s.EntryDir = null; return true;
            }

            if (s.EntityAt.ContainsKey(p)) { err = "Spot occupied"; return false; }
            var tmask = TraitsUtil.ResolveTileMask(s, p);
            if ((tmask & Traits.StopsEntity) != 0) { err = "Tile blocks entities"; return false; }
            if (s.PlayerPos.Equals(p)) { err = "Player present"; return false; }

            var e = EntityCatalog.Spawn(s, type, p);
            e.Orientation = rot;
            return true;
        }

        static bool RemoveAt(GameState s, V2 p, out string err)
        {
            err = "";
            if (s.EntityAt.TryGetValue(p, out var id))
            {
                if (s.AttachedEntityId == id) { s.AttachedEntityId = null; s.EntryDir = null; }
                s.EntityAt.Remove(p); s.EntitiesById.Remove(id);
                return true;
            }

            // Reset tile to Floor if not already
            ref var cell = ref s.Grid.CellRef(p);
            if (cell.Type != TileType.Floor)
            {
                cell.Type = TileType.Floor; cell.Orientation = Orientation.N;
                ApplyRecipeToCell(ref cell, TileTraits.For(TileType.Floor));
                s.Grid.SetCell(p, cell);
                return true;
            }

            err = "Nothing to remove"; return false;
        }

        static bool MovePlayer(GameState s, V2 p, out string err)
        {
            err = "";
            var mask = TraitsUtil.ResolveEffectiveMask(s, p);
            if ((mask & Traits.StopsPlayer) != 0) { err = "Blocked for player"; return false; }
            if (s.HasEntityAt(p)) { err = "Entity present"; return false; }
            bool changed = !s.PlayerPos.Equals(p);
            s.PlayerPos = p; s.AttachedEntityId = null; s.EntryDir = null;
            return changed;
        }

        static bool RotateEntity(GameState s, V2 p, int entityId, Orientation rot, out string err)
        {
            err = "";
            Entity e = null;
            if (entityId > 0)
            {
                if (!s.EntitiesById.TryGetValue(entityId, out e)) { err = "No such entity"; return false; }
            }
            else
            {
                if (!s.EntityAt.TryGetValue(p, out var idAt)) { err = "No entity at cell"; return false; }
                e = s.EntitiesById[idAt];
            }
            bool changed = e.Orientation != rot;
            e.Orientation = rot;
            return changed;
        }

        // helpers
        static void ApplyRecipeToCell(ref Cell cell, TT recipe)
        {
            cell.ActiveMask = recipe.Active;
            cell.InactiveMask = recipe.Inactive;
            cell.ToggleMask = cell.InactiveMask.HasValue ? (cell.ActiveMask ^ cell.InactiveMask.Value) : 0;
            if (cell.InactiveMask.HasValue)
            {
                var cond = (cell.ActiveMask & (Traits.ToggleableByButton | Traits.ToggleableByEntity | Traits.ToggleableByPlayer));
                cell.InactiveMask = cell.InactiveMask.Value | cond;
                cell.ToggleMask = cell.ActiveMask ^ cell.InactiveMask.Value;
            }
            cell.Toggled = false;
        }
    }
}

using System;
using SlimeGrid.Logic;

namespace SlimeGrid.Logic
{
    // keep this for clarity if you want to use it internally
    public enum EditKind : int { SetTile = 0, PlaceEntity = 1, Remove = 2, MovePlayer = 3 }

    public static class EditOps
    {
        // ---- Overload used by Exports.cs (matches your current call site) ----
        public static bool Apply(GameState s, int kind, int x, int y, int type, int rot, out string err)
        {
            string errLocal = "";
            var ok = Apply(s, (EditKind)kind, x, y, type, rot, out errLocal);
            err = errLocal;
            return ok;
        }

        // ---- Strongly-typed core (with err message) ----
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

                default:
                    err = "Unknown edit kind";
                    return false;
            }
        }

        // ---------- operations ----------

        static bool SetTile(GameState s, V2 p, TileType t, Orientation rot, out string err)
        {
            err = "";
            ref var cell = ref s.Grid.CellRef(p);
            bool changed = cell.Type != t || cell.Orientation != rot;

            cell.Type = t;
            cell.Orientation = rot;

            // same mask recipe logic as Loader.ApplyRecipeToCell
            var def = TileTraits.For(t);
            ApplyRecipeToCell(ref cell, def);

            s.Grid.SetCell(p, cell);

            // Optional guard: if an entity stands here and tile stops entities, reject.
            // (comment out if you want to allow turning a walkable tile into a blocker under an entity)
            var tileMask = TraitsUtil.ResolveTileMask(s, p);
            if ((tileMask & Traits.StopsEntity) != 0 && s.EntityAt.ContainsKey(p))
            {
                err = "Entity present; tile stops entities";
                return false;
            }

            // Optional guard: if player stands here and tile stops player, reject.
            if ((tileMask & Traits.StopsPlayer) != 0 && s.PlayerPos.Equals(p))
            {
                err = "Player on tile; tile stops player";
                return false;
            }

            return changed;
        }

        static bool PlaceEntity(GameState s, V2 p, EntityType type, Orientation rot, out string err)
        {
            err = "";
            if (s.EntityAt.ContainsKey(p)) { err = "Spot occupied"; return false; }

            // Don’t place on tiles that stop entities
            var tileMask = TraitsUtil.ResolveTileMask(s, p);
            if ((tileMask & Traits.StopsEntity) != 0) { err = "Tile blocks entities"; return false; }

            // Don’t place where the player currently is
            if (s.PlayerPos.Equals(p)) { err = "Player present"; return false; }

            // Spawn with your catalog signature, then set orientation if needed
            var e = EntityCatalog.Spawn(s, type, p); // (GameState, EntityType, V2)
            e.Orientation = rot;                     // set after spawn

            // Special-case: if placing PlayerSpawn, also move the player here
            if (type == EntityType.PlayerSpawn)
                s.PlayerPos = p;

            return true;
        }

        static bool RemoveAt(GameState s, V2 p, out string err)
        {
            err = "";
            // Remove entity if present
            if (s.EntityAt.TryGetValue(p, out var id))
            {
                if (s.AttachedEntityId.HasValue && s.AttachedEntityId.Value == id)
                {
                    s.AttachedEntityId = null;
                    s.EntryDir = null;
                }
                s.EntityAt.Remove(p);
                s.EntitiesById.Remove(id);
                return true;
            }

            // Otherwise, reset tile back to Floor (or do nothing if you prefer)
            ref var cell = ref s.Grid.CellRef(p);
            if (cell.Type != TileType.Floor)
            {
                cell.Type = TileType.Floor;
                cell.Orientation = Orientation.N;
                ApplyRecipeToCell(ref cell, TileTraits.For(TileType.Floor));
                s.Grid.SetCell(p, cell);
                return true;
            }

            err = "Nothing to remove";
            return false;
        }

        static bool MovePlayer(GameState s, V2 p, out string err)
        {
            err = "";
            if (!s.Grid.InBounds(p)) { err = "Out of bounds"; return false; }

            var mask = TraitsUtil.ResolveEffectiveMask(s, p); // tile + occupying entity traits
            if ((mask & Traits.StopsPlayer) != 0) { err = "Blocked for player"; return false; }
            if (s.HasEntityAt(p)) { err = "Entity present"; return false; }

            s.PlayerPos = p;
            s.AttachedEntityId = null;
            s.EntryDir = null;
            return true;
        }

        // ---------- helpers ----------

        static void ApplyRecipeToCell(ref Cell cell, TT recipe)
        {
            cell.ActiveMask = recipe.Active;
            cell.InactiveMask = recipe.Inactive; // may be null
            cell.ToggleMask = cell.InactiveMask.HasValue ? (cell.ActiveMask ^ cell.InactiveMask.Value) : 0;

            if (cell.InactiveMask.HasValue)
            {
                var cond = (cell.ActiveMask & (Traits.ToggleableByButton | Traits.ToggleableByEntity | Traits.ToggleableByPlayer));
                cell.InactiveMask = cell.InactiveMask.Value | cond;
                cell.ToggleMask = cell.ActiveMask ^ cell.InactiveMask.Value;
            }

            cell.Toggled = false; // reset local flag; parity is stateless in reads
        }
    }
}

// Scope: JSON → GameState (builds Grid2D cells + spawns entities)
// No Unity deps; works in EditMode tests or runtime.

using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;


namespace SlimeGrid.Logic
{
    public static class Loader
    {
        // --------- Public entrypoints ---------------------------------------

        public static GameState FromJson(string json)
        {
            // Detect dto-v2 first (format.kind == "dto-v2" or shape with w/h/tileCodes/tiles)
            try
            {
                var root = JObject.Parse(json);
                var kind = (string?)root["format"]?["kind"];
                bool looksDtoV2 =
                    string.Equals(kind, "dto-v2", StringComparison.OrdinalIgnoreCase) ||
                    (root["w"] is JToken && root["h"] is JToken && root["tileCodes"] is JObject && root["tiles"] is JArray);

                if (looksDtoV2)
                {
                    var dto2 = root.ToObject<LevelDtoV2>();
                    if (dto2 == null) throw new Exception("dto-v2 parse failed.");
                    return FromDtoV2(dto2);
                }
            }
            catch
            {
                // fall through to authoring formats
            }

            // Fallback: current authoring DTOs (tileGrid / tileCharGrid / legacy tiles list)
            var settings = new JsonSerializerSettings
            {
                Converters = { new StringEnumConverter() },
                MissingMemberHandling = MissingMemberHandling.Ignore,
                NullValueHandling = NullValueHandling.Ignore
            };
            var dto = JsonConvert.DeserializeObject<LevelDTO>(json, settings);
            if (dto == null) throw new Exception("Level JSON was null/invalid.");
            return FromDTO(dto);
        }

        public static GameState FromDtoV2(LevelDtoV2 dto)
        {
            if (dto == null) throw new Exception("dto-v2 is null.");
            if (dto.w <= 0 || dto.h <= 0) throw new Exception("dto-v2 w/h must be > 0.");
            if (dto.tiles == null || dto.tiles.Length != dto.w * dto.h)
                throw new Exception("dto-v2 tiles length must equal w*h.");

            // 1) Allocate state & prefill as Floor (explicit default)
            var s = new GameState
            {
                Grid = new Grid2D(dto.w, dto.h),
                PlayerPos = new V2(0, 0),
                AnyButtonPressed = false,
                LastAnyButtonPressed = false
            };

            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    var cell = new Cell
                    {
                        Type = TileType.Floor,
                        Orientation = Orientation.N,
                        Toggled = false
                    };
                    ApplyRecipeToCell(ref cell, TileTraits.For(TileType.Floor));
                    s.Grid.SetCell(p, cell);
                }

            // 2) Build code -> TileType mapping using slugs (robust to renames)
            var tileCodeToType = new Dictionary<int, TileType>();
            foreach (var kv in dto.tileCodes ?? Enumerable.Empty<KeyValuePair<string, string>>())
            {
                if (!int.TryParse(kv.Key, out var code)) continue;
                if (TryMapSlugToEnum<TileType>(kv.Value, out var ttype))
                    tileCodeToType[code] = ttype;
            }

            // 3) Apply tiles
            for (int y = 0; y < dto.h; y++)
            {
                for (int x = 0; x < dto.w; x++)
                {
                    int code = dto.tiles[y * dto.w + x];
                    var p = new V2(x, y);

                    // Unknown codes default to Floor (non-fatal)
                    if (!tileCodeToType.TryGetValue(code, out var ttype))
                        ttype = TileType.Floor;

                    var cell = s.Grid.CellRef(p);
                    cell.Type = ttype;
                    ApplyRecipeToCell(ref cell, TileTraits.For(ttype));
                    s.Grid.CellRef(p) = cell;
                }
            }

            // 4) Player position (optional)
            if (dto.player != null)
            {
                s.PlayerPos = new V2(dto.player.x, dto.player.y);
            }

            // 5) Entities
            var entCodeToType = new Dictionary<int, EntityType>();
            foreach (var kv in dto.entityCodes ?? Enumerable.Empty<KeyValuePair<string, string>>())
            {
                if (!int.TryParse(kv.Key, out var code)) continue;
                if (TryMapSlugToEnum<EntityType>(kv.Value, out var etype))
                    entCodeToType[code] = etype;
            }

            if (dto.entities != null)
            {
                foreach (var e in dto.entities)
                {
                    if (!entCodeToType.TryGetValue(e.type, out var etype))
                        continue; // unknown entity types are ignored gracefully

                    if (etype == EntityType.PlayerSpawn)
                    {
                        s.PlayerPos = new V2(e.x, e.y);
                        continue;
                    }

                    var ent = EntityCatalog.Spawn(s, etype, new V2(e.x, e.y));

                    if (e.rot.HasValue)
                        ent.Orientation = RotIntToOrientation(e.rot.Value);
                }
            }

            return s;
        }

        public static GameState FromDTO(LevelDTO dto)
        {
            // 0) If grid-based schema is used, infer width/height
            if (dto.tileGrid != null && dto.tileGrid.Length > 0)
            {
                dto.height = dto.tileGrid.Length;
                dto.width = dto.tileGrid[0].Length;
            }
            else if (dto.tileCharGrid != null && dto.tileCharGrid.Length > 0)
            {
                dto.height = dto.tileCharGrid.Length;
                dto.width = dto.tileCharGrid[0].Length;
                if (dto.legend == null)
                    throw new System.Exception("tileCharGrid provided but no legend mapping present.");
            }

            if (dto.width <= 0 || dto.height <= 0)
                throw new System.Exception("Level width/height must be > 0 (provide via grid or fields).");

            // 1) Allocate state
            var s = new GameState
            {
                Grid = new Grid2D(dto.width, dto.height),
                PlayerPos = new V2(0, 0),
                AnyButtonPressed = false,
                LastAnyButtonPressed = false // ensure button edge events are correct
            };

            // 2) Prefill entire grid as Floor (explicit default)
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    var cell = new Cell
                    {
                        Type = TileType.Floor,
                        Orientation = Orientation.N,
                        Toggled = false
                    };
                    ApplyRecipeToCell(ref cell, TileTraits.For(TileType.Floor));
                    s.Grid.SetCell(p, cell);
                }

            // 3) Grid-based authoring (preferred)
            if (dto.tileGrid != null && dto.tileGrid.Length > 0)
            {
                for (int y = 0; y < dto.tileGrid.Length; y++)
                {
                    var row = dto.tileGrid[y];
                    if (row == null) continue;
                    for (int x = 0; x < row.Length; x++)
                    {
                        var name = row[x];
                        if (string.IsNullOrEmpty(name)) continue;

                        if (!Enum.TryParse<TileType>(name, true, out var ttype))
                            throw new System.Exception($"Unknown TileType '{name}' at ({x},{y}).");

                        var p = new V2(x, y);
                        var cell = s.Grid.CellRef(p);
                        cell.Type = ttype;
                        ApplyRecipeToCell(ref cell, TileTraits.For(ttype));
                        s.Grid.CellRef(p) = cell;
                    }
                }
            }
            // 4) Compact letter grid + legend (optional)
            else if (dto.tileCharGrid != null && dto.tileCharGrid.Length > 0)
            {
                for (int y = 0; y < dto.tileCharGrid.Length; y++)
                {
                    var row = dto.tileCharGrid[y];
                    if (row == null) continue;
                    for (int x = 0; x < row.Length; x++)
                    {
                        var key = row[x].ToString();
                        if (!dto.legend.TryGetValue(key, out var typeName))
                            throw new System.Exception($"Legend missing mapping for '{key}' at ({x},{y}).");

                        if (!Enum.TryParse<TileType>(typeName, true, out var ttype))
                            throw new System.Exception($"Unknown TileType '{typeName}' mapped from '{key}' at ({x},{y}).");

                        var p = new V2(x, y);
                        var cell = s.Grid.CellRef(p);
                        cell.Type = ttype;
                        ApplyRecipeToCell(ref cell, TileTraits.For(ttype));
                        s.Grid.CellRef(p) = cell;
                    }
                }
            }

            // 5) Legacy sparse list (x,y,type) overrides—applied last
            if (dto.tiles != null)
            {
                foreach (var t in dto.tiles)
                {
                    var p = new V2(t.x, t.y);
                    if (!s.Grid.InBounds(p)) continue;

                    var cell = s.Grid.CellRef(p);

                    var def = TileTraits.For(t.type);
                    cell.Type = t.type;
                    cell.ActiveMask = def.Active;
                    cell.InactiveMask = def.Inactive; // may be null

                    // Per-instance togglers (your rule: set the condition bit on Active)
                    if (t.toggleByButton) cell.ActiveMask |= Traits.ToggleableByButton;
                    if (t.toggleByEntity) cell.ActiveMask |= Traits.ToggleableByEntity;
                    if (t.toggleByPlayer) cell.ActiveMask |= Traits.ToggleableByPlayer;

                    // Optional per-cell orientation
                    if (t.orientation.HasValue) cell.Orientation = t.orientation.Value;

                    // Optional per-cell inactive override via composition (add/remove/xor)
                    if (t.inactiveAdd.HasValue || t.inactiveRemove.HasValue || t.inactiveXor.HasValue)
                    {
                        var baseInactive = cell.InactiveMask ?? Traits.None;
                        var inactive = baseInactive;
                        if (t.inactiveAdd.HasValue) inactive |= t.inactiveAdd.Value;
                        if (t.inactiveRemove.HasValue) inactive &= ~t.inactiveRemove.Value;
                        if (t.inactiveXor.HasValue) inactive ^= t.inactiveXor.Value;
                        cell.InactiveMask = inactive;
                    }

                    // Precompute toggle mask (parity XOR); 0 if no alternate
                    cell.ToggleMask = cell.InactiveMask.HasValue
                        ? (cell.ActiveMask ^ cell.InactiveMask.Value)
                        : 0;

                    // Keep ToggleableBy* bits present in both masks
                    if (cell.InactiveMask.HasValue)
                    {
                        var cond = (cell.ActiveMask & (Traits.ToggleableByButton | Traits.ToggleableByEntity | Traits.ToggleableByPlayer));
                        cell.InactiveMask = cell.InactiveMask.Value | cond;
                        cell.ToggleMask = cell.ActiveMask ^ cell.InactiveMask.Value;
                    }

                    cell.Toggled = false;
                    s.Grid.SetCell(p, cell);
                }
            }

            // 6) Entities (unchanged)
            if (dto.entities != null)
            {
                foreach (var e in dto.entities)
                {
                    if (e.type == EntityType.PlayerSpawn)
                    {
                        s.PlayerPos = new V2(e.x, e.y);
                        continue;
                    }

                    var ent = EntityCatalog.Spawn(s, e.type, new V2(e.x, e.y));

                    // Optional overrides
                    if (e.orientation.HasValue) ent.Orientation = e.orientation.Value;
                    if (e.behavior.HasValue) ent.Behavior = e.behavior.Value;
                    if (e.traitsAdd.HasValue) ent.Traits |= e.traitsAdd.Value;
                    if (e.traitsRemove.HasValue) ent.Traits &= ~e.traitsRemove.Value;
                    if (e.traitsXor.HasValue) ent.Traits ^= e.traitsXor.Value;
                }
            }

            return s;
        }

        // --------- Helpers ---------------------------------------------------
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
        }
        // ---------- dto-v2 helpers ----------

        static string NormalizeKey(string s) =>
            Regex.Replace(s ?? "", "[^a-zA-Z0-9]", "").ToLowerInvariant();

        static bool TryMapSlugToEnum<TEnum>(string slug, out TEnum value) where TEnum : struct, Enum
        {
            string whole = NormalizeKey(slug);
            // tail after last :, / or .
            var m = Regex.Match(slug ?? "", @"[^:\/\.]+$");
            string tail = NormalizeKey(m.Success ? m.Value : slug);

            foreach (var name in Enum.GetNames(typeof(TEnum)))
            {
                var ek = NormalizeKey(name);
                if ((ek == whole || ek == tail) && Enum.TryParse(name, true, out value))
                    return true;
            }
            value = default;
            return false;
        }


        static Orientation RotIntToOrientation(int rot0to3)
        {
            var r = (rot0to3 & 3);
            return r switch
            {
                0 => Orientation.N,
                1 => Orientation.E,
                2 => Orientation.S,
                _ => Orientation.W
            };
        }

    }


    // --------- JSON DTOs (authoring schema) ----------------------------------
    // ---------- dto-v2 schema (runtime, self-describing) ----------

    public sealed class LevelDtoV2
    {
        public FormatTag format { get; set; } = new();          // { kind:"dto-v2", version:"1.0" } (optional but recommended)
        public int w { get; set; }
        public int h { get; set; }

        public Dictionary<string, string> tileCodes { get; set; } = new();  // code(string) -> slug ("core:floor")
        public int[] tiles { get; set; } = Array.Empty<int>();               // length == w*h

        public Dictionary<string, string> entityCodes { get; set; } = new(); // code(string) -> slug ("core:box")
        public List<EntityDtoV2> entities { get; set; } = new();

        public PlayerDtoV2 player { get; set; } // optional
    }

    public sealed class FormatTag
    {
        public string kind { get; set; } = "";
        public string version { get; set; } = "1.0";
    }

    public sealed class EntityDtoV2
    {
        public int id { get; set; }
        public int type { get; set; }  // code that maps via entityCodes
        public int x { get; set; }
        public int y { get; set; }
        public int? rot { get; set; }  // 0..3 (N,E,S,W)
    }

    public sealed class PlayerDtoV2
    {
        public int x { get; set; }
        public int y { get; set; }
    }

    // Top-level level data
    public sealed class LevelDTO
    {
        public int width { get; set; }
        public int height { get; set; }

        // New grid formats (preferred)
        public string[][] tileGrid { get; set; }             // rows of TileType names
        public string[] tileCharGrid { get; set; }           // rows of chars (compact)
        public Dictionary<string, string> legend { get; set; } = new(); // char -> TileType

        // Legacy sparse list (optional)
        public List<TileDTO> tiles { get; set; } = new();

        public List<EntityDTO> entities { get; set; } = new();
    }

    // A single cell entry (legacy sparse authoring)
    public sealed class TileDTO
    {
        public int x { get; set; }
        public int y { get; set; }
        public TileType type { get; set; }

        // Per-instance togglers (parity XOR will handle the swap at read-time)
        public bool toggleByButton { get; set; }
        public bool toggleByEntity { get; set; }
        public bool toggleByPlayer { get; set; }

        // Optional per-cell orientation (mostly for oriented decorations)
        public Orientation? orientation { get; set; }

        // Optional: tweak the inactive mask via add/remove/xor (advanced use)
        public Traits? inactiveAdd { get; set; }
        public Traits? inactiveRemove { get; set; }
        public Traits? inactiveXor { get; set; }
    }

    // Entity authoring
    public sealed class EntityDTO
    {
        public int x { get; set; }
        public int y { get; set; }
        public EntityType type { get; set; }

        // Optional overrides
        public Orientation? orientation { get; set; }
        public BehaviorId? behavior { get; set; }
        public Traits? traitsAdd { get; set; }
        public Traits? traitsRemove { get; set; }
        public Traits? traitsXor { get; set; }
    }
}

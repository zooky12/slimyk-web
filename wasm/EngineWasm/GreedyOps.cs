using System;
using System.Collections.Generic;
using System.Linq;
using SlimeGrid.Logic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    // Greedy single-edit operators inspired by the old prototype (Place 1 / Remove 1)
    public static class GreedyOps
    {
        public sealed class PlaceOneOptions
        {
            public List<string> tilesPlace { get; set; } = new();
            public List<string> entitiesPlace { get; set; } = new();
            public bool movePlayer { get; set; } = false; // allow relocating PlayerSpawn
            public int maxDepth { get; set; } = 100;
            public int maxNodes { get; set; } = 200000;
        }

        public sealed class RemoveOneOptions
        {
            public List<string> entitiesRemove { get; set; } = new();
            public int maxDepth { get; set; } = 100;
            public int maxNodes { get; set; } = 200000;
        }

        public sealed class GreedyResult
        {
            public bool ok { get; set; }
            public LevelDTO level { get; set; }
            public string err { get; set; }
            public int x { get; set; }
            public int y { get; set; }
            public string tile { get; set; }
            public string entity { get; set; }
            public string orientation { get; set; }
            public int solutions { get; set; }
            public int fastest { get; set; }
            public int deadEnds { get; set; }
        }

        public static GreedyResult PlaceOne(LevelDTO seedDto, PlaceOneOptions opts)
        {
            var seed = Loader.FromDTO(seedDto);
            var cfg = new SolverConfig { DepthCap = opts.maxDepth, NodesCap = opts.maxNodes };

            var W = seed.Grid.W; var H = seed.Grid.H;
            string bestTile = null, bestEntity = null, bestOrient = null;
            int bestX = -1, bestY = -1, bestFast = -1, bestDead = -1, bestSols = int.MaxValue;

            // Helper to compare candidate hardness
            bool Better(int f, int d, int s)
            {
                if (bestFast < 0) return true;
                if (f != bestFast) return f > bestFast;
                if (d != bestDead) return d > bestDead;
                return s < bestSols;
            }

            // Allowed sets (uppercase for enum parsing)
            var tilesAllowed = new HashSet<string>((opts.tilesPlace ?? new()).Select(n => (n ?? string.Empty).Trim()), StringComparer.OrdinalIgnoreCase);
            var entsAllowed = new HashSet<string>((opts.entitiesPlace ?? new()).Select(n => (n ?? string.Empty).Trim()), StringComparer.OrdinalIgnoreCase);

            // Evaluate tile placements
            if (tilesAllowed.Count > 0)
            {
                for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    foreach (var name in tilesAllowed)
                    {
                        if (!Enum.TryParse<TileType>(name, ignoreCase: true, out var tt)) continue;
                        // Skip if unchanged
                        if (seed.Grid.CellRef(new V2(x, y)).Type == tt) continue;
                        var testDto = CloneDTO(seedDto);
                        EnsureGridInitialized(testDto);
                        testDto.tileGrid[y][x] = tt.ToString();
                        var report = BruteForceSolver.AnalyzeBfs(Loader.FromDTO(testDto), cfg);
                        if (report.topSolutions == null || report.topSolutions.Count == 0) continue;
                        int fastest = report.topSolutions[0].length;
                        int deads = report.deadEndsCount;
                        int sols = report.solutionsFilteredCount;
                        if (Better(fastest, deads, sols))
                        {
                            bestX = x; bestY = y; bestTile = tt.ToString(); bestEntity = null; bestOrient = null;
                            bestFast = fastest; bestDead = deads; bestSols = sols;
                        }
                    }
                }
            }

            // Evaluate entity placements
            if (entsAllowed.Count > 0)
            {
                for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    foreach (var name in entsAllowed)
                    {
                        if (!Enum.TryParse<EntityType>(name, ignoreCase: true, out var et)) continue;
                        if (et == EntityType.PlayerSpawn)
                        {
                            if (!opts.movePlayer) continue;
                            // Only place player on tiles acceptable for player
                            var pos = new V2(x, y);
                            // Do not place player on top of an existing entity
                            if (seed.EntityAt.ContainsKey(pos)) continue;
                            var maskp = TraitsUtil.ResolveTileMask(seed, pos);
                            if ((maskp & Traits.StopsPlayer) != 0) continue;
                            if ((maskp & Traits.HoleForPlayer) != 0) continue;
                            var testDto = CloneDTO(seedDto);
                            var list = new List<EntityDTO>(testDto.entities ?? new List<EntityDTO>());
                            list.RemoveAll(e => e != null && e.type == EntityType.PlayerSpawn);
                            list.Add(new EntityDTO { type = EntityType.PlayerSpawn, x = x, y = y });
                            testDto.entities = list;
                            var report = BruteForceSolver.AnalyzeBfs(Loader.FromDTO(testDto), cfg);
                            if (report.topSolutions == null || report.topSolutions.Count == 0) continue;
                            int fastest = report.topSolutions[0].length;
                            int deads = report.deadEndsCount;
                            int sols = report.solutionsFilteredCount;
                            if (Better(fastest, deads, sols))
                            {
                                bestX = x; bestY = y; bestTile = null; bestEntity = et.ToString(); bestOrient = null;
                                bestFast = fastest; bestDead = deads; bestSols = sols;
                            }
                            continue;
                        }
                        // For non-spawn entities, ensure cell is free and tile supports entities
                        var cell = seed.Grid.CellRef(new V2(x, y));
                        var traits = cell.ActiveMask;
                        bool blocksBox = (traits & (Traits.StopsEntity | Traits.HoleForEntity)) != 0;
                        if (blocksBox) continue;
                        if (seed.EntityAt.ContainsKey(new V2(x, y))) continue;

                        var testDto2 = CloneDTO(seedDto);
                        var list2 = new List<EntityDTO>(testDto2.entities ?? new List<EntityDTO>());
                        var eDto = new EntityDTO { type = et, x = x, y = y };
                        list2.Add(eDto);
                        testDto2.entities = list2;
                        var report2 = BruteForceSolver.AnalyzeBfs(Loader.FromDTO(testDto2), cfg);
                        if (report2.topSolutions == null || report2.topSolutions.Count == 0) continue;
                        int fastest2 = report2.topSolutions[0].length;
                        int deads2 = report2.deadEndsCount;
                        int sols2 = report2.solutionsFilteredCount;
                        if (Better(fastest2, deads2, sols2))
                        {
                            bestX = x; bestY = y; bestTile = null; bestEntity = et.ToString(); bestOrient = null;
                            bestFast = fastest2; bestDead = deads2; bestSols = sols2;
                        }
                    }
                }
            }

            if (bestX < 0)
            {
                return new GreedyResult { ok = false, err = "no_improving_candidate" };
            }

            var outDto = CloneDTO(seedDto);
            if (bestTile != null)
            {
                EnsureGridInitialized(outDto);
                outDto.tileGrid[bestY][bestX] = bestTile;
            }
            else if (bestEntity != null)
            {
                var list = new List<EntityDTO>(outDto.entities ?? new List<EntityDTO>());
                if (string.Equals(bestEntity, EntityType.PlayerSpawn.ToString(), StringComparison.OrdinalIgnoreCase))
                {
                    list.RemoveAll(e => e != null && e.type == EntityType.PlayerSpawn);
                    list.Add(new EntityDTO { type = EntityType.PlayerSpawn, x = bestX, y = bestY });
                }
                else
                {
                    if (Enum.TryParse<EntityType>(bestEntity, true, out var etype))
                    {
                        list.Add(new EntityDTO { type = etype, x = bestX, y = bestY });
                    }
                }
                outDto.entities = list;
            }

            return new GreedyResult
            {
                ok = true,
                level = outDto,
                x = bestX, y = bestY,
                tile = bestTile, entity = bestEntity, orientation = bestOrient,
                fastest = bestFast, deadEnds = bestDead, solutions = bestSols
            };
        }

        public static GreedyResult RemoveOne(LevelDTO seedDto, RemoveOneOptions opts)
        {
            var seed = Loader.FromDTO(seedDto);
            var cfg = new SolverConfig { DepthCap = opts.maxDepth, NodesCap = opts.maxNodes };

            var baseRep = BruteForceSolver.AnalyzeBfs(seed, cfg);
            if (baseRep.topSolutions == null || baseRep.topSolutions.Count == 0)
                return new GreedyResult { ok = false, err = "unsolvable_base" };
            int baseFast = baseRep.topSolutions[0].length;
            int baseDead = baseRep.deadEndsCount;
            int baseSols = baseRep.solutionsFilteredCount;

            bool Better(int f, int d, int s)
            {
                if (f != baseFast) return f > baseFast;
                if (d != baseDead) return d > baseDead;
                return s < baseSols;
            }

            var allowed = new HashSet<string>((opts.entitiesRemove ?? new()).Select(n => (n ?? string.Empty).Trim()), StringComparer.OrdinalIgnoreCase);
            int bestIdx = -1, bestFast = -1, bestDead = -1, bestSols = int.MaxValue;
            string bestEnt = null;

            var stateEntities = seedDto.entities ?? new List<EntityDTO>();
            for (int i = 0; i < stateEntities.Count; i++)
            {
                var e = stateEntities[i];
                if (e == null) continue;
                var typeName = e.type.ToString();
                if (allowed.Count > 0 && !allowed.Contains(typeName)) continue;
                // do not remove PlayerSpawn here; handled by movePlayer in PlaceOne
                if (e.type == EntityType.PlayerSpawn) continue;

                var testDto = CloneDTO(seedDto);
                var list = new List<EntityDTO>(testDto.entities ?? new List<EntityDTO>());
                if (i >= 0 && i < list.Count) list.RemoveAt(i);
                testDto.entities = list;
                var rep = BruteForceSolver.AnalyzeBfs(Loader.FromDTO(testDto), cfg);
                if (rep.topSolutions == null || rep.topSolutions.Count == 0) continue;
                int f = rep.topSolutions[0].length;
                int d = rep.deadEndsCount;
                int s = rep.solutionsFilteredCount;
                if (Better(f, d, s)) { bestIdx = i; bestEnt = e.type.ToString(); bestFast = f; bestDead = d; bestSols = s; }
            }

            if (bestIdx < 0)
                return new GreedyResult { ok = false, err = "no_improving_candidate" };

            var outDto = CloneDTO(seedDto);
            var outList = new List<EntityDTO>(outDto.entities ?? new List<EntityDTO>());
            outList.RemoveAt(bestIdx);
            outDto.entities = outList;
            return new GreedyResult
            {
                ok = true,
                level = outDto,
                entity = bestEnt,
                fastest = bestFast, deadEnds = bestDead, solutions = bestSols
            };
        }

        // Utilities ---------------------------------------------------------
        private static LevelDTO CloneDTO(LevelDTO src)
        {
            var json = Newtonsoft.Json.JsonConvert.SerializeObject(src);
            return Newtonsoft.Json.JsonConvert.DeserializeObject<LevelDTO>(json);
        }

        private static void EnsureGridInitialized(LevelDTO dto)
        {
            if (dto.tileGrid != null && dto.tileGrid.Length > 0) return;
            dto.tileGrid = new string[dto.height][];
            for (int y = 0; y < dto.height; y++)
            {
                dto.tileGrid[y] = new string[dto.width];
                for (int x = 0; x < dto.width; x++) dto.tileGrid[y][x] = TileType.Floor.ToString();
            }
        }
    }
}

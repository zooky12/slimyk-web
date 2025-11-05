using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using SlimeGrid.Logic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    // Root settings used to initialize a C#-owned ALD context
    public sealed class ContextSettings
    {
        public GeneratorSettings generator { get; set; } = new();
        public List<BucketConfig> buckets { get; set; } = new();
        public SolverConfig solver { get; set; } = new();
        public MutationSettings mutation { get; set; } = new();
        public SelectionSettings selection { get; set; } = new();
        public DedupeSettings dedupe { get; set; } = new();
        public List<DerivedFeatureConfig> derived { get; set; } = new();
        public List<string> traceRequire { get; set; } = new();
    }

    public sealed class MutationSettings
    {
        public int stepsBase { get; set; } = 5;
        public int stepsEvolve { get; set; } = 1;
        // Fraction [0,1] of mutations that enable greedy single-edit ops
        public double greedyRatio { get; set; } = 0.0;
        public List<string> tilesPlace { get; set; } = new List<string> { "Floor", "Wall", "Hole", "Exit" };
        public List<string> tilesChange { get; set; } = new();
        public List<string> entitiesPlace { get; set; } = new List<string> { "BoxBasic", "PlayerSpawn" };
        public List<string> entitiesRemove { get; set; } = new List<string> { "BoxBasic" };
        public bool movePlayer { get; set; } = true;
        public OperatorWeights operatorWeights { get; set; } = new();
        public Dictionary<string, MinMax> tileCounts { get; set; } = new Dictionary<string, MinMax>(StringComparer.OrdinalIgnoreCase)
        {
            { "Exit", new MinMax{ min = 1, max = null } }
        };
        public Dictionary<string, MinMax> entityCounts { get; set; } = new Dictionary<string, MinMax>(StringComparer.OrdinalIgnoreCase)
        {
            { "PlayerSpawn", new MinMax{ min = 1, max = null } }
        };
    }

    public sealed class OperatorWeights
    {
        public double replaceTile { get; set; } = 0.15;
        public double placeEntity { get; set; } = 0.10;
        public double removeEntity { get; set; } = 0.05;
        public double greedyPlaceOne { get; set; } = 0.05;
        public double greedyRemoveOne { get; set; } = 0.05;
    }

    public sealed class SelectionSettings
    {
        public int topK { get; set; } = 5;
        public double skew { get; set; } = 1.0;
    }

    public sealed class DedupeSettings
    {
        public double T_sol { get; set; } = 0.12;
        public double T_layout { get; set; } = 0.25;
        public float w_tiles { get; set; } = 0.4f;
        public float w_entities { get; set; } = 0.4f;
        public float w_spatial { get; set; } = 0.2f;
        public int? minSolutionEditDistance { get; set; } = null;
    }

    public sealed class MinMax
    {
        public int? min { get; set; }
        public int? max { get; set; }
    }

    public sealed class AldContext
    {
        public readonly ContextSettings Settings;
        public readonly List<Bucket> Buckets;
        public readonly Dictionary<string, Bucket> BucketByName;
        public readonly HashSet<string> SeenSignatures = new();
        public readonly Random Rng;

        public AldContext(ContextSettings settings)
        {
            Settings = settings ?? new ContextSettings();
            Buckets = new List<Bucket>();
            BucketByName = new Dictionary<string, Bucket>(StringComparer.OrdinalIgnoreCase);
            foreach (var bc in Settings.buckets)
            {
                var b = new Bucket(bc);
                Buckets.Add(b);
                BucketByName[bc.name ?? ("bucket_" + Buckets.Count)] = b;
            }
            Rng = new Random();
        }

        public (bool ok, string[] acceptedIn, Dictionary<string, float> scores) Insert(LevelDTO dto)
        {
            // Reject levels where PlayerSpawn shares a tile with another entity
            try
            {
                var ps = (dto.entities ?? new List<EntityDTO>()).FirstOrDefault(e => e != null && e.type == EntityType.PlayerSpawn);
                if (ps != null)
                {
                    foreach (var e in dto.entities)
                    {
                        if (e == null || ReferenceEquals(e, ps)) continue;
                        if (e.x == ps.x && e.y == ps.y) return (false, Array.Empty<string>(), new Dictionary<string, float>());
                    }
                }
            } catch {}

            var s = Loader.FromDTO(dto);
            // Exact signature dedupe (reachable region)
            var mask = InfluenceMask.Compute(s);
            var sig = InfluenceMask.ReachableSignature(s, mask);
            if (!SeenSignatures.Add(sig))
                return (false, Array.Empty<string>(), new Dictionary<string, float>());

            // Fast pre-check: if required interactions imply certain tiles/traits/entities that are absent,
            // skip costly solver analysis immediately.
            try { if (!HasRequiredTracePrereqs(dto, Settings.traceRequire)) return (false, Array.Empty<string>(), new Dictionary<string, float>()); } catch {}

            var cfg = Settings.solver ?? new SolverConfig();
            var report = BruteForceSolver.AnalyzeBfs(s, cfg);
            try { Heuristics.AnnotateReport(report); } catch {}

            // Mechanics gating: require all specified interactions in Top-1
            try
            {
                var req = Settings.traceRequire ?? new List<string>();
                if (req.Count > 0)
                {
                    var have = new HashSet<string>(report.mechanics?.top1?.interactions ?? Array.Empty<string>(), StringComparer.Ordinal);
                    foreach (var tag in req) { if (!string.IsNullOrWhiteSpace(tag) && !have.Contains(tag)) return (false, Array.Empty<string>(), new Dictionary<string, float>()); }
                }
            } catch {}

            // Basic reject: unsolvable
            if (report.topSolutions == null || report.topSolutions.Count == 0)
                return (false, Array.Empty<string>(), new Dictionary<string, float>());

            var features = Heuristics.ComputeFeatures(report);
            // Derived features from settings (future‑proof composite heuristics)
            try { Heuristics.ApplyDerivedFeatures(features, Settings.derived); } catch {}
            var acceptedNames = new List<string>();
            var perScores = new Dictionary<string, float>();

            foreach (var b in Buckets)
            {
                var (raw, reject) = Heuristics.Score(b.Config, features, Settings.generator?.accept_capped_weight ?? 1.0f);
                if (reject) continue;
                var cand = new LevelCandidate { dto = dto, reachableHash = sig, report = report, features = features, rawScore = raw, normalizedScore = raw };
                if (b.PassSimilarity(cand, Settings.dedupe))
                {
                    if (b.TryInsert(cand))
                    {
                        acceptedNames.Add(b.Config.name);
                        perScores[b.Config.name] = raw;
                    }
                }
            }
            return (acceptedNames.Count > 0, acceptedNames.ToArray(), perScores);
        }

        // Map required interaction tags to minimal level prerequisites (tiles/traits/entities)
        private bool HasRequiredTracePrereqs(LevelDTO dto, List<string> required)
        {
            if (required == null || required.Count == 0) return true;

            // Scan tiles: compute presence flags by traits
            bool hasSlipperyPlayer = false;
            bool hasButtonToggle = false;
            bool hasButtonAllowExit = false;
            bool hasExitTile = false;
            bool hasAnyToggleable = false; // any toggleable/untoggleable by any agent

            if (dto.tileGrid != null && dto.tileGrid.Length > 0)
            {
                for (int y = 0; y < dto.tileGrid.Length; y++)
                {
                    var row = dto.tileGrid[y]; if (row == null) continue;
                    for (int x = 0; x < row.Length; x++)
                    {
                        var name = row[x] ?? TileType.Floor.ToString();
                        if (!Enum.TryParse<TileType>(name, true, out var T)) continue;
                        var traits = TileTraits.For(T).Active;
                        if ((traits & Traits.SlipperyForPlayer) != 0) hasSlipperyPlayer = true;
                        if ((traits & Traits.ButtonToggle) != 0) hasButtonToggle = true;
                        if ((traits & Traits.ButtonAllowExit) != 0) hasButtonAllowExit = true;
                        if ((traits & Traits.ExitPlayer) != 0) hasExitTile = true;
                        if (((traits & Traits.ToggleableByButton) != 0) || ((traits & Traits.UntoggleableByButton) != 0) ||
                            ((traits & Traits.ToggleableByPlayer) != 0) || ((traits & Traits.UntoggleableByPlayer) != 0) ||
                            ((traits & Traits.ToggleableByEntity) != 0) || ((traits & Traits.UntoggleableByEntity) != 0))
                            hasAnyToggleable = true;
                    }
                }
            }

            // Scan entities: presence by type and pushable count
            bool hasBoxBasic = false, hasBoxTriangle = false, hasBoxTipping = false, hasBoxUnattachable = false;
            int pushableCount = 0;
            foreach (var e in dto.entities ?? new List<EntityDTO>())
            {
                var et = e.type;
                if (et == EntityType.BoxBasic) { hasBoxBasic = true; }
                else if (et == EntityType.BoxTriangle) { hasBoxTriangle = true; }
                else if (et == EntityType.BoxTipping) { hasBoxTipping = true; }
                else if (et == EntityType.BoxUnattachable) { hasBoxUnattachable = true; }

                // Pushable trait via catalog
                try
                {
                    var def = EntityCatalog.Map[et];
                    if ((def.Traits & Traits.Pushable) != 0) pushableCount++;
                }
                catch { }
            }

            foreach (var tag in required)
            {
                if (string.IsNullOrWhiteSpace(tag)) continue;
                switch (tag)
                {
                    case "PushBox": if (!hasBoxBasic) return false; break;
                    case "PushTriangle": if (!hasBoxTriangle) return false; break;
                    case "PushTipping": if (!hasBoxTipping) return false; break;
                    case "PushUnattachable": if (!hasBoxUnattachable) return false; break;
                    case "MultiPush": if (pushableCount < 2) return false; break;
                    case "OrientChange_Box": if (!hasBoxBasic) return false; break;
                    case "OrientChange_TriBox": if (!hasBoxTriangle) return false; break;
                    case "SlideStart_Player":
                    case "SlideStep_Player":
                    case "SlideEnd_Player": if (!hasSlipperyPlayer) return false; break;
                    case "PlatePress":
                    case "PlateRelease": if (!hasButtonToggle) return false; break;
                    case "ExitOpen":
                    case "ExitClose": if (!hasButtonAllowExit) return false; break;
                    case "ExitReach": if (!hasExitTile) return false; break;
                    case "ToggleOn":
                    case "ToggleOff": if (!hasAnyToggleable) return false; break;
                    // MoveFree and others without clear prerequisites: ignore
                    default: break;
                }
            }
            return true;
        }

        public LevelDTO SelectBase()
        {
            // Pool topK entries per bucket
            var pool = new List<(float score, LevelDTO level)>();
            int topK = Math.Max(1, Settings.selection?.topK ?? 5);
            double skew = Settings.selection?.skew ?? 1.0;
            foreach (var b in Buckets)
            {
                // Sort bucket items by normalizedScore descending and take topK
                var items = new List<LevelCandidate>(b.Items);
                items.Sort((a, c) => c.normalizedScore.CompareTo(a.normalizedScore));
                for (int i = 0; i < items.Count && i < topK; i++)
                    pool.Add((items[i].normalizedScore, items[i].dto));
            }
            if (pool.Count == 0) return null;
            double min = double.PositiveInfinity; foreach (var e in pool) if (e.score < min) min = e.score;
            double eps = 1e-6;
            var weights = new double[pool.Count]; double sum = 0;
            for (int i = 0; i < pool.Count; i++)
            {
                double basew = (pool[i].score - min) + eps; if (basew < eps) basew = eps;
                double w = skew <= 0 ? 1.0 : Math.Pow(basew, skew);
                weights[i] = w; sum += w;
            }
            double r = Rng.NextDouble() * (sum > 0 ? sum : 1.0);
            for (int i = 0; i < pool.Count; i++) { r -= weights[i]; if (r <= 0) return pool[i].level; }
            return pool[pool.Count - 1].level;
        }

        public LevelDTO Mutate(LevelDTO baseDto, bool evolve)
        {
            var m = Settings.mutation ?? new MutationSettings();
            int steps = evolve ? m.stepsEvolve : m.stepsBase;
            if (steps <= 0) return baseDto;
            // decide whether this mutation will use greedy ops based on ratio
            bool useGreedy = (m.greedyRatio > 0.0) && (Rng.NextDouble() < m.greedyRatio);
            var cur = JsonConvert.DeserializeObject<LevelDTO>(JsonConvert.SerializeObject(baseDto));
            for (int k = 0; k < steps; k++)
            {
                cur = MutateOnce(cur, m, useGreedy);
            }
            return cur;
        }

        private LevelDTO MutateOnce(LevelDTO dto, MutationSettings m, bool useGreedy)
        {
            // Choose operator by weights
            double greedyW = useGreedy ? (m.operatorWeights.greedyPlaceOne + m.operatorWeights.greedyRemoveOne) : 0.0;
            double sum = m.operatorWeights.replaceTile + m.operatorWeights.placeEntity + m.operatorWeights.removeEntity + greedyW;
            if (sum <= 0) sum = 1.0;
            double r = Rng.NextDouble() * sum;
            string op = "replaceTile";
            if ((r -= m.operatorWeights.replaceTile) <= 0) op = "replaceTile";
            else if ((r -= m.operatorWeights.placeEntity) <= 0) op = "placeEntity";
            else if ((r -= m.operatorWeights.removeEntity) <= 0) op = "removeEntity";
            else if (useGreedy && (r -= m.operatorWeights.greedyPlaceOne) <= 0) op = "greedyPlaceOne";
            else op = "greedyRemoveOne";

            // Run chosen op
            if (op == "greedyPlaceOne")
            {
                // Scale solver caps for greedy when ratio is high to keep throughput
                var baseDepth = Settings.solver?.DepthCap ?? 100;
                var baseNodes = Settings.solver?.NodesCap ?? 200000;
                var ratio = Math.Clamp(m.greedyRatio, 0.0, 1.0);
                var depthScale = 1.0 - 0.7 * ratio;  // more aggressive depth scaling
                var nodesScale = 1.0 - 0.85 * ratio; // more aggressive node scaling
                int effDepth = Math.Max(12, (int)Math.Round(baseDepth * depthScale));
                int effNodes = Math.Max(2000, (int)Math.Round(baseNodes * nodesScale));
                var opts = new GreedyOps.PlaceOneOptions {
                    tilesPlace = m.tilesPlace,
                    entitiesPlace = m.entitiesPlace,
                    movePlayer = m.movePlayer,
                    maxDepth = effDepth,
                    maxNodes = effNodes
                };
                var res = GreedyOps.PlaceOne(dto, opts);
                return res.ok && res.level != null ? res.level : dto;
            }
            if (op == "greedyRemoveOne")
            {
                var baseDepth = Settings.solver?.DepthCap ?? 100;
                var baseNodes = Settings.solver?.NodesCap ?? 200000;
                var ratio = Math.Clamp(m.greedyRatio, 0.0, 1.0);
                var depthScale = 1.0 - 0.7 * ratio;
                var nodesScale = 1.0 - 0.85 * ratio;
                int effDepth = Math.Max(12, (int)Math.Round(baseDepth * depthScale));
                int effNodes = Math.Max(2000, (int)Math.Round(baseNodes * nodesScale));
                var opts = new GreedyOps.RemoveOneOptions { entitiesRemove = m.entitiesRemove, maxDepth = effDepth, maxNodes = effNodes };
                var res = GreedyOps.RemoveOne(dto, opts);
                return res.ok && res.level != null ? res.level : dto;
            }

            if (op == "replaceTile")
            {
                var state = Loader.FromDTO(dto);
                int W = state.Grid.W, H = state.Grid.H;
                bool hadAllowList = (m.tilesPlace != null && m.tilesPlace.Count > 0);

                // Compute reachable area from player using simple tile passability (non-StopsPlayer)
                var reachable = new bool[W, H];
                var q = new Queue<V2>();
                var p0 = state.PlayerPos;
                bool InB(V2 p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;
                bool Pass(V2 p)
                {
                    var mask = TraitsUtil.ResolveTileMask(state, p);
                    return (mask & Traits.StopsPlayer) == 0 && (mask & Traits.HoleForPlayer) == 0;
                }
                if (InB(p0) && Pass(p0)) { reachable[p0.x, p0.y] = true; q.Enqueue(p0); }
                var dirs = new (int dx, int dy)[] { (1,0),(-1,0),(0,1),(0,-1) };
                while (q.Count > 0)
                {
                    var p = q.Dequeue();
                    foreach (var (dx,dy) in dirs)
                    {
                        var np = new V2(p.x+dx, p.y+dy);
                        if (!InB(np) || reachable[np.x,np.y] || !Pass(np)) continue;
                        reachable[np.x,np.y] = true; q.Enqueue(np);
                    }
                }
                bool IsAdjacentToReach(int x,int y)
                {
                    foreach (var (dx,dy) in dirs)
                    {
                        int nx=x+dx, ny=y+dy; if (nx<0||ny<0||nx>=W||ny>=H) continue; if (reachable[nx,ny]) return true;
                    }
                    return false;
                }

                // Build candidate positions: inside reachable OR immediate wall adjacent to reachable
                var candPos = new List<(int x,int y)>();
                for (int y = 0; y < H; y++)
                    for (int x = 0; x < W; x++)
                    {
                        var t = state.Grid.CellRef(new V2(x,y)).Type;
                        bool okPos = reachable[x,y] || (t == TileType.Wall && IsAdjacentToReach(x,y));
                        if (okPos) candPos.Add((x,y));
                    }

                if (hadAllowList)
                {
                    // Try limited attempts within candidate positions
                    for (int tries = 0; tries < 24 && candPos.Count > 0; tries++)
                    {
                        var (x,y) = candPos[Rng.Next(candPos.Count)];
                        var name = m.tilesPlace[Rng.Next(m.tilesPlace.Count)];
                        if (!Enum.TryParse<TileType>(name, true, out var tt)) continue;
                        var cur = state.Grid.CellRef(new V2(x, y)).Type;
                        if (cur == tt) continue;
                        var next = JsonConvert.DeserializeObject<LevelDTO>(JsonConvert.SerializeObject(dto));
                        EnsureGridInitialized(next);
                        next.tileGrid[y][x] = tt.ToString();
                        if (RespectsCounts(next, m)) return next;
                    }
                    // We had an allowed list and couldn't place a valid change: do NOT fallback to unrestricted operator
                    return dto;
                }
                // No allow-list provided: fallback to ReplaceOperator palette
                var mask = InfluenceMask.Compute(state);
                var ok = ReplaceOperator.TryApply(new Random(Rng.Next()), Settings.generator ?? new GeneratorSettings(), state, dto, mask, out var dtoOut);
                return ok && dtoOut != null ? dtoOut : dto;
            }
            if (op == "placeEntity")
            {
                if (m.entitiesPlace != null && m.entitiesPlace.Count > 0)
                {
                    var state = Loader.FromDTO(dto);
                    int W = state.Grid.W, H = state.Grid.H;
                    for (int tries = 0; tries < 16; tries++)
                    {
                        int x = Rng.Next(W), y = Rng.Next(H);
                        var name = m.entitiesPlace[Rng.Next(m.entitiesPlace.Count)];
                        if (!Enum.TryParse<EntityType>(name, true, out var et)) continue;
                        // Player spawn: ensure tile supports player (not StopsPlayer)
                        var cell = state.Grid.CellRef(new V2(x, y));
                        if (et == EntityType.PlayerSpawn)
                        {
                            var mask = TraitsUtil.ResolveTileMask(state, new V2(x, y));
                            if ((mask & Traits.StopsPlayer) != 0) continue;
                            if ((mask & Traits.HoleForPlayer) != 0) continue;
                        }
                        else
                        {
                            var mask = TraitsUtil.ResolveTileMask(state, new V2(x, y));
                            // Allow placement on tiles that "stick" entities even if they also stop them
                            if (((mask & Traits.StopsEntity) != 0) && ((mask & Traits.SticksEntity) == 0)) continue;
                            if ((mask & Traits.HoleForEntity) != 0) continue;
                        }
                        if (state.EntityAt.ContainsKey(new V2(x, y))) continue;
                        var next = JsonConvert.DeserializeObject<LevelDTO>(JsonConvert.SerializeObject(dto));
                        if (next.entities == null) next.entities = new List<EntityDTO>();
                        // If adding would exceed configured max, relocate an existing entity of this type instead
                        bool relocated = false;
                        if (m.entityCounts != null && m.entityCounts.TryGetValue(et.ToString(), out var mm))
                        {
                            var curCounts = CountEntities(dto);
                            curCounts.TryGetValue(et.ToString(), out var cur);
                            if (mm.max.HasValue && cur >= mm.max.Value)
                            {
                                // Ensure target not occupied in next snapshot
                                if (!next.entities.Any(e => e != null && e.x == x && e.y == y))
                                {
                                    int idx = next.entities.FindIndex(e => e != null && e.type == et);
                                    if (idx >= 0)
                                    {
                                        var ee = next.entities[idx]; ee.x = x; ee.y = y; next.entities[idx] = ee;
                                        if (RespectsCounts(next, m)) return next;
                                        relocated = true;
                                    }
                                }
                            }
                        }
                        if (!relocated)
                        {
                            // Ensure uniqueness of PlayerSpawn
                            if (et == EntityType.PlayerSpawn) next.entities.RemoveAll(e => e.type == EntityType.PlayerSpawn);
                            next.entities.Add(new EntityDTO { type = et, x = x, y = y });
                            if (RespectsCounts(next, m)) return next;
                        }
                    }
                }
                return dto;
            }
            if (op == "removeEntity")
            {
                var list = dto.entities ?? new List<EntityDTO>();
                var candidates = list.Where(e => e != null && m.entitiesRemove.Contains(e.type.ToString())).ToList();
                if (candidates.Count > 0)
                {
                    var e = candidates[Rng.Next(candidates.Count)];
                    var next = JsonConvert.DeserializeObject<LevelDTO>(JsonConvert.SerializeObject(dto));
                    var l2 = next.entities ?? new List<EntityDTO>();
                    l2.RemoveAll(x => x.x == e.x && x.y == e.y && x.type == e.type);
                    next.entities = l2;
                    if (RespectsCounts(next, m)) return next; else return dto;
                }
                return dto;
            }

            // default fallback to ReplaceOperator if unknown
            {
                var state = Loader.FromDTO(dto);
                var mask = InfluenceMask.Compute(state);
                var ok = ReplaceOperator.TryApply(new Random(Rng.Next()), Settings.generator ?? new GeneratorSettings(), state, dto, mask, out var dtoOut);
                return ok && dtoOut != null ? dtoOut : dto;
            }
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

        private bool RespectsCounts(LevelDTO dto, MutationSettings m)
        {
            // Tiles count
            if (m.tileCounts != null)
            {
                var counts = CountTiles(dto);
                foreach (var kv in m.tileCounts)
                {
                    counts.TryGetValue(kv.Key, out var val);
                    if (kv.Value.min.HasValue && val < kv.Value.min.Value) return false;
                    if (kv.Value.max.HasValue && val > kv.Value.max.Value) return false;
                }
            }
            if (m.entityCounts != null)
            {
                var counts = CountEntities(dto);
                foreach (var kv in m.entityCounts)
                {
                    counts.TryGetValue(kv.Key, out var val);
                    if (kv.Value.min.HasValue && val < kv.Value.min.Value) return false;
                    if (kv.Value.max.HasValue && val > kv.Value.max.Value) return false;
                }
            }
            return true;
        }

        private Dictionary<string, int> CountTiles(LevelDTO dto)
        {
            var d = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            if (dto.tileGrid != null)
            {
                for (int y = 0; y < dto.tileGrid.Length; y++)
                {
                    var row = dto.tileGrid[y]; if (row == null) continue;
                    for (int x = 0; x < row.Length; x++)
                    {
                        var name = row[x] ?? TileType.Floor.ToString();
                        d.TryGetValue(name, out var c); d[name] = c + 1;
                    }
                }
            }
            return d;
        }

        private Dictionary<string, int> CountEntities(LevelDTO dto)
        {
            var d = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var e in dto.entities ?? new List<EntityDTO>())
            {
                var name = e.type.ToString(); d.TryGetValue(name, out var c); d[name] = c + 1;
            }
            return d;
        }
    }
}

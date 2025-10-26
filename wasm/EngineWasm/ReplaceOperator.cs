#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using SlimeGrid.Logic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    public static class ReplaceOperator
    {
        static readonly TileType[] TilePalette = new[]
        {
            TileType.Floor, TileType.Wall, TileType.Hole,
            TileType.Spike, TileType.SpikeHole,
            TileType.Grill,
            TileType.SlimPath, TileType.SlimPathHole,
            TileType.Ice, TileType.IceSpike, TileType.IceGrill, TileType.IceSlimPath,
            TileType.Exit,
            TileType.ButtonAllowExit, TileType.ButtonToggle
        };

        public static bool TryApply(Random rng, GeneratorSettings cfg, GameState currentState, LevelDTO dtoIn, bool[,] influenceMask, out LevelDTO dtoOut)
        {
            // Start from a copy of the DTO
            var dto = CloneDTO(dtoIn);

            // Choose tile target with reachable focus
            bool focus = rng.NextDouble() < cfg.p_reachableFocus;
            var targets = new List<(int x, int y)>();
            for (int y = 0; y < dto.height; y++)
                for (int x = 0; x < dto.width; x++)
                {
                    bool inMask = influenceMask[x, y];
                    if ((focus && inMask) || (!focus && !inMask)) targets.Add((x, y));
                }
            if (targets.Count == 0) { dtoOut = null; return false; }
            var t = targets[rng.Next(targets.Count)];

            // Current tile
            var curCell = currentState.Grid.CellRef(new V2(t.x, t.y));

            // Pick candidate tile type via similarity-biased sampling
            TileType picked = curCell.Type;
            if (!PickTileType(rng, cfg.similarity_bias, curCell.Type, out picked)) { dtoOut = null; return false; }
            if (picked == curCell.Type) { dtoOut = null; return false; }

            // Apply change into DTO
            EnsureGridInitialized(dto);
            dto.tileGrid[t.y][t.x] = picked.ToString();

            // Validate: change must touch influence mask (it does) and not violate constraints
            var mutated = Loader.FromDTO(dto);
            if (!ConstraintCheck(mutated)) { dtoOut = null; return false; }

            dtoOut = dto;
            return true;
        }

        static bool ConstraintCheck(GameState s)
        {
            // No entity on stop-entity tiles; no player on stop-player tiles; no player sharing with entity when not attached (authoring load state)
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    var tile = TraitsUtil.ResolveTileMask(s, p);
                    if (s.EntityAt.TryGetValue(p, out _))
                    {
                        if ((tile & Traits.StopsEntity) != 0) return false;
                    }
                    if (p.Equals(s.PlayerPos))
                    {
                        if ((tile & Traits.StopsPlayer) != 0) return false;
                        if (s.HasEntityAt(p)) return false;
                    }
                }
            return true;
        }

        static bool PickTileType(Random rng, double similarityBias, TileType cur, out TileType picked)
        {
            // Compute trait sets and Jaccard similarity; softmax over similarity
            double explore = rng.NextDouble();
            if (explore > similarityBias)
            {
                picked = TilePalette[rng.Next(TilePalette.Length)];
                return true;
            }

            var weights = new double[TilePalette.Length];
            double sum = 0;
            var curTT = TileTraits.For(cur);
            for (int i = 0; i < TilePalette.Length; i++)
            {
                var tt = TileTraits.For(TilePalette[i]);
                double sim = JaccardBits((ulong)curTT.Active, (ulong)tt.Active);
                // bonus if identical except orientation (N/A for our tiles) -> skip
                double w = Math.Exp(sim * 4.0); // softmax temperature
                weights[i] = w; sum += w;
            }
            double r = rng.NextDouble() * sum;
            for (int i = 0; i < weights.Length; i++)
            {
                r -= weights[i];
                if (r <= 0) { picked = TilePalette[i]; return true; }
            }
            picked = cur; return false;
        }

        static double JaccardBits(ulong a, ulong b)
        {
            ulong inter = a & b; ulong uni = a | b;
            int ic = PopCount(inter); int uc = PopCount(uni);
            return uc == 0 ? 1.0 : (double)ic / uc;
        }

        static int PopCount(ulong x)
        {
            x = x - ((x >> 1) & 0x5555555555555555UL);
            x = (x & 0x3333333333333333UL) + ((x >> 2) & 0x3333333333333333UL);
            return (int)(unchecked(((x + (x >> 4)) & 0x0F0F0F0F0F0F0F0FUL) * 0x0101010101010101UL) >> 56);
        }

        static LevelDTO CloneDTO(LevelDTO src)
        {
            var json = Newtonsoft.Json.JsonConvert.SerializeObject(src);
            return Newtonsoft.Json.JsonConvert.DeserializeObject<LevelDTO>(json);
        }

        static void EnsureGridInitialized(LevelDTO dto)
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
#endif


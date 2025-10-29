using System.Collections.Generic;
using SlimeGrid.Logic.Animation;

namespace SlimeGrid.Logic
{
    public static class Mechanics
    {
        static bool InB(GameState s, V2 p) => s.Grid.InBounds(p);
        static V2 Next(V2 p, Dir d) => p + d.Vec();

        // -------------------- WALK (tile-first; single MoveStraight) --------------------
        public static bool Walk(GameState s, Dir d, StepResult outRes)
        {
            if (DoSlidePlayer(s, s.PlayerPos, d, outRes)) return true;
            if (DoPlayerStep(s, d, outRes)) return true;
            return false;
        }

        // -------------------- PUSH CHAIN (tile-first; validate every step) -------------
        public static bool PushChain(GameState s, int rootEntityId, Dir d, StepResult outRes)
        {
            // Build contiguous pushable chain
            var chain = new List<int>();
            var cur = s.EntitiesById[rootEntityId].Pos;

            while (s.EntityAt.TryGetValue(cur, out var id))
            {
                if ((s.EntitiesById[id].Traits & Traits.Pushable) == 0) break;
                chain.Add(id);
                cur += d.Vec();
            }

            // Early precheck: empty
            if (chain.Count == 0) return false;

            var first = chain[0];
            var last = chain[chain.Count - 1];

            var firstPos = s.EntitiesById[first].Pos;
            var lastNext = s.EntitiesById[last].Pos + d.Vec();

            // Early prechecks
            if ((TraitsUtil.ResolveEffectiveMask(s, firstPos) & Traits.SticksEntity) != 0) return false;
            if ((TraitsUtil.ResolveEffectiveMask(s, lastNext) & Traits.StopsEntity) != 0) return false;
            if ((TraitsUtil.ResolveTileMask(s, firstPos) & Traits.Slipery) != 0 && chain.Count > 1) return false;

            // Validate from back to front
            bool blocked = false;
            for (int i = chain.Count - 1; i >= 0; i--)
            {
                var eid = chain[i];                         // FIX: use chain[i], not i
                var pos = s.EntitiesById[eid].Pos;
                var mask = TraitsUtil.ResolveEffectiveMask(s, pos);
                if (blocked || (mask & Traits.StopsEntity) != 0 || (mask & Traits.SticksEntity) != 0)
                {
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, pos, BlockReason.TileStopsEntity));
                    Anim.Bump(outRes, pos);
                    blocked = true;
                }
            }

            if (blocked) return false;

            // Execute (back to front to avoid clobber)
            for (int i = chain.Count - 1; i >= 0; i--)
            {
                var eid = chain[i];
                if (!DoSlideEntity(s, eid, d, outRes))
                    DoEntityPushStep(s, eid, d, outRes);
            }
            return true;
        }

        // -------------------- TUMBLE (tile-first; no push fallback here) --------------
        public static bool Tumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var cur = s.EntitiesById[entityId].Pos;
            var to = Next(cur, d);

            // If next tile stops tumble and player is NOT side-attached, fail
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.StopsTumble) != 0 && s.EntryDir is not Dir)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.StopsTumble));
                Anim.Bump(outRes, to);
                return false;
            }
            // If current tile is Slippery => defer to PushChain
            if ((TraitsUtil.ResolveEffectiveMask(s, cur) & Traits.Slipery) != 0)
                return PushChain(s, entityId, d, outRes);

            // If next tile stops entity => fail
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.StopsEntity) != 0)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.TileStopsEntity));
                Anim.Bump(outRes, to);
                return false;
            }
            // If next tile stops tumble => push chain instead
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.StopsTumble) != 0)
                return PushChain(s, entityId, d, outRes);

            // If next is Slippery => tumble once, then push chain forward
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.Slipery) != 0)
            {
                DoTumble(s, entityId, d, outRes);
                return PushChain(s, entityId, d, outRes);
            }

            DoTumble(s, entityId, d, outRes);
            return true;
        }

        // -------------------- FLY (tile-first; Stop BEFORE; entity decides) ----------
        public static bool Fly(GameState s, Dir d, StepResult outRes)
        {
            var from = s.PlayerPos;
            var next = CheckFly(s, d);
            if (next.Equals(from)) return false;

            // Authoritative motion event for presenter
            Anim.PlayerMove(outRes, from, next, d, "fly");

            // Mutate logic state
            s.PlayerPos = next;
            s.AttachedEntityId = null;
            s.EntryDir = null;
            Anim.SetAttachment(outRes, null, null);

            // Break breakables passed over — gather first, then remove
            var toBreak = new List<int>();
            foreach (var kv in s.EntitiesById)
            {
                var eid = kv.Key;
                var e = kv.Value;
                if ((TraitsUtil.ResolveEffectiveMask(s, e.Pos) & Traits.Breakable) == 0) continue;
                if (e.Pos.Equals(from)) continue;
                if (e.Pos.x > from.x && e.Pos.x < next.x && e.Pos.y > from.y && e.Pos.y < next.y)
                    toBreak.Add(eid);
            }
            foreach (var eid in toBreak)
            {
                var pos = s.EntitiesById[eid].Pos;
                s.EntityAt.Remove(pos);
                s.EntitiesById.Remove(eid);
                outRes.Add(new DestroyEntity(eid, pos, "break"));
                Anim.BreakImpact(outRes, pos);
            }
            return true;
        }

        // -------------------- HELPERS --------------------

        private static void EntityMovement(GameState s, V2 from, V2 to, StepResult outRes, int entityId, string kind)
        {
            s.EntityAt.Remove(from);
            s.EntityAt[to] = entityId;
            s.EntitiesById[entityId].Pos = to;
            FixPlayerPos(s);
            Anim.EntityMove(outRes, entityId, from, to, kind);
        }

        private static bool DoTumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            if (!CheckEntityMovement(s, entityId, d, outRes)) return false;

            var cur = s.EntitiesById[entityId].Pos;
            var to = Next(cur, d);

            EntityMovement(s, cur, to, outRes, entityId, "tumble");

            if (s.EntryDir is Dir ed)
            {
                if (d == ed || d == ed.Opposite()) s.EntryDir = null;
            }
            else
            {
                // Was on-top: end side-attached in tumble direction
                s.EntryDir = d;
            }
            return true;
        }

        private static bool DoEntityPushStep(GameState s, int entityId, Dir d, StepResult outRes)
        {
            if (!CheckEntityMovement(s, entityId, d, outRes)) return false;

            var cur = s.EntitiesById[entityId].Pos;
            var to = Next(cur, d);

            EntityMovement(s, cur, to, outRes, entityId, "push");
            return true;
        }

        private static bool CheckEntityMovement(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var cur = s.EntitiesById[entityId].Pos;
            var to = cur + d.Vec();
            if (TraitsUtil.TileStopsEntity(s, to) || s.TryGetEntityAt(to) is not null) return false;
            return true;
        }

        private static bool DoPlayerStep(GameState s, Dir d, StepResult outRes)
        {
            if (!CheckPlayerMovement(s, d, outRes)) return false;

            var from = s.PlayerPos;
            var to = from + d.Vec();

            s.PlayerPos = to;
            Anim.PlayerMove(outRes, from, to, d, "step");
            return true;
        }

        private static bool CheckPlayerMovement(GameState s, Dir d, StepResult outRes)
        {
            var to = s.PlayerPos + d.Vec();
            if (TraitsUtil.TileStopsPlayer(s, to) || s.AttachedEntityId is not null) return false;
            return true;
        }

        private static bool DoSlideEntity(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var to = CheckSlideEntity(s, entityId, d);
            var cur = s.EntitiesById[entityId].Pos;
            if (cur.Equals(to)) return false;

            EntityMovement(s, cur, to, outRes, entityId, "slide");
            return true;
        }

        private static bool DoSlidePlayer(GameState s, V2 cur, Dir d, StepResult outRes)
        {
            var to = CheckSlidePlayer(s, cur, d);
            if (cur.Equals(to)) return false;

            s.PlayerPos = to;
            Anim.PlayerMove(outRes, cur, to, d, "slide");
            return true;
        }

        private static V2 CheckSlideEntity(GameState s, int entityId, Dir d)
        {
            var v = d.Vec();
            var pos = s.EntitiesById[entityId].Pos;
            var cur = pos + v;

            if (TraitsUtil.TileStopsEntity(s, cur) || s.TryGetEntityAt(cur) is not null) return pos;

            while (TraitsUtil.TileIsSlippery(s, cur) &&
                   !TraitsUtil.TileStopsEntity(s, cur + v) &&
                   s.TryGetEntityAt(cur + v) is null)
            {
                cur += v;
            }
            return cur;
        }

        private static V2 CheckSlidePlayer(GameState s, V2 pos, Dir d)
        {
            var v = d.Vec();
            var cur = pos + v;

            if (TraitsUtil.TileStopsPlayer(s, cur)) return pos;

            while (TraitsUtil.TileIsSlippery(s, cur)
                   && !s.HasEntityAt(cur)
                   && !TraitsUtil.TileStopsPlayer(s, cur + v))
            {
                cur += v;
            }
            return cur;
        }

        private static void FixPlayerPos(GameState s)
        {
            if (s.AttachedEntityId == null) return;
            s.PlayerPos = s.EntitiesById[(int)s.AttachedEntityId].Pos;
        }

        private static V2 CheckFly(GameState s, Dir d)
        {
            var cur = s.PlayerPos;
            while (true)
            {
                var next = cur + d.Vec();
                if (TraitsUtil.TileStopsFlight(s, next)) return cur;
                if (TraitsUtil.TileSticksFlight(s, next)) return next;
                cur = next;
            }
        }
    }
}

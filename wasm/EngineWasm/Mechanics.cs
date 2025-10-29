// Assets/Code/Logic/Mechanics.cs
using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    public static class Mechanics
    {
        // ---- Small helpers (readability + DRY) --------------------------------------

        static V2 Next(V2 p, Dir d) => p + d.Vec();

        static bool ZoneHas(GameState s, V2 p, Traits t) =>
            (TraitsUtil.ResolveEffectiveMask(s, p) & t) != 0;

        static bool TileHas(GameState s, V2 p, Traits t) =>
            (TraitsUtil.ResolveTileMask(s, p) & t) != 0;

        static void AddCuePair(StepResult r, CueType start, V2 a, float ta, CueType end, V2 b, float tb)
        {
            r.Add(new AnimationCue(start, a, ta));
            r.Add(new AnimationCue(end, b, tb));
        }

        static void MoveEntity(GameState s, V2 from, V2 to)
        {
            var id = s.EntityAt[from];
            s.EntityAt.Remove(from);
            s.EntityAt[to] = id;
            s.EntitiesById[id].Pos = to;
            FixPlayerPos(s);
        }

        static bool CanEntityEnter(GameState s, V2 to) =>
            !TraitsUtil.TileStopsEntity(s, to) && s.TryGetEntityAt(to) is null;

        static bool CanPlayerEnter(GameState s, V2 to) =>
            !TraitsUtil.TileStopsPlayer(s, to) && !s.HasEntityAt(to);

        static void FixPlayerPos(GameState s)
        {
            if (s.AttachedEntityId is int id) s.PlayerPos = s.EntitiesById[id].Pos;
        }

        // -------------------- WALK (tile-first; single MoveStraight) ------------------
        public static bool Walk(GameState s, Dir d, StepResult outRes)
        {
            var cur = s.PlayerPos;
            if (DoSlidePlayer(s, cur, d, outRes)) return true;
            if (DoPlayerMovement(s, d, outRes)) return true;
            return false;
        }

        // -------------------- PUSH CHAIN (tile-first; validate every step) ------------
        public static bool PushChain(GameState s, int rootEntityId, Dir d, StepResult outRes)
        {
            var v = d.Vec();

            // Build contiguous pushable chain
            var chain = new List<int>();
            var cur = s.EntitiesById[rootEntityId].Pos;

            while (s.EntityAt.TryGetValue(cur, out var id))
            {
                if ((s.EntitiesById[id].Traits & Traits.Pushable) == 0) break;
                chain.Add(id);
                cur += v;
            }

            if (chain.Count == 0) return false;

            var first = chain[0];
            var last = chain[chain.Count - 1];
            var firstPos = s.EntitiesById[first].Pos;
            var lastNext = s.EntitiesById[last].Pos + v;

            // Early prechecks
            if (ZoneHas(s, firstPos, Traits.SticksEntity)) return false;
            if (ZoneHas(s, lastNext, Traits.StopsEntity)) return false;
            if (TileHas(s, firstPos, Traits.Slipery) && chain.Count > 1) return false;

            // Validate path tiles for all chain elements (from back to front)
            bool blocked = false;
            for (int i = chain.Count - 1; i >= 0; i--)
            {
                var eid = chain[i];
                var at = s.EntitiesById[eid].Pos;
                var tile = TraitsUtil.ResolveEffectiveMask(s, at);
                if (blocked || (tile & (Traits.StopsEntity | Traits.SticksEntity)) != 0)
                {
                    // NOTE: fixed original index bug here (use chain[i], not i)
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, at, BlockReason.TileStopsEntity));
                    outRes.Add(new AnimationCue(CueType.Bump, at, 0.4f));
                    blocked = true;
                }
            }
            if (blocked) return false;

            // Execute (back to front to avoid clobber)
            for (int i = chain.Count - 1; i >= 0; i--)
            {
                var eid = chain[i];
                if (!DoSlideEntity(s, eid, d, outRes))
                {
                    DoEntityMovement(s, eid, d, outRes);
                }
            }
            return true;
        }

        // -------------------- TUMBLE (tile-first; no push fallback here) --------------
        public static bool Tumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var v = d.Vec();
            var cur = s.EntitiesById[entityId].Pos;
            var to = cur + v;

            // If immediate next tile stops tumble and player is NOT side-attached, fail
            if (ZoneHas(s, to, Traits.StopsTumble) && s.EntryDir is not Dir)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.StopsTumble));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.4f));
                return false;
            }

            // If current tile is Slippery => defer to PushChain
            if (ZoneHas(s, cur, Traits.Slipery)) return PushChain(s, entityId, d, outRes);

            // If next tile stops entity => fail
            if (ZoneHas(s, to, Traits.StopsEntity))
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.TileStopsEntity));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.4f));
                return false;
            }

            // If next tile stops tumble => push chain instead
            if (ZoneHas(s, to, Traits.StopsTumble)) return PushChain(s, entityId, d, outRes);

            // If next is Slippery => tumble once, then push chain forward
            if (ZoneHas(s, to, Traits.Slipery))
            {
                DoTumble(s, entityId, d, outRes);
                return PushChain(s, entityId, d, outRes);
            }

            DoTumble(s, entityId, d, outRes);
            return true;
        }

        // -------------------- FLY (tile-first; Stop BEFORE; entity decides) -----------
        public static bool Fly(GameState s, Dir d, StepResult outRes)
        {
            var from = s.PlayerPos;
            var next = CheckFly(s, d);
            if (next.Equals(from)) return false;

            outRes.Add(new AnimationCue(CueType.FlyStart, from, 0.35f));
            s.PlayerPos = next;
            s.AttachedEntityId = null;
            s.EntryDir = null;
            outRes.Add(new SetAttachment(null, null));
            outRes.Add(new AnimationCue(CueType.FlyEnd, next, 0.35f));

            // Break fragile things passed over (NOTE: behavior kept; consider axis-aware check later)
            foreach (var eid in s.EntitiesById.Keys)
            {
                var e = s.EntitiesById[eid];
                if ((TraitsUtil.ResolveEffectiveMask(s, e.Pos) & Traits.Breakable) == 0) continue;
                if (e.Pos.Equals(from)) continue;

                // Original condition: strictly inside the rectangle (works for a subset of rays)
                if (e.Pos.x > from.x && e.Pos.x < next.x && e.Pos.y > from.y && e.Pos.y < next.y)
                {
                    s.EntityAt.Remove(e.Pos);
                    s.EntitiesById.Remove(eid);
                    outRes.Add(new DestroyEntity(eid, e.Pos, "break"));
                    outRes.Add(new AnimationCue(CueType.BreakImpact, e.Pos, 0.6f));
                }
            }
            return true;
        }

        // -------------------- Helpers (private mutators / checks) ---------------------

        private static bool DoTumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            if (!CheckEntityMovement(s, entityId, d)) return false;

            var cur = s.EntitiesById[entityId].Pos;
            var to = Next(cur, d);

            outRes.Add(new AnimationCue(CueType.TumbleStart, cur, 0.3f));
            MoveEntity(s, cur, to);

            if (s.EntryDir is Dir ed)
            {
                if (d == ed || d == ed.Opposite()) s.EntryDir = null;
            }
            else
            {
                // Was on-top: end side-attached in tumble direction
                s.EntryDir = d;
            }

            outRes.Add(new AnimationCue(CueType.TumbleEnd, to, 0.3f));
            return true;
        }

        private static bool DoEntityMovement(GameState s, int entityId, Dir d, StepResult outRes)
        {
            if (!CheckEntityMovement(s, entityId, d)) return false;

            var cur = s.EntitiesById[entityId].Pos;
            var to = Next(cur, d);

            AddCuePair(outRes, CueType.PushStart, cur, 0.3f, CueType.PushEnd, to, 0.3f);
            MoveEntity(s, cur, to);
            return true;
        }

        private static bool CheckEntityMovement(GameState s, int entityId, Dir d)
        {
            var cur = s.EntitiesById[entityId].Pos;
            var to = Next(cur, d);
            return CanEntityEnter(s, to);
        }

        private static bool DoPlayerMovement(GameState s, Dir d, StepResult outRes)
        {
            if (!CheckPlayerMovement(s, d)) return false;

            var from = s.PlayerPos;
            var to = Next(from, d);

            AddCuePair(outRes, CueType.SlideStart, from, 0.3f, CueType.SlideEnd, to, 0.3f);
            s.PlayerPos = to;
            return true;
        }

        private static bool CheckPlayerMovement(GameState s, Dir d)
        {
            if (s.AttachedEntityId is not null) return false;
            var to = Next(s.PlayerPos, d);
            return CanPlayerEnter(s, to);
        }

        private static bool DoSlideEntity(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var to = CheckSlideEntity(s, entityId, d);
            var cur = s.EntitiesById[entityId].Pos;
            if (cur.Equals(to)) return false;

            AddCuePair(outRes, CueType.EntitySlideStart, cur, 0.3f, CueType.EntitySlideEnd, to, 0.3f);
            MoveEntity(s, cur, to);
            return true;
        }

        private static bool DoSlidePlayer(GameState s, V2 cur, Dir d, StepResult outRes)
        {
            var to = CheckSlidePlayer(s, cur, d);
            if (cur.Equals(to)) return false;

            AddCuePair(outRes, CueType.SlideStart, cur, 0.3f, CueType.SlideEnd, to, 0.3f);
            s.PlayerPos = to;
            return true;
        }

        private static V2 CheckSlideEntity(GameState s, int entityId, Dir d)
        {
            var v = d.Vec();
            var pos = s.EntitiesById[entityId].Pos;
            var cur = pos + v;

            if (!CanEntityEnter(s, cur)) return pos;

            while (TraitsUtil.TileIsSlippery(s, cur) &&
                   CanEntityEnter(s, cur + v))
            {
                cur += v;
            }
            return cur;
        }

        private static V2 CheckSlidePlayer(GameState s, V2 from, Dir d)
        {
            var v = d.Vec();
            var cur = from + v;

            if (!CanPlayerEnter(s, cur)) return from;

            while (TraitsUtil.TileIsSlippery(s, cur) &&
                   !s.HasEntityAt(cur) &&
                   !TraitsUtil.TileStopsPlayer(s, cur + v))
            {
                cur += v;
            }
            return cur;
        }

        private static V2 CheckFly(GameState s, Dir d)
        {
            var v = d.Vec();
            var cur = s.PlayerPos;

            while (true)
            {
                var next = cur + v;
                if (TraitsUtil.TileStopsFlight(s, next)) return cur;
                if (TraitsUtil.TileSticksFlight(s, next)) return next;
                cur = next;
            }
        }
    }
}

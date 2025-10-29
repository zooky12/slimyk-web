// Assets/Code/Logic/Mechanics.cs

using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    public static class Mechanics
    {
        static bool InB(GameState s, V2 p) => s.Grid.InBounds(p);

        // -------------------- WALK (tile-first; single MoveStraight) --------------------
        public static bool Walk(GameState s, Dir d, StepResult outRes)
        {
            if (DoSlidePlayer(s, s.PlayerPos, d, outRes)) return true;
            if (DoPlayerMovement(s, d, outRes)) return true;
            return false;
        }

        // -------------------- PUSH CHAIN (tile-first; validate every step) -------------
        public static bool PushChain(GameState s, int rootEntityId, Dir d, StepResult outRes)
        {



            // Build the contiguous pushable chain and record current positions
            var chain = new List<int>();
            var cur = s.EntitiesById[rootEntityId].Pos;

            while (s.EntityAt.TryGetValue(cur, out var id))
            {
                if ((s.EntitiesById[id].Traits & Traits.Pushable) == 0) break;
                chain.Add(id);
                cur += d.Vec();
            }
            // Early precheck: if chain is empty, fail
            if (chain.Count == 0) return false;

            var first = chain[0];
            var last = chain[chain.Count - 1];

            // Early precheck: if first entity tile is SticksEntity, fail
            if ((TraitsUtil.ResolveEffectiveMask(s, s.EntitiesById[first].Pos) & Traits.SticksEntity) != 0) return false;
            // Early precheck: if last entity + 1 is stop, fail
            if ((TraitsUtil.ResolveEffectiveMask(s, s.EntitiesById[last].Pos + d.Vec()) & Traits.StopsEntity) != 0) return false;
            // Early precheck: if first entity tile is Slipery, and there are more than one, fail
            if ((TraitsUtil.ResolveTileMask(s, s.EntitiesById[first].Pos) & Traits.Slipery) != 0 && chain.Count > 1) return false;

            // Validate every target
            bool blocked = false;
            for (int i = chain.Count - 1; i >= 0; i--)
            {
                var tile = TraitsUtil.ResolveEffectiveMask(s, s.EntitiesById[chain[i]].Pos);
                if (blocked || (tile & Traits.StopsEntity) != 0 || (tile & Traits.SticksEntity) != 0)
                {
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, s.EntitiesById[i].Pos, BlockReason.TileStopsEntity));
                    outRes.Add(new AnimationCue(CueType.Bump, s.EntitiesById[i].Pos, 0.4f));
                    blocked = true;
                }
            }

            if (blocked) return false;

            for (int i = chain.Count - 1; i >= 0; i--)
            {
                if (!DoSlideEntity(s, chain[i], d, outRes)) DoEntityMovement(s, chain[i], d, outRes);
            }
            return true;
        }
        // -------------------- TUMBLE (tile-first; no push fallback here) --------------
        public static bool Tumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var (dx, dy) = d.Vec();
            var cur = s.EntitiesById[entityId].Pos;
            var to = new V2(cur.x + dx, cur.y + dy);

            // Early precheck: if immediate next tile stops tumble and player on top, fail tumble
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.StopsTumble) != 0 && s.EntryDir is not Dir ed)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.StopsTumble));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.4f));
                return false;
            }
            // Early precheck: if current tile is Slipery, use PushChain instead
            if ((TraitsUtil.ResolveEffectiveMask(s, cur) & Traits.Slipery) != 0)
            {
                return PushChain(s, entityId, d, outRes);
            }
            // Early precheck: if immediate next tile stops entity, fail tumble
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.StopsEntity) != 0)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.TileStopsEntity));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.4f));
                return false;
            }
            // Early precheck: if immediate next tile stops tumble, use PushChain instead
            if ((TraitsUtil.ResolveEffectiveMask(s, to) & Traits.StopsTumble) != 0)
            {
                return PushChain(s, entityId, d, outRes);
            }
            // Early precheck: if next tile is Slipery, tumble and PushChain
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
            var (dx, dy) = d.Vec();
            var from = s.PlayerPos;
            var moved = false;

            var next = CheckFly(s, d);
            if (next.Equals(from)) return false;
            outRes.Add(new AnimationCue(CueType.FlyStart, from, 0.35f));
            s.PlayerPos = next;
            s.AttachedEntityId = null;
            s.EntryDir = null;
            outRes.Add(new SetAttachment(null, null));
            outRes.Add(new AnimationCue(CueType.FlyEnd, next, 0.35f));
            // for all entities with breakable flight between from and next, break them
            foreach (var eid in s.EntitiesById.Keys)
            {
                var e = s.EntitiesById[eid];
                if ((TraitsUtil.ResolveEffectiveMask(s, e.Pos) & Traits.Breakable) == 0) continue;
                if (e.Pos.Equals(from)) continue;
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
        // -------------------- HELPERS --------------------


        private static void EntityMovement(GameState s, V2 from, V2 to, StepResult outRes)
        {
            int entityId = s.EntityAt[from];
            s.EntityAt.Remove(from);
            s.EntityAt[to] = entityId;
            s.EntitiesById[entityId].Pos = to;
            FixPlayerPos(s);
        }
        private static bool DoTumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            if (!CheckEntityMovement(s, entityId, d, outRes)) return false;
            var (dx, dy) = d.Vec();
            var cur = s.EntitiesById[entityId].Pos;
            var to = new V2(cur.x + dx, cur.y + dy);
            outRes.Add(new AnimationCue(CueType.TumbleStart, cur, 0.3f));
            EntityMovement(s, cur, to, outRes);
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
            return false;
        }
        private static bool DoEntityMovement(GameState s, int entityId, Dir d, StepResult outRes)
        {
            if (!CheckEntityMovement(s, entityId, d, outRes)) return false;
            var (dx, dy) = d.Vec();
            var cur = s.EntitiesById[entityId].Pos;
            var to = new V2(cur.x + dx, cur.y + dy);
            outRes.Add(new AnimationCue(CueType.PushStart, cur, 0.3f));
            EntityMovement(s, cur, to, outRes);
            outRes.Add(new AnimationCue(CueType.PushEnd, to, 0.3f));
            return true; ;
        }
        private static bool CheckEntityMovement(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var cur = s.EntitiesById[entityId].Pos;
            var to = cur + d.Vec();
            if (TraitsUtil.TileStopsEntity(s, to) || s.TryGetEntityAt(to) is not null) return false;

            return true;
        }
        private static bool DoPlayerMovement(GameState s, Dir d, StepResult outRes)
        {
            if (!CheckPlayerMovement(s, d, outRes)) return false;
            outRes.Add(new AnimationCue(CueType.SlideStart, s.PlayerPos, 0.3f));
            s.PlayerPos += d.Vec();
            outRes.Add(new AnimationCue(CueType.SlideEnd, s.PlayerPos, 0.3f));
            return true;
        }
        private static bool CheckPlayerMovement(GameState s, Dir d, StepResult outRes)
        {
            var to = s.PlayerPos + d.Vec();
            if (TraitsUtil.TileStopsPlayer(s, to)
                || s.AttachedEntityId is not null) return false;
            return true;
        }
        private static bool DoSlideEntity(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var to = CheckSlideEntity(s, entityId, d);
            var cur = s.EntitiesById[entityId].Pos;
            if (cur.Equals(to)) return false;
            outRes.Add(new AnimationCue(CueType.EntitySlideStart, cur, 0.3f));
            EntityMovement(s, cur, to, outRes);
            FixPlayerPos(s);
            outRes.Add(new AnimationCue(CueType.EntitySlideEnd, to, 0.3f));
            return true;
        }
        private static bool DoSlidePlayer(GameState s, V2 cur, Dir d, StepResult outRes)
        {
            var to = CheckSlidePlayer(s, cur, d);
            if (cur.Equals(to)) return false;
            outRes.Add(new AnimationCue(CueType.SlideStart, cur, 0.3f));
            s.PlayerPos = to;
            outRes.Add(new AnimationCue(CueType.SlideEnd, to, 0.3f));
            return true;
        }
        private static V2 CheckSlideEntity(GameState s, int entityId, Dir d)
        {
            V2 cur = s.EntitiesById[entityId].Pos + d.Vec();
            if (TraitsUtil.TileStopsEntity(s, cur) || s.TryGetEntityAt(cur) is not null) return s.EntitiesById[entityId].Pos;
            while (TraitsUtil.TileIsSlippery(s, cur) && !TraitsUtil.TileStopsEntity(s, cur + d.Vec()) && s.TryGetEntityAt(cur + d.Vec()) is null)
            {
                cur += d.Vec();
            }
            return cur;
        }
        private static V2 CheckSlidePlayer(GameState s, V2 pos, Dir d)
        {
            V2 cur = pos + d.Vec();
            if (TraitsUtil.TileStopsPlayer(s, cur)) return pos;
            while (TraitsUtil.TileIsSlippery(s, cur)
            && !s.HasEntityAt(cur)
            && !TraitsUtil.TileStopsPlayer(s, cur + d.Vec()))
            {
                cur += d.Vec();
            }
            return cur;
        }
        private static void FixPlayerPos(GameState s)
        {
            if (s.AttachedEntityId == null) return;
            else s.PlayerPos = s.EntitiesById[(int)s.AttachedEntityId].Pos;
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

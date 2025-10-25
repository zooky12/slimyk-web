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
            var from = s.PlayerPos;
            var (dx, dy) = d.Vec();
            var cur = from;
            var slid = false;

            while (true)
            {
                var next = new V2(cur.x + dx, cur.y + dy);
                if (!s.Grid.InBounds(next))
                {
                    if (cur.Equals(from))
                    {
                        outRes.Add(new Blocked(Actor.Player, Verb.Walk, d, next, BlockReason.OutOfBounds));
                        outRes.Add(new AnimationCue(CueType.Bump, from, 0.35f));
                        return false;
                    }
                    break;
                }

                // TILE FIRST
                if (TraitsUtil.TileStopsPlayer(s, next))
                {
                    if (cur.Equals(from))
                    {
                        outRes.Add(new Blocked(Actor.Player, Verb.Walk, d, next, BlockReason.TileStopsPlayer));
                        outRes.Add(new AnimationCue(CueType.Bump, next, 0.4f));
                        return false;
                    }
                    break;
                }

                // Entity blockers (e.g., unattachable box)
                if ((TraitsUtil.ResolveEffectiveMask(s, next) & Traits.StopsPlayer) != 0)
                {
                    if (cur.Equals(from))
                    {
                        outRes.Add(new Blocked(Actor.Player, Verb.Walk, d, next, BlockReason.EntityBlocks));
                        outRes.Add(new AnimationCue(CueType.Bump, next, 0.4f));
                        return false;
                    }
                    break;
                }

                cur = next;

                var tile = TraitsUtil.ResolveTileMask(s, cur);
                if (!slid && (tile & Traits.Slipery) != 0)
                    outRes.Add(new AnimationCue(CueType.SlideStart, cur, 0.3f));

                if ((tile & Traits.Slipery) == 0) break;
                slid = true;
            }

            if (cur.Equals(from)) return false;
            s.PlayerPos = cur;
            int tiles = System.Math.Abs(cur.x - from.x) + System.Math.Abs(cur.y - from.y);
            outRes.Add(new MoveStraight(-1, from, cur, d, tiles, slid ? "slide" : "walk"));
            if (slid) outRes.Add(new AnimationCue(CueType.SlideEnd, cur, 0.3f));
            return true;
        }

        // -------------------- PUSH CHAIN (tile-first; validate every step) -------------
        public static bool PushChain(GameState s, int rootEntityId, Dir d, StepResult outRes)
        {
            var (dx, dy) = d.Vec();

            // Build the contiguous pushable chain and record current positions
            var chain = new List<int>();
            var cur = s.EntitiesById[rootEntityId].Pos;
            while (s.EntityAt.TryGetValue(cur, out var id))
            {
                if ((s.EntitiesById[id].Traits & Traits.Pushable) == 0) break;
                chain.Add(id);
                cur = new V2(cur.x + dx, cur.y + dy);
            }

            if (chain.Count == 0) return false;

            // Compute target positions for each entity in the chain
            var targets = new V2[chain.Count];
            for (int i = 0; i < chain.Count; i++)
            {
                var from = s.EntitiesById[chain[i]].Pos;
                targets[i] = new V2(from.x + dx, from.y + dy);
            }

            // Validate every target
            for (int i = 0; i < targets.Length; i++)
            {
                var to = targets[i];

                // Bounds
                if (!InB(s, to))
                {
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, to, BlockReason.OutOfBounds));
                    outRes.Add(new AnimationCue(CueType.Bump, to, 0.4f));
                    return false;
                }

                // Tile-first: StopsEntity or SticksEntity block pushes into this cell
                var tile = TraitsUtil.ResolveTileMask(s, to);
                if ((tile & Traits.StopsEntity) != 0)
                {
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, to, BlockReason.TileStopsEntity));
                    outRes.Add(new AnimationCue(CueType.Bump, to, 0.45f));
                    return false;
                }
                if ((tile & Traits.SticksEntity) != 0)
                {
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, to, BlockReason.TileStopsEntity));
                    outRes.Add(new AnimationCue(CueType.Bump, to, 0.45f));
                    return false;
                }

                // Occupancy: the **front** target must be empty; others are currently occupied by the next entity in the chain.
                bool isFront = (i == targets.Length - 1);
                if (isFront && s.EntityAt.ContainsKey(to))
                {
                    outRes.Add(new Blocked(Actor.Entity, Verb.PushChain, d, to, BlockReason.Occupied));
                    outRes.Add(new AnimationCue(CueType.Bump, to, 0.45f));
                    return false;
                }
            }

            // Perform moves from front to back
            outRes.Add(new AnimationCue(CueType.PushStart, s.EntitiesById[chain[0]].Pos, 0.3f));
            for (int i = chain.Count - 1; i >= 0; --i)
            {
                var id = chain[i];
                var from = s.EntitiesById[id].Pos;
                var to = targets[i];

                s.EntityAt.Remove(from);
                s.EntityAt[to] = id;
                s.EntitiesById[id].Pos = to;

                outRes.Add(new MoveEntity(id, from, to, "push"));
            }

            // Carry player if attached entity moved
            if (s.AttachedEntityId is int ae && chain.Contains(ae))
            {
                var pf = s.PlayerPos;
                s.PlayerPos = new V2(pf.x + dx, pf.y + dy);
                outRes.Add(new MoveEntity(-1, pf, s.PlayerPos, "pushPlayer"));
            }

            outRes.Add(new AnimationCue(CueType.PushEnd, s.EntitiesById[chain[0]].Pos, 0.3f));
            return true;
        }

        // -------------------- TUMBLE (tile-first; no push fallback here) --------------
        public static bool Tumble(GameState s, int entityId, Dir d, StepResult outRes)
        {
            var (dx, dy) = d.Vec();
            var from = s.EntitiesById[entityId].Pos;
            var to = new V2(from.x + dx, from.y + dy);

            if (!s.Grid.InBounds(to))
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.OutOfBounds));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.4f));
                return false;
            }

            // TILE FIRST
            var tile = TraitsUtil.ResolveTileMask(s, to);
            if ((tile & Traits.StopsTumble) != 0)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.StopsTumble));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.45f));
                return false;
            }
            if ((tile & Traits.StopsEntity) != 0)
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.TileStopsEntity));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.45f));
                return false;
            }

            // Occupancy
            if (s.EntityAt.ContainsKey(to))
            {
                outRes.Add(new Blocked(Actor.Entity, Verb.Tumble, d, to, BlockReason.Occupied));
                outRes.Add(new AnimationCue(CueType.Bump, to, 0.45f));
                return false;
            }

            outRes.Add(new AnimationCue(CueType.TumbleStart, from, 0.3f));

            s.EntityAt.Remove(from);
            s.EntityAt[to] = entityId;
            s.EntitiesById[entityId].Pos = to;
            outRes.Add(new MoveEntity(entityId, from, to, "tumble"));

            // Carry player if attached + apply tipping side-effects
            if (s.AttachedEntityId == entityId)
            {
                var pf = s.PlayerPos;
                s.PlayerPos = new V2(pf.x + dx, pf.y + dy);
                outRes.Add(new MoveEntity(-1, pf, s.PlayerPos, "tumblePlayer"));

                // If side-attached and we tumbled FORWARD → on-top (EntryDir=null)
                if (s.EntryDir is Dir ed)
                {
                    if (d == ed)
                        s.EntryDir = null; // on-top
                }
                else
                {
                    // If we were on-top and tumble succeeded → end side-attached in tumble direction
                    s.EntryDir = d;
                }
            }

            outRes.Add(new AnimationCue(CueType.TumbleEnd, to, 0.3f));
            return true;
        }

        // -------------------- FLY (tile-first; Stop BEFORE; entity decides) ----------
        public static bool Fly(GameState s, Dir d, StepResult outRes)
        {
            var (dx, dy) = d.Vec();
            var from = s.PlayerPos;
            var cur = from;
            var moved = false;

            outRes.Add(new AnimationCue(CueType.FlyStart, from, 0.35f));

            while (true)
            {
                var next = new V2(cur.x + dx, cur.y + dy);
                if (!s.Grid.InBounds(next))
                {
                    if (!moved)
                    {
                        outRes.Add(new Blocked(Actor.Player, Verb.Fly, d, next, BlockReason.OutOfBounds));
                        outRes.Add(new AnimationCue(CueType.Bump, from, 0.5f));
                        return false;
                    }
                    break;
                }

                // 1) TILE StopsFlight? -> stop BEFORE
                if (TraitsUtil.TileStopsFlight(s, next))
                {
                    if (!moved)
                    {
                        outRes.Add(new Blocked(Actor.Player, Verb.Fly, d, next, BlockReason.TileStopsFlight));
                        outRes.Add(new AnimationCue(CueType.Bump, next, 0.55f));
                        return false;
                    }
                    break;
                }

                // 2) ENTITY at next: breakable / stops / sticks / pass-through
                if (s.EntityAt.TryGetValue(next, out var eid))
                {
                    var e = s.EntitiesById[eid];

                    if ((e.Traits & Traits.Breakable) != 0)
                    {
                        s.EntityAt.Remove(next);
                        s.EntitiesById.Remove(eid);
                        outRes.Add(new DestroyEntity(eid, next, "break"));
                        outRes.Add(new AnimationCue(CueType.BreakImpact, next, 0.6f));

                        if ((e.Traits & Traits.StopsFlight) != 0)
                        {
                            if (!moved)
                            {
                                outRes.Add(new Blocked(Actor.Player, Verb.Fly, d, next, BlockReason.BreakableStopsFlight));
                                outRes.Add(new AnimationCue(CueType.Bump, next, 0.55f));
                                return false;
                            }
                            break; // stop BEFORE
                        }
                        // else continue into next
                    }
                    else
                    {
                        // Non-breakable: entity traits decide
                        if ((e.Traits & Traits.StopsFlight) != 0)
                        {
                            if (!moved)
                            {
                                outRes.Add(new Blocked(Actor.Player, Verb.Fly, d, next, BlockReason.TileStopsFlight));
                                outRes.Add(new AnimationCue(CueType.Bump, next, 0.55f));
                                return false;
                            }
                            break; // stop BEFORE
                        }

                        if ((e.Traits & Traits.SticksFlight) != 0)
                        {
                            // Enter and stop ON the cell (attachment will resolve later)
                            cur = next; moved = true;
                            break;
                        }

                        // pass-through: neither stops nor sticks → continue
                    }
                }

                // 3) TILE sticks flight? -> stop ON
                if (TraitsUtil.TileSticksFlight(s, next))
                {
                    cur = next; moved = true;
                    break;
                }

                // 4) move into next
                cur = next; moved = true;
            }

            if (!moved) return false;
            s.PlayerPos = cur;
            int tiles = System.Math.Abs(cur.x - from.x) + System.Math.Abs(cur.y - from.y);
            outRes.Add(new MoveStraight(-1, from, cur, d, tiles, "fly"));
            outRes.Add(new AnimationCue(CueType.FlyEnd, cur, 0.35f));
            return true;
        }
    }
}

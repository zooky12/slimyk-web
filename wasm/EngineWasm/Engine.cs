// Assets/Code/Logic/Engine.cs

using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    public static class Engine
    {
        [System.Flags]
        public enum StepEffects
        {
            None = 0,
            PlayerPos = 1 << 0,
            EntryDir = 1 << 1,
            LastMoveDir = 1 << 2,
            Tiles = 1 << 3,
            AttachDetach = 1 << 4,
            Buttons = 1 << 5,
            Entities = 1 << 6,
        }

        public static StepResult Step(GameState s, Dir moveDir)
            => Step(s, moveDir, out _);

        public static StepResult Step(GameState s, Dir moveDir, out StepEffects effects)
        {
            effects = StepEffects.None;
            var res = new StepResult();
            if (s == null || s.Grid == null) return res;

            // Tile signature before (detect tile swaps)
            ulong TileSig()
            {
                ulong h = 0;
                for (int yy = 0; yy < s.Grid.H; yy++)
                    for (int xx = 0; xx < s.Grid.W; xx++)
                    {
                        var t = s.Grid.CellRef(new V2(xx, yy)).Type;
                        h ^= (((ulong)(byte)t) + 0x9E3779B97F4A7C15UL) ^ (((ulong)(uint)xx << 32) ^ (ulong)(uint)yy);
                        h *= 1099511628211UL;
                    }
                return h;
            }
            var sigBefore = TileSig();

            var prevLastMove = s.LastMoveDir;

            // Snapshot pre-state for toggle edge detection
            var prevPlayerPos = s.PlayerPos;
            var prevAnyButton = s.AnyButtonPressed;
            var prevEntityPos = new Dictionary<int, V2>(s.EntitiesById.Count);
            foreach (var kv in s.EntitiesById) prevEntityPos[kv.Key] = kv.Value.Pos;
            var prevEntryDir = s.EntryDir;
            var prevAttached = s.AttachedEntityId;

            var verb = Decisions.Decide(s, moveDir);
            res.Deltas.Add(new AttemptAction(Actor.Player, verb, moveDir, s.AttachedEntityId));

            bool ok = verb switch
            {
                Verb.Walk => Mechanics.Walk(s, moveDir, res),
                Verb.PushChain => (s.AttachedEntityId is int ae) && Mechanics.PushChain(s, ae, moveDir, res),
                Verb.Tumble => (s.AttachedEntityId is int te) && Mechanics.Tumble(s, te, moveDir, res),
                Verb.Fly => DoFlyFromAttachment(s, moveDir, res),
                _ => false
            };
            if (!ok)
            {
                // Do not change LastMoveDir on failed attempt
                s.LastMoveDir = prevLastMove;
                return res;
            }

            // Recompute buttons (global) and announce edges
            var prevAny = s.AnyButtonPressed;
            s.AnyButtonPressed = ComputeAnyButtonPressed(s);

            if (s.AnyButtonPressed != prevAny)
            {
                res.Deltas.Add(new ButtonStateChanged(s.AnyButtonPressed));
                res.Deltas.Add(new AnimationCue(s.AnyButtonPressed ? CueType.ButtonPress : CueType.ButtonRelease, null, 0.5f));
                res.Deltas.Add(new AnimationCue(CueType.ToggleSweep, null, 0.6f));
            }
            // Track the prior edge state (previous frame) for deterministic edge semantics
            s.LastAnyButtonPressed = prevAny;

            // Apply tile swaps due to toggles (button edges, player/entity enter/leave)
            if (s.AnyButtonPressed != prevAnyButton)
            {
                ApplyButtonSwaps(s, s.AnyButtonPressed, res);
            }
            if (!s.PlayerPos.Equals(prevPlayerPos))
            {
                ApplyPlayerSwaps(s, prevPlayerPos, s.PlayerPos, res);
            }
            ApplyEntitySwaps(s, prevEntityPos, res);

            // Resolve late effects: attach, falls, win/lose
            // Set LastMoveDir only if player actually displaced
            if (!s.PlayerPos.Equals(prevPlayerPos))
            {
                if (prevLastMove != moveDir) effects |= StepEffects.LastMoveDir;
                s.LastMoveDir = moveDir;
            }
            ResolveState(s, res, prevPlayerPos, moveDir);

            res.GameOver = s.GameOver;
            res.Win = s.Win;

            // Compute effects summary
            if (!s.PlayerPos.Equals(prevPlayerPos)) effects |= StepEffects.PlayerPos;
            if (s.EntryDir != prevEntryDir) effects |= StepEffects.EntryDir;
            if ((s.AttachedEntityId ?? -1) != (prevAttached ?? -1)) effects |= StepEffects.AttachDetach;
            if (s.AnyButtonPressed != prevAnyButton) effects |= StepEffects.Buttons;
            // Entities moved/changed? infer from deltas
            foreach (var d in res.Deltas)
            {
                if (d is MoveStraight || d is MoveEntity || d is DestroyEntity)
                { effects |= StepEffects.Entities; break; }
            }
            // Tiles swapped?
            var sigAfter = TileSig();
            if (sigAfter != sigBefore) effects |= StepEffects.Tiles;

            return res;
        }

        static bool DoFlyFromAttachment(GameState s, Dir moveDir, StepResult outRes)
        {
            return Mechanics.Fly(s, moveDir, outRes);
        }

        // --- Tile swap helpers (tile-swap toggle model) ---
        static Traits TraitsAt(GameState s, V2 p) => TileTraits.For(s.Grid.CellRef(p).Type).Active;
        static bool Has(GameState s, V2 p, Traits t) => (TraitsAt(s, p) & t) != 0;
        static bool TrySwapAt(GameState s, V2 p)
        {
            if (!s.Grid.InBounds(p)) return false;
            ref var cell = ref s.Grid.CellRef(p);
            var def = TileTraits.For(cell.Type);
            if (def.ToggledTo.HasValue)
            {
                cell.Type = def.ToggledTo.Value;
                s.Grid.SetCell(p, cell);
                return true;
            }
            return false;
        }

        static void ApplyButtonSwaps(GameState s, bool pressed, StepResult outRes)
        {
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    if (pressed)
                    {
                        if (Has(s, p, Traits.ToggleableByButton) && TrySwapAt(s, p))
                            outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, p, 0.3f));
                    }
                    else
                    {
                        if (Has(s, p, Traits.UntoggleableByButton) && TrySwapAt(s, p))
                            outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, p, 0.3f));
                    }
                }
        }

        static void ApplyPlayerSwaps(GameState s, V2 prev, V2 now, StepResult outRes)
        {
            if (Has(s, now, Traits.ToggleableByPlayer) && TrySwapAt(s, now))
                outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, now, 0.3f));
            if (!prev.Equals(now) && Has(s, prev, Traits.UntoggleableByPlayer) && TrySwapAt(s, prev))
                outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, prev, 0.3f));
        }

        static void ApplyEntitySwaps(GameState s, Dictionary<int, V2> prevPos, StepResult outRes)
        {
            // Handle leaves (removed or moved) in deterministic order: row-major by previous position, then id
            var leaves = new List<(int id, V2 was)>(prevPos.Count);
            foreach (var kv in prevPos) leaves.Add((kv.Key, kv.Value));
            leaves.Sort((a, b) =>
            {
                int cy = a.was.y.CompareTo(b.was.y); if (cy != 0) return cy;
                int cx = a.was.x.CompareTo(b.was.x); if (cx != 0) return cx;
                return a.id.CompareTo(b.id);
            });
            foreach (var item in leaves)
            {
                var id = item.id; var was = item.was;
                if (!s.EntitiesById.TryGetValue(id, out var cur))
                {
                    if (Has(s, was, Traits.UntoggleableByEntity) && TrySwapAt(s, was))
                        outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, was, 0.25f));
                    continue;
                }
                if (!cur.Pos.Equals(was))
                {
                    if (Has(s, was, Traits.UntoggleableByEntity) && TrySwapAt(s, was))
                        outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, was, 0.25f));
                }
            }
            
            // Handle enters (new or moved) in deterministic order: row-major by current position, then id
            var enters = new List<(int id, V2 cur)>(s.EntitiesById.Count);
            foreach (var kv in s.EntitiesById) enters.Add((kv.Key, kv.Value.Pos));
            enters.Sort((a, b) =>
            {
                int cy = a.cur.y.CompareTo(b.cur.y); if (cy != 0) return cy;
                int cx = a.cur.x.CompareTo(b.cur.x); if (cx != 0) return cx;
                return a.id.CompareTo(b.id);
            });
            foreach (var item in enters)
            {
                var id = item.id; var cur = item.cur;
                if (!prevPos.TryGetValue(id, out var old) || !old.Equals(cur))
                {
                    if (Has(s, cur, Traits.ToggleableByEntity) && TrySwapAt(s, cur))
                        outRes.Deltas.Add(new AnimationCue(CueType.ToggleSweep, cur, 0.25f));
                }
            }
        }

        static bool ComputeAnyButtonPressed(GameState s)
        {
            // Deterministic scan: row-major over grid, check entity at each cell
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    if (!s.EntityAt.TryGetValue(p, out var id)) continue;
                    var e = s.EntitiesById[id];
                    if ((e.Traits & Traits.PressesButtons) == 0) continue;
                    var tile = TraitsUtil.ResolveTileMask(s, p);
                    if ((tile & Traits.ButtonToggle) != 0) return true;
                }
            return false;
        }

        static bool AllAllowExitPressed(GameState s)
        {
            // Scan every cell that is a ButtonAllowExit and ensure it's pressed by an entity with PressesButtons
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    var tile = TraitsUtil.ResolveTileMask(s, p);
                    if ((tile & Traits.ButtonAllowExit) != 0)
                    {
                        // must have an entity with PressesButtons on this tile
                        if (!s.EntityAt.TryGetValue(p, out var id) || (s.EntitiesById[id].Traits & Traits.PressesButtons) == 0)
                            return false;
                    }
                }
            return true;
        }

        static void ResolveState(GameState s, StepResult outRes, V2 prevPlayerPos, Dir moveDir)
        {
            // Attach if player stopped on an Attachable entity (avoid duplicates)
            if (s.EntityAt.TryGetValue(s.PlayerPos, out var eid))
            {
                var e = s.EntitiesById[eid];
                if ((e.Traits & Traits.Attachable) != 0)
                {
                    if (s.AttachedEntityId != eid)
                    {
                        s.AttachedEntityId = eid;
                        // Entry direction: if player moved into this cell, it's opposite of the moveDir
                        if (!s.PlayerPos.Equals(prevPlayerPos))
                            s.EntryDir = moveDir.Opposite();
                        else
                            s.EntryDir = null; // entity moved under player or no displacement; avoid history leak
                        outRes.Deltas.Add(new SetAttachment(eid, s.EntryDir));
                    }
                }
            }

            // Entities fall
            // Collect entities that fall in deterministic order (row-major by position, then id)
            List<int> toRemove = null;
            for (int y = 0; y < s.Grid.H; y++)
                for (int x = 0; x < s.Grid.W; x++)
                {
                    var p = new V2(x, y);
                    if (!s.EntityAt.TryGetValue(p, out var id)) continue;
                    var e = s.EntitiesById[id];
                    var tile = TraitsUtil.ResolveTileMask(s, e.Pos);
                    if ((tile & Traits.HoleForEntity) != 0)
                    {
                        (toRemove ??= new List<int>()).Add(e.Id);
                    }
                }
            if (toRemove != null)
            {
                // toRemove is already row-major ordered by construction
                foreach (var id in toRemove)
                {
                    var pos = s.EntitiesById[id].Pos;
                    s.EntityAt.Remove(pos);
                    s.EntitiesById.Remove(id);
                    outRes.Deltas.Add(new DestroyEntity(id, pos, "fallEntity"));
                    outRes.Deltas.Add(new AnimationCue(CueType.Fall, pos, 0.55f));

                    if (s.AttachedEntityId == id)
                    {
                        s.GameOver = true;
                        s.AttachedEntityId = null;
                        outRes.Deltas.Add(new SetGameOver());
                        outRes.Deltas.Add(new AnimationCue(CueType.GameOverThud, s.PlayerPos, 0.7f));
                        return;
                    }
                }
            }

            // Player fall (only when not attached)
            if (s.AttachedEntityId == null && (TraitsUtil.ResolveTileMask(s, s.PlayerPos) & Traits.HoleForPlayer) != 0)
            {
                s.GameOver = true;
                outRes.Deltas.Add(new SetGameOver());
                outRes.Deltas.Add(new AnimationCue(CueType.GameOverThud, s.PlayerPos, 0.7f));
                return;
            }

            // Win: on ExitPlayer and not attached, and ALL AllowExit buttons are pressed
            if ((TraitsUtil.ResolveTileMask(s, s.PlayerPos) & Traits.ExitPlayer) != 0
                && s.AttachedEntityId == null
                && AllAllowExitPressed(s))
            {
                s.Win = true;
                outRes.Deltas.Add(new SetWin());
                outRes.Deltas.Add(new AnimationCue(CueType.WinFanfare, s.PlayerPos, 0.7f));
            }
        }
    }
}

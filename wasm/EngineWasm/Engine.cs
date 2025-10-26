// Assets/Code/Logic/Engine.cs

using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    public static class Engine
    {
        public static StepResult Step(GameState s, Dir moveDir)
        {
            var res = new StepResult();
            if (s == null || s.Grid == null) return res;

            s.LastMoveDir = moveDir;

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
            if (!ok) return res;

            // Recompute buttons (global) and announce edges
            var was = s.AnyButtonPressed;
            s.AnyButtonPressed = ComputeAnyButtonPressed(s);

            if (s.AnyButtonPressed != s.LastAnyButtonPressed)
            {
                res.Deltas.Add(new ButtonStateChanged(s.AnyButtonPressed));
                res.Deltas.Add(new AnimationCue(s.AnyButtonPressed ? CueType.ButtonPress : CueType.ButtonRelease, null, 0.5f));
                res.Deltas.Add(new AnimationCue(CueType.ToggleSweep, null, 0.6f));
                s.LastAnyButtonPressed = s.AnyButtonPressed;
            }

            // Resolve late effects: attach, falls, win/lose
            ResolveState(s, res);

            res.GameOver = s.GameOver;
            res.Win = s.Win;
            return res;
        }

        static bool DoFlyFromAttachment(GameState s, Dir moveDir, StepResult outRes)
        {
            // Early precheck: if immediate next tile stops flight, do not detach and do not attempt fly
            var vec = moveDir.Vec();
            var next = new V2(s.PlayerPos.x + vec.dx, s.PlayerPos.y + vec.dy);
            if (!s.Grid.InBounds(next) || TraitsUtil.TileStopsFlight(s, next))
            {
                // Remain attached; signal a gentle bump (no FlyStart)
                outRes.Deltas.Add(new AnimationCue(CueType.Bump, next, 0.55f));
                return false;
            }

            if (s.AttachedEntityId != null)
            {
                s.AttachedEntityId = null;
                s.EntryDir = null;
                outRes.Deltas.Add(new SetAttachment(null, null));
            }
            return Mechanics.Fly(s, moveDir, outRes);
        }

        static bool ComputeAnyButtonPressed(GameState s)
        {
            foreach (var kv in s.EntitiesById)
            {
                var e = kv.Value;
                if ((e.Traits & Traits.PressesButtons) == 0) continue;

                var tile = TraitsUtil.ResolveTileMask(s, e.Pos);
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

        static void ResolveState(GameState s, StepResult outRes)
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
                        s.EntryDir = s.LastMoveDir.Opposite();
                        outRes.Deltas.Add(new SetAttachment(eid, s.EntryDir));
                    }
                }
            }

            // Entities fall
            List<int> toRemove = null;
            foreach (var kv in s.EntitiesById)
            {
                var e = kv.Value;
                var tile = TraitsUtil.ResolveTileMask(s, e.Pos);
                if ((tile & Traits.HoleForEntity) != 0)
                {
                    (toRemove ??= new List<int>()).Add(e.Id);
                }
            }
            if (toRemove != null)
            {
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

            // Player fall
            if ((TraitsUtil.ResolveTileMask(s, s.PlayerPos) & Traits.HoleForPlayer) != 0)
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

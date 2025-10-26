// Assets/Code/Logic/Decisions.cs

namespace SlimeGrid.Logic
{
    public enum Verb : byte { Fail = 0, Walk, PushChain, Tumble, Fly }

    public interface IMoveDecision
    {
        Verb Decide(GameState s, int entityId, Dir moveDir);
    }

    public sealed class BasicDecision : IMoveDecision
    {
        public Verb Decide(GameState s, int entityId, Dir moveDir)
        {
            if (s.EntryDir.HasValue && moveDir == s.EntryDir.Value) return Verb.Fly;
            return Verb.PushChain;
        }
    }

    public sealed class TriangleDecision : IMoveDecision
    {
        public Verb Decide(GameState s, int entityId, Dir moveDir)
        {
            var e = s.EntitiesById[entityId];
            var tri = e.Orientation.ToTri();
            var faces = tri.FaceDirs(); // (a,b)

            if (s.EntryDir is Dir ed)
            {
                bool attachedOnDiagonal = (ed == faces.a) || (ed == faces.b);
                if (attachedOnDiagonal)
                    return (moveDir == faces.a || moveDir == faces.b) ? Verb.Fly : Verb.PushChain;

                return (moveDir == ed) ? Verb.Fly : Verb.PushChain;
            }

            // on-top on triangles: safe default is PushChain (rare)
            return Verb.PushChain;
        }
    }

    public sealed class TippingDecision : IMoveDecision
    {
        public Verb Decide(GameState s, int entityId, Dir moveDir)
        {
            var e = s.EntitiesById[entityId];
            var next = e.Pos + moveDir.Vec();

            // ON-TOP: attempt Tumble only; if target StopsTumble => Fail (no push fallback)
            if (s.EntryDir is not Dir ed)
            {
                var tile = TraitsUtil.ResolveTileMask(s, next);
                if ((tile & Traits.StopsTumble) != 0) return Verb.Fail;
                return Verb.Tumble;
            }

            // SIDE-ATTACHED:
            // Forward → Fly (fix: fly shouldn't be opposite)
            if (moveDir == ed) return Verb.Fly;

            // Back or Side → attempt Tumble; but if target StopsTumble, PushChain instead
            var t = TraitsUtil.ResolveTileMask(s, next);
            if ((t & Traits.StopsTumble) != 0) return Verb.PushChain;

            return Verb.Tumble;
        }
    }

    public enum BehaviorId : byte
    {
        None = 0,
        Basic = 1,
        Triangle = 2,
        Tipping = 3,
    }

    public static class MoveDecisionRegistry
    {
        public static readonly System.Collections.Generic.Dictionary<BehaviorId, IMoveDecision> Map =
            new System.Collections.Generic.Dictionary<BehaviorId, IMoveDecision>
            {
                [BehaviorId.Basic] = new BasicDecision(),
                [BehaviorId.Triangle] = new TriangleDecision(),
                [BehaviorId.Tipping] = new TippingDecision()
            };
    }

    public static class Decisions
    {
        public static Verb Decide(GameState s, Dir moveDir)
        {
            if (s.AttachedEntityId is int eid)
            {
                var e = s.EntitiesById[eid];
                if (e.Behavior != BehaviorId.None && MoveDecisionRegistry.Map.TryGetValue(e.Behavior, out var logic))
                    return logic.Decide(s, eid, moveDir);
                return Verb.Fail;
            }

            return Verb.Walk;
        }
    }
}

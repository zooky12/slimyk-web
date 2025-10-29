using System;

namespace SlimeGrid.Logic.Animation
{
    // Minimal façade so Mechanics only describes *what* happened.
    // The presenter drives the real-time timeline from these events.
    public static class Anim
    {
        // ---- Movement (authoritative inputs for the runtime animator) ----

        public static void PlayerMove(StepResult r, V2 from, V2 to, Dir dir, string kind)
        {
            int tiles = Math.Abs(to.x - from.x) + Math.Abs(to.y - from.y);
            // Player id = -1 by convention
            r.Add(new MoveStraight(-1, from, to, dir, tiles, kind));
        }

        public static void EntityMove(StepResult r, int entityId, V2 from, V2 to, string kind)
        {
            r.Add(new MoveEntity(entityId, from, to, kind));
        }

        // ---- One-shot cues (SFX/VFX; motion is driven by Move* above) ----

        public static void Bump(StepResult r, V2 at)
            => r.Add(new AnimationCue(CueType.Bump, at, CueTime.Bump));

        public static void BreakImpact(StepResult r, V2 at)
            => r.Add(new AnimationCue(CueType.BreakImpact, at, CueTime.Break));

        public static void SetAttachment(StepResult r, int? id, Dir? entry)
            => r.Add(new SetAttachment(id, entry));
    }
}

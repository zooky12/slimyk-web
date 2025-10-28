using System.Collections.Generic;

namespace SlimeGrid.Logic
{
    public enum Actor : byte { Player = 0, Entity = 1 }

    public enum BlockReason : byte
    {
        OutOfBounds,
        TileStopsPlayer,
        TileStopsEntity,
        TileStopsFlight,
        TileSticksFlight,
        StopsTumble,
        Occupied,
        EntityBlocks,
        FrontBlockedTile,
        BreakableStopsFlight
    }

    public enum CueType : byte
    {
        Bump, SlideStart, SlideEnd,
        EntitySlideStart, EntitySlideEnd,
        FlyStart, FlyEnd,
        PushStart, PushEnd,
        TumbleStart, TumbleEnd,
        ButtonPress, ButtonRelease, ToggleSweep,
        BreakImpact, Fall,
        WinFanfare, GameOverThud
    }

    // Base event
    public abstract class Delta { }

    // Attempts & failures
    public sealed class AttemptAction : Delta
    {
        public Actor Actor; public Verb Verb; public Dir Dir; public int? EntityId;
        public AttemptAction(Actor actor, Verb verb, Dir dir, int? entityId)
        { Actor = actor; Verb = verb; Dir = dir; EntityId = entityId; }
    }

    public sealed class Blocked : Delta
    {
        public Actor Actor; public Verb Verb; public Dir Dir; public V2 At; public BlockReason Reason;
        public Blocked(Actor actor, Verb verb, Dir dir, V2 at, BlockReason reason)
        { Actor = actor; Verb = verb; Dir = dir; At = at; Reason = reason; }
    }

    // Motion
    public sealed class MoveStraight : Delta
    {
        public int Id; public V2 From; public V2 To; public Dir Dir; public int Tiles; public string Kind;
        public MoveStraight(int id, V2 from, V2 to, Dir dir, int tiles, string kind)
        { Id = id; From = from; To = to; Dir = dir; Tiles = tiles; Kind = kind; }
    }

    public sealed class MoveEntity : Delta
    {
        public int Id; public V2 From; public V2 To; public string Kind;
        public MoveEntity(int id, V2 from, V2 to, string kind)
        { Id = id; From = from; To = to; Kind = kind; }
    }

    // State changes
    public sealed class DestroyEntity : Delta
    {
        public int Id; public V2 At; public string Kind;
        public DestroyEntity(int id, V2 at, string kind) { Id = id; At = at; Kind = kind; }
    }

    public sealed class SetAttachment : Delta
    {
        public int? EntityId; public Dir? EntryDir;
        public SetAttachment(int? entityId, Dir? entryDir) { EntityId = entityId; EntryDir = entryDir; }
    }

    public sealed class SetGameOver : Delta { }
    public sealed class SetWin : Delta { }

    // Buttons / toggles
    public sealed class ButtonStateChanged : Delta
    {
        public bool AnyPressed;
        public ButtonStateChanged(bool anyPressed) { AnyPressed = anyPressed; }
    }

    // Generic cue
    public sealed class AnimationCue : Delta
    {
        public CueType Type; public V2? At; public float Intensity;
        public AnimationCue(CueType type, V2? at, float intensity)
        { Type = type; At = at; Intensity = intensity; }
    }

    public sealed class StepResult
    {
        public readonly List<Delta> Deltas = new List<Delta>();
        public bool GameOver;
        public bool Win;
        public void Add(Delta d) => Deltas.Add(d);
    }
}

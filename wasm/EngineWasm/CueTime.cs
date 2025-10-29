namespace SlimeGrid.Logic.Animation
{
    // Base durations for the presenter; your runtime animator can compress these
    // when the player inputs faster (A1).
    public static class CueTime
    {
        public const float Slide = 0.30f;
        public const float Push = 0.30f;
        public const float Tumble = 0.30f;
        public const float Fly = 0.35f;
        public const float Bump = 0.40f;
        public const float Break = 0.60f;
    }
}

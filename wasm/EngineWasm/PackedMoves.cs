#if UNITY_EDITOR
using System;

namespace SlimeGrid.Tools.Solver
{
    // 2-bit per move packing: 0=N,1=E,2=S,3=W
    public struct PackedMoves
    {
        public byte[] Buffer; // 4 moves per byte
        public int Length;    // number of moves

        public PackedMoves(int capacityMoves)
        {
            int bytes = (capacityMoves + 3) >> 2;
            Buffer = new byte[bytes];
            Length = 0;
        }

        public void EnsureCapacity(int moves)
        {
            int needBytes = (moves + 3) >> 2;
            if (Buffer == null) Buffer = new byte[Math.Max(4, needBytes)];
            if (Buffer.Length < needBytes)
            {
                Array.Resize(ref Buffer, Math.Max(Buffer.Length * 2, needBytes));
            }
        }

        public void Clear() { Length = 0; }

        public void Push(byte move)
        {
            int idx = Length;
            EnsureCapacity(idx + 1);
            int byteIdx = idx >> 2;
            int shift = (idx & 3) * 2;
            Buffer[byteIdx] &= (byte)~(0b11 << shift);
            Buffer[byteIdx] |= (byte)((move & 0b11) << shift);
            Length = idx + 1;
        }

        public void Pop()
        {
            if (Length <= 0) return;
            int idx = Length - 1;
            int byteIdx = idx >> 2;
            int shift = (idx & 3) * 2;
            Buffer[byteIdx] &= (byte)~(0b11 << shift);
            Length = idx;
        }

        public byte GetAt(int i)
        {
            int byteIdx = i >> 2;
            int shift = (i & 3) * 2;
            return (byte)((Buffer[byteIdx] >> shift) & 0b11);
        }

        public PackedMoves Snapshot()
        {
            var outBytes = new byte[(Length + 3) >> 2];
            Array.Copy(Buffer, outBytes, outBytes.Length);
            return new PackedMoves { Buffer = outBytes, Length = Length };
        }

        // Threshold-bounded Levenshtein on 2-bit sequences without allocations.
        public static bool EditDistanceLeq(in PackedMoves a, in PackedMoves b, int maxCost)
        {
            int n = a.Length;
            int m = b.Length;
            if (Math.Abs(n - m) > maxCost) return false;

            // Use two rows with early-exit; rows sized m+1.
            if (m <= 256)
            {
                Span<int> prev = stackalloc int[m + 1];
                Span<int> cur = stackalloc int[m + 1];
                for (int j = 0; j <= m; j++) prev[j] = j;

                for (int i = 1; i <= n; i++)
                {
                    cur[0] = i;

                    int from = Math.Max(1, i - maxCost);
                    int to = Math.Min(m, i + maxCost);

                    if (from > 1) cur[from - 1] = int.MaxValue / 4;
                    for (int j = from; j <= to; j++)
                    {
                        int cost = (a.GetAt(i - 1) == b.GetAt(j - 1)) ? 0 : 1;
                        int del = prev[j] + 1;
                        int ins = cur[j - 1] + 1;
                        int sub = prev[j - 1] + cost;
                        int v = del < ins ? del : ins;
                        if (sub < v) v = sub;
                        cur[j] = v;
                    }
                    if (to < m) cur[to + 1 <= m ? to + 1 : to] = int.MaxValue / 4;

                    int minInRow = int.MaxValue;
                    for (int j = from; j <= to; j++) if (cur[j] < minInRow) minInRow = cur[j];
                    if (minInRow > maxCost) return false;

                    // swap buffers
                    var tmp = prev; prev = cur; cur = tmp;
                }

                return prev[m] <= maxCost;
            }
            else
            {
                var prevArr = new int[m + 1];
                var curArr = new int[m + 1];
                for (int j = 0; j <= m; j++) prevArr[j] = j;

                for (int i = 1; i <= n; i++)
                {
                    curArr[0] = i;
                    int from = Math.Max(1, i - maxCost);
                    int to = Math.Min(m, i + maxCost);
                    if (from > 1) curArr[from - 1] = int.MaxValue / 4;
                    for (int j = from; j <= to; j++)
                    {
                        int cost = (a.GetAt(i - 1) == b.GetAt(j - 1)) ? 0 : 1;
                        int del = prevArr[j] + 1;
                        int ins = curArr[j - 1] + 1;
                        int sub = prevArr[j - 1] + cost;
                        int v = del < ins ? del : ins;
                        if (sub < v) v = sub;
                        curArr[j] = v;
                    }
                    if (to < m) curArr[to + 1 <= m ? to + 1 : to] = int.MaxValue / 4;

                    int minInRow = int.MaxValue;
                    for (int j = from; j <= to; j++) if (curArr[j] < minInRow) minInRow = curArr[j];
                    if (minInRow > maxCost) return false;

                    var tmpArr = prevArr; prevArr = curArr; curArr = tmpArr;
                }
                return prevArr[m] <= maxCost;
            }
        }
    }
}
#endif

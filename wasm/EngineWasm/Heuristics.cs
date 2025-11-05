using System;
using System.Collections.Generic;
using System.Linq;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    public static class Heuristics
    {
        // --- New: annotate traces with per-step events/special (Top-1) and build mechanics summary (Top-3)
        public static void AnnotateReport(SolverReport report)
        {
            if (report == null) return;
            var traces = report.solutionTraces;
            if (traces == null || traces.Length == 0) return;

            // eid -> ei mapping for byEntity keys
            var eidToEi = new Dictionary<int, int>();
            try
            {
                var ents = report.levelSnapshot?.entities;
                if (ents != null)
                    for (int i = 0; i < ents.Length; i++) eidToEi[ents[i].eid] = i;
            }
            catch { }

            // Helper: trait tags from tile-only mask
            static List<string> TraitTags(ulong m)
            {
                var tags = new List<string>(8);
                if (((m & (ulong)(SlimeGrid.Logic.Traits.SlipperyForPlayer | SlimeGrid.Logic.Traits.SlipperyForEntity)) != 0)) tags.Add("OnSlipery");
                if (((m & (ulong)SlimeGrid.Logic.Traits.HoleForPlayer) != 0)) tags.Add("HazardForPlayer");
                if (((m & (ulong)SlimeGrid.Logic.Traits.HoleForEntity) != 0)) tags.Add("HazardForEntity");
                if (((m & (ulong)SlimeGrid.Logic.Traits.ButtonToggle) != 0)) tags.Add("IsButtonToggle");
                if (((m & (ulong)SlimeGrid.Logic.Traits.ButtonAllowExit) != 0)) tags.Add("IsButtonAllowExit");
                if (((m & (ulong)SlimeGrid.Logic.Traits.ToggleableByButton) != 0)) tags.Add("ToggleableByButton");
                if (((m & (ulong)SlimeGrid.Logic.Traits.ToggleableByEntity) != 0)) tags.Add("ToggleableByEntity");
                if (((m & (ulong)SlimeGrid.Logic.Traits.ToggleableByPlayer) != 0)) tags.Add("ToggleableByPlayer");
                if (((m & (ulong)SlimeGrid.Logic.Traits.UntoggleableByButton) != 0)) tags.Add("UntoggleableByButton");
                if (((m & (ulong)SlimeGrid.Logic.Traits.UntoggleableByEntity) != 0)) tags.Add("UntoggleableByEntity");
                if (((m & (ulong)SlimeGrid.Logic.Traits.UntoggleableByPlayer) != 0)) tags.Add("UntoggleableByPlayer");
                if (((m & (ulong)SlimeGrid.Logic.Traits.ExitPlayer) != 0)) tags.Add("IsExit");
                return tags;
            }

            static string PushLabel(string type)
            {
                if (string.IsNullOrEmpty(type)) return "Push";
                if (type.Contains("Triangle", StringComparison.OrdinalIgnoreCase)) return "PushTriangle";
                if (type.Contains("Tipping", StringComparison.OrdinalIgnoreCase)) return "PushTipping";
                if (type.Contains("Unattach", StringComparison.OrdinalIgnoreCase)) return "PushUnattachable";
                if (type.Contains("Box", StringComparison.OrdinalIgnoreCase)) return "PushBox";
                return "Push";
            }

            // Build top1 events/special and collect interaction counts
            var top1 = traces[0];
            var interactionsTop1 = new HashSet<string>(StringComparer.Ordinal);
            var countsTop1 = new Dictionary<string, int>(StringComparer.Ordinal);

            for (int i = 0; i < (top1.steps?.Length ?? 0); i++)
            {
                var st = top1.steps[i];
                var ev = new List<string>(8);

                // Movement-derived events
                int movedN = st.moved?.Length ?? 0;
                if (movedN == 0) ev.Add("MoveFree");
                else if (movedN == 1) ev.Add(PushLabel(st.moved[0].type));
                else if (movedN > 1) ev.Add("MultiPush");

                if (st.playerOnSlipPrev == false && st.playerOnSlipNext == true) ev.Add("SlideStart_Player");
                if (st.playerOnSlipPrev == true && st.playerOnSlipNext == true) ev.Add("SlideStep_Player");
                if (st.playerOnSlipPrev == true && st.playerOnSlipNext == false) ev.Add("SlideEnd_Player");

                if (st.anyButtonPrev != st.anyButtonNext) ev.Add(st.anyButtonNext ? "PlatePress" : "PlateRelease");
                if (st.exitActivePrev != st.exitActiveNext) ev.Add(st.exitActiveNext ? "ExitOpen" : "ExitClose");
                if (((st.playerDestTraitsMask & (ulong)SlimeGrid.Logic.Traits.ExitPlayer) != 0) && st.exitActiveNext) ev.Add("ExitReach");

                // Orientation changes per moved entity
                if (movedN > 0)
                {
                    foreach (var me in st.moved)
                    {
                        if (me.orientPrev != me.orientNext)
                        {
                            var lbl = me.type.Contains("Triangle", StringComparison.OrdinalIgnoreCase) ? "OrientChange_TriBox"
                                : (me.type.Contains("Box", StringComparison.OrdinalIgnoreCase) ? "OrientChange_Box" : "OrientChange_Entity");
                            ev.Add(lbl);
                        }
                    }
                }

                // Toggles (generic on/off)
                if (st.tileDeltas != null)
                {
                    foreach (var td in st.tileDeltas)
                    {
                        int onBits = PopCount(td.traitsNextMask);
                        int offBits = PopCount(td.traitsPrevMask);
                        ev.Add(onBits > offBits ? "ToggleOn" : "ToggleOff");
                    }
                }

                st.events = ev.ToArray();
                // Special lists
                var spec = new SpecialLists { byAction = new Dictionary<string, SpecialHit[]>(), byEntity = new Dictionary<string, SpecialHit[]>() };

                void AddAction(string key, ulong mask, int x, int y)
                {
                    if (mask == 0) return;
                    var arr = TraitTags(mask).Select(t => new SpecialHit { tag = t, x = x, y = y }).ToArray();
                    if (arr.Length == 0) return;
                    spec.byAction[key] = arr;
                }

                // Player destination context (under movement kind)
                foreach (var t in TraitTags(st.playerDestTraitsMask))
                {
                    var key = "player";
                    if (!spec.byEntity.TryGetValue(key, out var cur)) cur = Array.Empty<SpecialHit>();
                    var nxt = new List<SpecialHit>(cur) { new SpecialHit { tag = t, x = st.playerTo.x, y = st.playerTo.y } };
                    spec.byEntity[key] = nxt.ToArray();
                }
                // byAction: MoveFree/slide/fly
                var actionKey = st.moveKind?.Length > 0 ? st.moveKind : (movedN > 0 ? "push" : "move");
                AddAction(actionKey, st.playerDestTraitsMask, st.playerTo.x, st.playerTo.y);

                // Push actions + entity specials
                if (movedN > 0)
                {
                    foreach (var me in st.moved)
                    {
                        var lbl = PushLabel(me.type);
                        AddAction(lbl, me.destTraitsMask, me.to.x, me.to.y);
                        if (eidToEi.TryGetValue(me.eid, out var ei))
                        {
                            var key = $"ei:{ei}";
                            foreach (var t in TraitTags(me.destTraitsMask))
                            {
                                if (!spec.byEntity.TryGetValue(key, out var cur)) cur = Array.Empty<SpecialHit>();
                                var lst = new List<SpecialHit>(cur) { new SpecialHit { tag = t, x = me.to.x, y = me.to.y } };
                                spec.byEntity[key] = lst.ToArray();
                            }
                        }
                    }
                }
                // Toggle positions as generic 'Toggle' action
                if (st.tileDeltas != null && st.tileDeltas.Length > 0)
                {
                    var hits = new List<SpecialHit>();
                    foreach (var td in st.tileDeltas) hits.Add(new SpecialHit { tag = "Toggled", x = td.pos.x, y = td.pos.y });
                    spec.byAction["Toggle"] = hits.ToArray();
                }

                st.special = spec;
                top1.steps[i] = st;

                // Fold interactions into sets and counts
                foreach (var a in st.events)
                {
                    interactionsTop1.Add(a);
                    countsTop1[a] = (countsTop1.TryGetValue(a, out var c) ? c : 0) + 1;
                }
            }
            // Persist top1 back
            traces[0] = top1;

            // Build Top-3 interactions (sets only), dedup identical solutions by NESW
            var uniq = new List<(string nesw, SolutionTrace tr)>();
            for (int i = 0; i < Math.Min(3, traces.Length); i++)
            {
                var nesw = (report.topSolutions != null && report.topSolutions.Count > i) ? (report.topSolutions[i].movesNESW ?? string.Empty) : string.Empty;
                if (uniq.Any(u => u.nesw == nesw)) continue;
                uniq.Add((nesw, traces[i]));
            }
            var sets = new List<HashSet<string>>();
            for (int k = 0; k < uniq.Count; k++)
            {
                var set = new HashSet<string>(StringComparer.Ordinal);
                var tr = uniq[k].tr;
                for (int i = 0; i < (tr.steps?.Length ?? 0); i++)
                {
                    // Recreate tags shallowly for top2/3 without storing
                    var st = tr.steps[i];
                    int movedN = st.moved?.Length ?? 0;
                    if (movedN == 0) set.Add("MoveFree");
                    else if (movedN == 1) set.Add(PushLabel(st.moved[0].type));
                    else if (movedN > 1) set.Add("MultiPush");
                    if (st.playerOnSlipPrev == false && st.playerOnSlipNext == true) set.Add("SlideStart_Player");
                    if (st.playerOnSlipPrev == true && st.playerOnSlipNext == true) set.Add("SlideStep_Player");
                    if (st.playerOnSlipPrev == true && st.playerOnSlipNext == false) set.Add("SlideEnd_Player");
                    if (st.anyButtonPrev != st.anyButtonNext) set.Add(st.anyButtonNext ? "PlatePress" : "PlateRelease");
                    if (st.exitActivePrev != st.exitActiveNext) set.Add(st.exitActiveNext ? "ExitOpen" : "ExitClose");
                    if (((st.playerDestTraitsMask & (ulong)SlimeGrid.Logic.Traits.ExitPlayer) != 0) && st.exitActiveNext) set.Add("ExitReach");
                }
                sets.Add(set);
            }
            var topSets = sets.ToArray();
            HashSet<string> strong = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> uni = new HashSet<string>(StringComparer.Ordinal);
            if (topSets.Length > 0)
            {
                strong = new HashSet<string>(topSets[0], StringComparer.Ordinal);
                for (int i = 1; i < topSets.Length; i++) strong.IntersectWith(topSets[i]);
                uni = new HashSet<string>(topSets[0], StringComparer.Ordinal);
                for (int i = 1; i < topSets.Length; i++) uni.UnionWith(topSets[i]);
            }
            var soft = new HashSet<string>(interactionsTop1, StringComparer.Ordinal);
            soft.ExceptWith(strong);

            // Attach mechanics summary
            report.mechanics = new MechanicsSummary
            {
                top1 = new MechanicsTop1
                {
                    interactions = interactionsTop1.OrderBy(x => x).ToArray(),
                    counts = countsTop1
                },
                top3 = topSets.Select(s => new MechanicsTop { interactions = s.OrderBy(x => x).ToArray() }).ToArray(),
                classification = new MechanicsClassification
                {
                    strong = strong.OrderBy(x => x).ToArray(),
                    soft = soft.OrderBy(x => x).ToArray(),
                    common = uni.Except(strong).OrderBy(x => x).ToArray()
                }
            };
        }

        static int PopCount(ulong x)
        {
            int c = 0;
            while (x != 0) { x &= x - 1; c++; }
            return c;
        }

        public static Dictionary<string, float> ComputeFeatures(SolverReport report)
        {
            var f = new Dictionary<string, float>();
            f["solutionLength"] = report.topSolutions.Count > 0 ? report.topSolutions[0].length : 0;
            f["solutionsFilteredCount"] = report.solutionsFilteredCount;
            f["solutionsTotalCount"] = report.solutionsTotalCount;
            f["deadEndsCount"] = report.deadEndsCount;
            f["deadEndsAverageDepth"] = (float)report.deadEndsAverageDepth;
            f["nodesExplored"] = report.nodesExplored;
            f["maxDepthReached"] = report.maxDepthReached;
            f["deadEndsNearTop1Count"] = report.deadEndsNearTop1Count;
            f["deadEndsNearTop3Count"] = report.deadEndsNearTop3Count;
            // Move analysis features (top solutions)
            f["stepsInBoxTop1"] = report.stepsInBoxTop1;
            f["stepsFreeTop1"] = report.stepsFreeTop1;
            f["dedupMovesLenTop1"] = report.dedupMovesLenTop1;
            f["stepsInBoxTop3Avg"] = (float)report.stepsInBoxTop3Avg;
            f["stepsFreeTop3Avg"] = (float)report.stepsFreeTop3Avg;
            f["dedupMovesLenTop3Avg"] = (float)report.dedupMovesLenTop3Avg;
            f["precheck.hasExitInComponent"] = report.solvedTag == "false" && report.nodesExplored == 0 ? 0 : 1;
            f["capped"] = report.solvedTag == "capped" ? 1 : 0;
            return f;
        }

        // Evaluate derived features from expressions over base features
        public static void ApplyDerivedFeatures(Dictionary<string, float> f, IEnumerable<SlimeGrid.Tools.ALD.DerivedFeatureConfig> derived)
        {
            if (derived == null) return;
            foreach (var d in derived)
            {
                if (string.IsNullOrWhiteSpace(d?.id) || string.IsNullOrWhiteSpace(d.expr)) continue;
                try { f[d.id] = (float)EvalExpr(d.expr, f); }
                catch { /* ignore invalid derived feature */ }
            }
        }

        // Minimal expression evaluator for +,-,*,/, parentheses and variable names
        static double EvalExpr(string expr, IReadOnlyDictionary<string, float> vars)
        {
            var tokens = Tokenize(expr);
            int i = 0;
            double ParsePrimary()
            {
                if (i >= tokens.Count) throw new Exception("unexpected end");
                var t = tokens[i++];
                if (t.kind == "num") return t.num;
                if (t.kind == "id") return vars.TryGetValue(t.text, out var v) ? v : 0.0;
                if (t.text == "(") { var v = ParseAddSub(); if (i>=tokens.Count || tokens[i++].text!=")") throw new Exception("paren"); return v; }
                if (t.text == "+") return +ParsePrimary();
                if (t.text == "-") return -ParsePrimary();
                throw new Exception("bad token");
            }
            double ParseMulDiv()
            {
                double v = ParsePrimary();
                while (i < tokens.Count && (tokens[i].text == "*" || tokens[i].text == "/"))
                {
                    string op = tokens[i++].text; double rhs = ParsePrimary();
                    v = op == "*" ? v * rhs : v / (Math.Abs(rhs) < 1e-12 ? 1e-12 : rhs);
                }
                return v;
            }
            double ParseAddSub()
            {
                double v = ParseMulDiv();
                while (i < tokens.Count && (tokens[i].text == "+" || tokens[i].text == "-"))
                {
                    string op = tokens[i++].text; double rhs = ParseMulDiv();
                    v = op == "+" ? v + rhs : v - rhs;
                }
                return v;
            }
            return ParseAddSub();
        }

        static List<(string kind, string text, double num)> Tokenize(string s)
        {
            var list = new List<(string,string,double)>();
            int n = s.Length, i = 0;
            while (i < n)
            {
                char c = s[i];
                if (char.IsWhiteSpace(c)) { i++; continue; }
                if (char.IsDigit(c) || c=='.')
                {
                    int j=i; while (j<n && (char.IsDigit(s[j]) || s[j]=='.')) j++;
                    var sub = s.Substring(i, j-i);
                    double val = 0; double.TryParse(sub, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out val);
                    list.Add(("num", sub, val)); i=j; continue;
                }
                if (char.IsLetter(c) || c=='_' )
                {
                    int j=i; while (j<n && (char.IsLetterOrDigit(s[j]) || s[j]=='_' )) j++;
                    var id = s.Substring(i, j-i);
                    list.Add(("id", id, 0)); i=j; continue;
                }
                // operators and parens
                list.Add(("sym", c.ToString(), 0)); i++;
            }
            return list;
        }

        public static (float raw, bool reject) Score(BucketConfig bucket, Dictionary<string, float> features, float acceptCappedWeight)
        {
            float raw = 0f; bool reject = false;
            foreach (var fc in bucket.features)
            {
                float val = features.TryGetValue(fc.id, out var v) ? v : 0f;
                float s = 0f;
                if (fc.mode == FeatureMode.Band)
                {
                    bool inside = (val >= fc.bandMin && val <= fc.bandMax);
                    if (fc.hard && !inside) { reject = true; break; }
                    if (inside) s = 1f; else
                    {
                        float d = val < fc.bandMin ? (fc.bandMin - val) : (val - fc.bandMax);
                        s = Math.Max(0f, 1f - d / Math.Max(1f, fc.bandMax - fc.bandMin));
                    }
                }
                else // Infinite (monotonic increasing) – simple identity for now
                {
                    s = val;
                }
                if (fc.hard && s <= 0f) { reject = true; break; }
                raw += fc.weight * s;
            }
            // If capped, weight down
            if (features.TryGetValue("capped", out var capped) && capped > 0.5f)
                raw *= acceptCappedWeight;
            return (raw, reject);
        }
    }
}

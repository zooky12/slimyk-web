using System;
using System.Collections.Generic;
using SlimeGrid.Tools.Solver;

namespace SlimeGrid.Tools.ALD
{
    public static class Heuristics
    {
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

#if UNITY_EDITOR
using System.IO;
using Newtonsoft.Json;
using SlimeGrid.Logic;
using UnityEditor;
using UnityEngine;

namespace SlimeGrid.Tools.Solver
{
    public static class MenuItems
    {
        [MenuItem("Tools/Solver/Analyze From JSON…", priority = 10)]
        public static void AnalyzeFromJson()
        {
            string path = EditorUtility.OpenFilePanel("Select level JSON", Application.dataPath, "json");
            if (string.IsNullOrEmpty(path)) return;
            string json = File.ReadAllText(path);
            GameState s;
            try { s = Loader.FromJson(json); }
            catch (System.Exception ex)
            {
                EditorUtility.DisplayDialog("Solver", "Failed to load level: " + ex.Message, "OK");
                return;
            }

            var cfg = new SolverConfig(); // defaults per spec; time cap disabled by default
            var report = BruteForceSolver.Analyze(s, cfg);

            // Write report under Assets/Tools/SolverReports
            var reportsDir = Path.Combine(Application.dataPath, "Tools/SolverReports");
            Directory.CreateDirectory(reportsDir);

            var levelName = Path.GetFileNameWithoutExtension(path);
            var fileName = $"{levelName}.{report.solvedTag}.json";
            var outPath = Path.Combine(reportsDir, fileName);

            var jsonOut = JsonConvert.SerializeObject(report, Formatting.Indented);
            File.WriteAllText(outPath, jsonOut);
            AssetDatabase.Refresh();
            EditorUtility.RevealInFinder(outPath);
            EditorUtility.DisplayDialog("Solver", $"Done. Solutions: {report.solutionsFilteredCount}/{report.solutionsTotalCount}. Dead ends: {report.deadEndsCount}.", "OK");
        }
    }
}
#endif


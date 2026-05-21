namespace PolyTrader.Api;

/// <summary>
/// Loads KEY=VALUE pairs from a repo-root <c>.env</c> into process environment variables
/// (only when not already set), so <c>dotnet run</c> matches Docker <c>env_file</c> behavior.
/// </summary>
internal static class EnvFileLoader
{
    public static void LoadFromAncestors(string startDirectory, int maxDepth = 8)
    {
        var dir = new DirectoryInfo(startDirectory);
        for (var depth = 0; depth < maxDepth && dir != null; depth++, dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, ".env");
            if (!File.Exists(path))
            {
                continue;
            }

            foreach (var (key, value) in Parse(File.ReadAllLines(path)))
            {
                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                {
                    Environment.SetEnvironmentVariable(key, value);
                }
            }

            return;
        }
    }

    private static IEnumerable<(string Key, string Value)> Parse(IEnumerable<string> lines)
    {
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            var eq = line.IndexOf('=');
            if (eq <= 0)
            {
                continue;
            }

            var key = line[..eq].Trim();
            if (key.Length == 0)
            {
                continue;
            }

            var value = line[(eq + 1)..].Trim();
            if (value.Length >= 2
                && ((value[0] == '"' && value[^1] == '"')
                    || (value[0] == '\'' && value[^1] == '\'')))
            {
                value = value[1..^1];
            }

            yield return (key, value);
        }
    }
}

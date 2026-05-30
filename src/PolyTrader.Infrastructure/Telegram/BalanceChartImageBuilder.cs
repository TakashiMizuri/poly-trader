using PolyTrader.Infrastructure.Services;
using ScottPlot;

namespace PolyTrader.Infrastructure.Telegram;

public sealed class BalanceChartImageBuilder
{
    public byte[] BuildPng(BalanceHistoryResult history, string title)
    {
        var plot = new Plot();
        plot.Title(title);
        plot.Axes.DateTimeTicksBottom();

        if (history.Actual.Count > 0)
        {
            var actualXs = history.Actual.Select(p => DateTimeOffset.FromUnixTimeSeconds(p.Time).DateTime).ToArray();
            var actualYs = history.Actual.Select(p => p.Value).ToArray();
            var actual = plot.Add.Scatter(actualXs, actualYs);
            actual.LegendText = "Actual";
            actual.Color = Colors.SteelBlue;
            actual.LineWidth = 2;
        }

        plot.ShowLegend(Alignment.UpperLeft);
        plot.Axes.Margins(bottom: 0.12, left: 0.1, right: 0.05, top: 0.12);
        plot.Grid.MajorLineColor = Colors.LightGray.WithAlpha(0.4);

        return plot.GetImageBytes(900, 480, ImageFormat.Png);
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later
//
// Tiny inline bar sparkline. Each bar = one day's run count, scaled
// to the max bar in the series. No chart lib — twelve <div>s.

export function Sparkline({
  series,
  height = 18,
}: {
  series: number[];
  height?: number;
}) {
  const max = Math.max(1, ...series);
  return (
    <div
      className="flex items-end gap-[2px]"
      style={{ height }}
      aria-label={`activity, last ${series.length} days`}
    >
      {series.map((v, i) => {
        const pct = (v / max) * 100;
        return (
          <div
            key={i}
            title={`${v} run${v === 1 ? "" : "s"}`}
            className={`w-1 flex-shrink-0 rounded-sm ${
              v > 0 ? "bg-accent" : "bg-border"
            }`}
            style={{ height: `${Math.max(4, pct)}%` }}
          />
        );
      })}
    </div>
  );
}

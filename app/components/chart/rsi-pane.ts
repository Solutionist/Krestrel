// The RSI pane (ADR 0014): RSI line, shaded overbought/oversold zones, level lines, and Buy/Sell
// markers where RSI leaves a zone. Plain Lightweight Charts code; created inside an effect.

import {
  BaselineSeries,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  LineSeries,
  LineStyle,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { IndicatorValue } from "~/lib/indicators";
import { type RsiLevels, rsiCrosses } from "~/lib/rsi-signal";

import type { ChartTheme } from "./chart-theme";

export interface RsiPane {
  /**
   * Draws RSI for `times` (epoch seconds, one per candle). `full` replaces every point;
   * otherwise only the latest point updates (live). Levels and markers always refresh.
   */
  render(
    times: readonly number[],
    values: readonly IndicatorValue[],
    levels: RsiLevels,
    full: boolean,
  ): void;
  remove(): void;
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";
const FIXED_SCALE = () => ({ priceRange: { minValue: 0, maxValue: 100 } });

export function createRsiPane(chart: IChartApi, theme: ChartTheme, paneIndex: number): RsiPane {
  const quiet = {
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    autoscaleInfoProvider: FIXED_SCALE,
  } as const;
  // Zones first so the RSI line draws on top. A baseline series fills between the line and its
  // base value: above the overbought level in red, below the oversold level in green.
  const overboughtZone = chart.addSeries(
    BaselineSeries,
    {
      ...quiet,
      lineWidth: 1,
      topLineColor: TRANSPARENT,
      bottomLineColor: TRANSPARENT,
      topFillColor1: theme.line("--color-fall", 0.25),
      topFillColor2: theme.line("--color-fall", 0.05),
      bottomFillColor1: TRANSPARENT,
      bottomFillColor2: TRANSPARENT,
    },
    paneIndex,
  );
  const oversoldZone = chart.addSeries(
    BaselineSeries,
    {
      ...quiet,
      lineWidth: 1,
      topLineColor: TRANSPARENT,
      bottomLineColor: TRANSPARENT,
      topFillColor1: TRANSPARENT,
      topFillColor2: TRANSPARENT,
      bottomFillColor1: theme.line("--color-rise", 0.05),
      bottomFillColor2: theme.line("--color-rise", 0.25),
    },
    paneIndex,
  );
  const line = chart.addSeries(
    LineSeries,
    {
      ...quiet,
      color: theme.line("--color-ind-2"),
      lineWidth: 1,
      lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (value: number) => value.toFixed(0), minMove: 1 },
    },
    paneIndex,
  );
  line.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 }, borderVisible: false });
  const markers = createSeriesMarkers(line, []);
  let levelLines: IPriceLine[] = [];
  let drawnLevels: RsiLevels | null = null;

  const drawLevels = (levels: RsiLevels) => {
    if (drawnLevels?.overbought === levels.overbought && drawnLevels.oversold === levels.oversold) {
      return;
    }
    for (const priceLine of levelLines) line.removePriceLine(priceLine);
    levelLines = [
      { price: levels.overbought, color: theme.line("--color-fall", 0.75), label: true },
      // Midline: the crosshair tone reads on both surfaces, where the faint grid would vanish.
      { price: 50, color: theme.crosshair, label: false },
      { price: levels.oversold, color: theme.line("--color-rise", 0.75), label: true },
    ].map(({ price, color, label }) =>
      line.createPriceLine({
        price,
        color,
        lineStyle: LineStyle.Dotted,
        lineWidth: 1,
        axisLabelVisible: label,
      }),
    );
    overboughtZone.applyOptions({ baseValue: { type: "price", price: levels.overbought } });
    oversoldZone.applyOptions({ baseValue: { type: "price", price: levels.oversold } });
    drawnLevels = levels;
  };

  return {
    render(times, values, levels, full) {
      drawLevels(levels);
      if (full) {
        const points = times.flatMap((time, i) => {
          const value = values[i];
          return value == null ? [] : [{ time: time as UTCTimestamp, value }];
        });
        line.setData(points);
        // Zone fills only where RSI is inside the zone: elsewhere the point sits on the base.
        overboughtZone.setData(
          points.map(({ time, value }) => ({ time, value: Math.max(value, levels.overbought) })),
        );
        oversoldZone.setData(
          points.map(({ time, value }) => ({ time, value: Math.min(value, levels.oversold) })),
        );
      } else {
        const time = times.at(-1);
        const value = values.at(-1);
        if (time === undefined || value == null) return;
        const point = { time: time as UTCTimestamp };
        line.update({ ...point, value });
        overboughtZone.update({ ...point, value: Math.max(value, levels.overbought) });
        oversoldZone.update({ ...point, value: Math.min(value, levels.oversold) });
      }
      // Buy/Sell where RSI leaves a zone.
      const crosses = rsiCrosses(values, levels);
      markers.setMarkers(
        crosses.flatMap((cross, n): SeriesMarker<Time>[] => {
          const time = times[cross.index];
          if (time === undefined) return [];
          const latest = n === crosses.length - 1;
          // Older crosses stay as small ticks; the latest is full size with its label.
          const size = latest ? 1 : 0.4;
          return [
            cross.kind === "buy"
              ? {
                  time: time as UTCTimestamp,
                  position: "belowBar",
                  shape: "arrowUp",
                  color: theme.rise,
                  size,
                  text: latest ? "Buy" : "",
                }
              : {
                  time: time as UTCTimestamp,
                  position: "aboveBar",
                  shape: "arrowDown",
                  color: theme.fall,
                  size,
                  text: latest ? "Sell" : "",
                },
          ];
        }),
      );
    },
    remove() {
      markers.detach();
      chart.removeSeries(line);
      chart.removeSeries(overboughtZone);
      chart.removeSeries(oversoldZone);
    },
  };
}

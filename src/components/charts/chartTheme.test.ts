import { semanticThemes } from '@/theme/tokens';
import { buildChartTheme, chartSeriesStyles, formatChartValue } from './chartTheme';

describe('chartTheme', () => {
  it('maps all eight semantic chart colors in both themes', () => {
    expect(chartSeriesStyles(semanticThemes.light).map((style) => style.color)).toEqual([
      semanticThemes.light.chart.series01,
      semanticThemes.light.chart.series02,
      semanticThemes.light.chart.series03,
      semanticThemes.light.chart.series04,
      semanticThemes.light.chart.series05,
      semanticThemes.light.chart.series06,
      semanticThemes.light.chart.series07,
      semanticThemes.light.chart.series08,
    ]);
    expect(buildChartTheme(semanticThemes.dark)).toMatchObject({
      backgroundColor: semanticThemes.dark.background.canvas,
      textStyle: { color: semanticThemes.dark.text.secondary },
    });
  });

  it('distinguishes the first four line series without relying on color', () => {
    const styles = chartSeriesStyles(semanticThemes.light).slice(0, 4);
    expect(new Set(styles.map(({ lineType, symbol }) => `${lineType}:${symbol}`)).size).toBe(4);
  });

  it('formats chart values consistently', () => {
    expect(formatChartValue(12500)).toBe('1.25万');
    expect(formatChartValue(128.5)).toBe('128.50');
    expect(formatChartValue(null)).toBe('—');
  });
});

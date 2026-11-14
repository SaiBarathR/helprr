// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayActivityChart } from './jellyfin-stats-charts';

// 30 days with plays, Oct 16 – Nov 14: the daily view.
const usage: Record<string, number> = {};
for (let i = 0; i < 30; i++) {
  const d = new Date(2026, 9, 16 + i, 12);
  usage[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = 1 + (i % 4);
}
const data = [{ user_id: 'u1', user_name: 'sai', user_usage: usage }];
const label = (day: number, month = 10) => new Date(2026, month, day, 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function axisLabels(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLSpanElement>('span.absolute')];
}

describe('Play Activity date axis', () => {
  it('spaces whole labels a slot apart, counted back from the last day', () => {
    // 400px fits 8 labels: every 4th bar from the last.
    const { container } = render(<PlayActivityChart data={data} width={400} />);
    const labels = axisLabels(container);
    expect(labels.map((l) => l.textContent)).toEqual([
      label(17, 9), label(21, 9), label(25, 9), label(29, 9), label(2), label(6), label(10), label(14),
    ]);
  });

  it('pins the end labels inside the chart instead of centring them past its edge', () => {
    const { container } = render(<PlayActivityChart data={data} width={2000} />);
    const labels = axisLabels(container);
    expect(labels).toHaveLength(30);
    expect(labels[0].style.left).toBe('0px');
    expect(labels[29].style.right).toBe('0px');
    expect(labels[1].style.transform).toBe('translateX(-50%)');
  });
});

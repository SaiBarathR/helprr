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
    // A 400px body leaves a 376px bar row: 7 slots, so every 5th bar from the last (6 labels).
    const { container } = render(<PlayActivityChart data={data} width={400} />);
    const labels = axisLabels(container);
    expect(labels.map((l) => l.textContent)).toEqual([
      label(20, 9), label(25, 9), label(30, 9), label(4), label(9), label(14),
    ]);
  });

  it('shows only the last label in a one-column phone cell, where two overlapped', () => {
    // A 60px body leaves a 36px bar row: room for one ~24px label, not two.
    const { container } = render(<PlayActivityChart data={data} width={60} />);
    expect(axisLabels(container).map((l) => l.textContent)).toEqual([label(14)]);
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

describe('Play Activity legend and stats in narrow cells', () => {
  const two = [...data, { user_id: 'u2', user_name: 'guest', user_usage: usage }];

  it('names each viewer where there is room, with bars split by viewer', () => {
    const { container } = render(<PlayActivityChart data={two} width={400} />);
    expect(container.textContent).toContain('guest');
    expect(container.textContent).toContain('/day avg');
  });

  it('drops the legend in a narrow cell, where it pushed the bars out, and draws one-colour bars', () => {
    // A two-column phone cell or a 3-column tablet cell beside the sidebar.
    const { container } = render(<PlayActivityChart data={two} width={160} />);
    expect(container.textContent).not.toContain('guest');
    expect(container.querySelector('.flex-col-reverse')).toBeNull();
    expect(container.textContent).toContain('total plays');
    expect(container.textContent).toContain('/day avg');
  });

  it('keeps the total whole in a one-column cell and leaves out the average, which cannot fit', () => {
    const { container } = render(<PlayActivityChart data={two} width={64} />);
    expect(container.textContent).toContain('total plays');
    expect(container.textContent).not.toContain('/day avg');
  });
});

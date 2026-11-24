// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HistoryEventIcon, historyEventLabel } from './history-events';

describe('Prowlarr history events', () => {
  it.each([
    ['releaseGrabbed', 'Grab'],
    ['indexerQuery', 'Search'],
    ['indexerRss', 'RSS'],
    ['indexerAuth', 'Auth'],
    ['indexerInfo', 'Info'],
  ])('names %s as %s', (eventType, label) => {
    expect(historyEventLabel(eventType)).toBe(label);
  });

  it('shows an event Prowlarr adds later as sent', () => {
    expect(historyEventLabel('somethingNew')).toBe('somethingNew');
  });

  it('gives a grab its own icon', () => {
    const grab = render(<HistoryEventIcon eventType="releaseGrabbed" successful />).container.innerHTML;
    const query = render(<HistoryEventIcon eventType="indexerQuery" successful />).container.innerHTML;
    expect(grab).toContain('text-green-400');
    expect(grab).not.toBe(query);
  });

  it('shows a failed event as failed, whatever its type', () => {
    const { getByLabelText } = render(<HistoryEventIcon eventType="indexerRss" successful={false} />);
    expect(getByLabelText('Failed').getAttribute('class')).toContain('text-rose-400');
  });
});

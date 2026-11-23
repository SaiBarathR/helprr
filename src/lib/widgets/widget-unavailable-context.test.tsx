// @vitest-environment jsdom

import { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useReportWidgetUnavailable,
  useWidgetUnavailableReports,
  WidgetUnavailableProvider,
  type WidgetUnavailable,
} from './widget-unavailable-context';

function Load({ state, retry }: { state: WidgetUnavailable | null; retry: () => void }) {
  useReportWidgetUnavailable(state, retry);
  return null;
}

let shown: ReturnType<typeof useWidgetUnavailableReports>;
function Widget({ loads }: { loads: Array<[WidgetUnavailable | null, () => void]> }) {
  const reports = useWidgetUnavailableReports();
  useEffect(() => {
    shown = reports;
  });
  return (
    <WidgetUnavailableProvider report={reports.report}>
      {loads.map(([state, retry], i) => <Load key={i} state={state} retry={retry} />)}
    </WidgetUnavailableProvider>
  );
}

const ok = () => {};

describe('useWidgetUnavailableReports', () => {
  it('says why the rest failed: offline before unreachable before a failed load', () => {
    const view = render(<Widget loads={[['error', ok], [null, ok]]} />);
    expect(shown.unavailable).toBe('error');
    view.rerender(<Widget loads={[['error', ok], ['unreachable', ok]]} />);
    expect(shown.unavailable).toBe('unreachable');
    view.rerender(<Widget loads={[['offline', ok], ['unreachable', ok], ['error', ok]]} />);
    expect(shown.unavailable).toBe('offline');
    view.rerender(<Widget loads={[[null, ok], [null, ok]]} />);
    expect(shown.unavailable).toBeNull();
  });

  it('Retry loads again every failed load, with its latest retry', () => {
    const first = vi.fn();
    const second = vi.fn();
    const working = vi.fn();
    const view = render(<Widget loads={[['error', vi.fn()], ['error', second], [null, working]]} />);
    view.rerender(<Widget loads={[['error', first], ['error', second], [null, working]]} />);
    act(() => shown.retry());
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(working).not.toHaveBeenCalled();
  });
});

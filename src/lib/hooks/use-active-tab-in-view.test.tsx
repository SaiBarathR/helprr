// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scrollActiveTabIntoView, useActiveTabInView } from './use-active-tab-in-view';

/** A 200px track at x 0, its tabs at the given [left, right] (as laid out with scrollLeft 0). */
function track(tabs: [number, number][], active: number) {
  const scroller = document.createElement('div');
  const list = document.createElement('div');
  scroller.appendChild(list);
  scroller.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 36, width: 200, height: 36 }) as DOMRect;
  tabs.forEach(([l, r], i) => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.dataset.state = i === active ? 'active' : 'inactive';
    tab.getBoundingClientRect = () => ({ left: l - scroller.scrollLeft, right: r - scroller.scrollLeft }) as DOMRect;
    list.appendChild(tab);
  });
  return scroller;
}

const TABS: [number, number][] = [[0, 60], [60, 140], [140, 210], [210, 280]];

describe('scrollActiveTabIntoView', () => {
  it('scrolls a tab past the right edge just into view', () => {
    const scroller = track(TABS, 3);
    scrollActiveTabIntoView(scroller);
    expect(scroller.scrollLeft).toBe(80);
  });

  it('scrolls back to a tab before the left edge', () => {
    const scroller = track(TABS, 0);
    scroller.scrollLeft = 50;
    scrollActiveTabIntoView(scroller);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('leaves a track alone when the tab is already whole in view', () => {
    const scroller = track(TABS, 1);
    scroller.scrollLeft = 30;
    scrollActiveTabIntoView(scroller);
    expect(scroller.scrollLeft).toBe(30);
  });
});

describe('useActiveTabInView', () => {
  it('brings the selected tab into view when the track mounts (a reload kept a stale offset)', () => {
    const scroller = track(TABS, 3);
    function Probe() {
      const ref = useActiveTabInView('watching');
      return <div ref={(el) => { if (el && !el.firstChild) { el.appendChild(scroller); ref(scroller); } }} />;
    }
    render(<Probe />);
    expect(scroller.scrollLeft).toBe(80);
  });
});

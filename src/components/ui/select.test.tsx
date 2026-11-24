// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

function OpenSelect(props: React.ComponentProps<typeof SelectContent>) {
  return (
    <Select open value="b">
      <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
      <SelectContent {...props}>
        {['a', 'b', 'c'].map((v) => <SelectItem key={v} value={v}>{v.toUpperCase()}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const popperWrapper = () => screen.getByRole('listbox').closest('[data-radix-popper-content-wrapper]');

describe('SelectContent', () => {
  it('opens as a popper, so the list is placed and sized within the screen', () => {
    render(<OpenSelect />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(popperWrapper()).not.toBeNull();
  });

  it('still honours an explicit item-aligned position', () => {
    render(<OpenSelect position="item-aligned" />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(popperWrapper()).toBeNull();
  });
});

describe('SelectTrigger with a phone keyboard open', () => {
  function stubViewport(height: number) {
    const listeners = new Set<() => void>();
    const viewport = {
      height,
      scale: 1,
      offsetTop: 0,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('visualViewport', viewport);
    return { viewport, fire: () => listeners.forEach((listener) => listener()) };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderForm() {
    render(
      <>
        <input aria-label="Name" />
        <Select defaultValue="a">
          <SelectTrigger aria-label="Shows"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['a', 'b'].map((v) => <SelectItem key={v} value={v}>{v.toUpperCase()}</SelectItem>)}
          </SelectContent>
        </Select>
      </>,
    );
  }

  // Radix closes an open list on any window resize, which the keyboard closing causes.
  it('closes the keyboard first and opens the list once it has gone', () => {
    vi.useFakeTimers();
    const { viewport, fire } = stubViewport(window.innerHeight - 300);
    renderForm();
    const name = screen.getByRole('textbox', { name: 'Name' });
    name.focus();

    fireEvent.click(screen.getByRole('combobox', { name: 'Shows' }));
    expect(document.activeElement).not.toBe(name);
    expect(screen.queryByRole('listbox')).toBeNull();

    viewport.height = window.innerHeight;
    fire();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('still opens if the keyboard never reports closing', () => {
    vi.useFakeTimers();
    stubViewport(window.innerHeight - 300);
    renderForm();
    fireEvent.click(screen.getByRole('combobox', { name: 'Shows' }));
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('does not open over a field tapped while the keyboard was closing', () => {
    vi.useFakeTimers();
    stubViewport(window.innerHeight - 300);
    renderForm();
    fireEvent.click(screen.getByRole('combobox', { name: 'Shows' }));
    screen.getByRole('textbox', { name: 'Name' }).focus();
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('leaves a pinch zoom alone: it shrinks the visible area but is no keyboard', () => {
    const { viewport } = stubViewport(window.innerHeight / 2);
    viewport.scale = 2;
    renderForm();
    fireEvent.click(screen.getByRole('combobox', { name: 'Shows' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('opens straight away with no keyboard', () => {
    stubViewport(window.innerHeight);
    renderForm();
    fireEvent.click(screen.getByRole('combobox', { name: 'Shows' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
  });
});

describe('SelectTrigger value', () => {
  // jsdom has no layout, so a test says whether the value overflows its box.
  function stubWidths(scrollWidth: number, clientWidth: number) {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
  }
  afterEach(() => vi.restoreAllMocks());

  function renderSelect(trigger: Partial<React.ComponentProps<typeof SelectTrigger>> = {}) {
    render(
      <Select value="all">
        <SelectTrigger aria-label="Monitor New Seasons" className="w-20" {...trigger}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All new seasons</SelectItem>
          <SelectItem value="none">None</SelectItem>
        </SelectContent>
      </Select>,
    );
    return screen.getByRole('combobox', { name: 'Monitor New Seasons' });
  }

  it('lets the value shrink and end in an ellipsis', () => {
    const trigger = renderSelect();
    // Radix drops a className on the value, so the trigger styles it.
    expect(trigger.className.split(' ')).toEqual(expect.arrayContaining([
      '*:data-[slot=select-value]:block', '*:data-[slot=select-value]:min-w-0', '*:data-[slot=select-value]:truncate',
    ]));
    expect(trigger.className).not.toContain('select-value]:flex');
  });

  it('shows the full value on hover only when it is cut off', () => {
    const trigger = renderSelect();
    expect(trigger.hasAttribute('title')).toBe(false);

    stubWidths(120, 60);
    fireEvent.pointerEnter(trigger);
    expect(trigger.title).toBe('All new seasons');

    stubWidths(60, 60);
    fireEvent.pointerEnter(trigger);
    expect(trigger.hasAttribute('title')).toBe(false);
  });

  it("keeps a caller's own title and pointer handler", () => {
    const onPointerEnter = vi.fn();
    const trigger = renderSelect({ title: 'Custom', onPointerEnter });
    stubWidths(120, 60);
    fireEvent.pointerEnter(trigger);
    expect(trigger.title).toBe('Custom');
    expect(onPointerEnter).toHaveBeenCalledOnce();
  });
});

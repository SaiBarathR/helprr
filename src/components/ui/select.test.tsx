// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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

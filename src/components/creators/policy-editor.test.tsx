// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_POLICY, type PolicyLayer } from '@/lib/archive/policy';
import { PolicyEditor } from './policy-editor';

function Harness({ initial = {}, onChange }: { initial?: PolicyLayer; onChange: (next: PolicyLayer) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PolicyEditor
      value={value}
      footer="Footer"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('PolicyEditor', () => {
  beforeAll(() => {
    window.matchMedia ??= vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => undefined;
  });
  afterEach(cleanup);

  it('reports each keystroke, so the save bar appears before the field loses focus', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Longer than' }), '15');
    expect(onChange).toHaveBeenLastCalledWith({ conditions: { minDurationMinutes: 15 } });
  });

  it('keeps a stored 0 distinct from an empty, inherited field', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ keepLatest: 0 }} onChange={onChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Keep the latest' });
    expect(field).toHaveProperty('value', '0');
    await userEvent.clear(field);
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('keeps the comma while typing a list of words', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole('textbox', { name: 'Title has none of' });
    await userEvent.type(field, 'rerun, test');
    expect(field).toHaveProperty('value', 'rerun, test');
    expect(onChange).toHaveBeenLastCalledWith({ conditions: { titleExclude: ['rerun', 'test'] } });
  });

  it('offers Reset only on a field this layer overrides, and clears it', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ chat: false }} onChange={onChange} />);
    const resets = screen.getAllByRole('button', { name: 'Reset' });
    expect(resets).toHaveLength(1);
    await userEvent.click(resets[0]);
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });
});

describe('what a blank clean up field means', () => {
  const youtube = { ...BUILT_IN_POLICY, deleteAfterWatchedDays: 3 };

  it('shows the value that really applies, not Never', () => {
    render(<PolicyEditor value={{}} inherited={{}} footer="" onChange={vi.fn()} variant="youtube" builtIn={youtube} />);
    expect((screen.getByLabelText(/Delete once watched/) as HTMLInputElement).placeholder).toBe('3');
  });

  it('still says Never where there is no default', () => {
    render(<PolicyEditor value={{}} inherited={{}} footer="" onChange={vi.fn()} />);
    expect((screen.getByLabelText(/Delete once watched/) as HTMLInputElement).placeholder).toBe('Never');
  });
});

// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import { StepUpFields, useStepUp } from './step-up-fields';

let stepUp: ReturnType<typeof useStepUp>;

function Harness() {
  // eslint-disable-next-line react-hooks/globals -- the test drives the hook from outside
  stepUp = useStepUp(false);
  return <StepUpFields stepUp={stepUp} reason="Giving admin." />;
}

function renderFields() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('StepUpFields', () => {
  it('shows a refused password under the field, not in a toast, and typing clears it', async () => {
    renderFields();
    let shown = false;
    act(() => {
      shown = stepUp.onRefused({ error: 'Current password is incorrect', field: 'currentPassword' }, 403);
    });
    expect(shown).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Current password is incorrect');

    await userEvent.type(screen.getByLabelText('Your current password'), 'x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refused code, and the server asking for the password', () => {
    renderFields();
    act(() => {
      expect(stepUp.onRefused({ error: 'That code didn’t work. Try again.', field: 'code' }, 403)).toBe(true);
    });
    expect(screen.getByRole('alert').textContent).toBe('That code didn’t work. Try again.');
    act(() => {
      expect(stepUp.onRefused({ error: 'Giving admin access needs your current password.', needsStepUp: true, needsCode: false }, 403)).toBe(true);
    });
    expect(screen.getByRole('alert').textContent).toBe('Giving admin access needs your current password.');
  });

  it('counts a 429 as the sign-in throttle only after the password was sent', async () => {
    renderFields();
    act(() => {
      expect(stepUp.onRefused({ error: 'Too many requests' }, 429)).toBe(false);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.type(screen.getByLabelText('Your current password'), 'secret');
    act(() => {
      expect(stepUp.onRefused({ error: 'Too many attempts. Try again in 60 seconds.' }, 429)).toBe(true);
    });
    expect(screen.getByRole('alert').textContent).toBe('Too many attempts. Try again in 60 seconds.');
  });

  it('leaves other errors to the caller', () => {
    renderFields();
    act(() => {
      expect(stepUp.onRefused({ error: 'Username already taken' }, 409)).toBe(false);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

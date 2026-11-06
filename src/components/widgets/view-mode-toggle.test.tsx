// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewModeToggle } from './bento-primitives';

const classesOf = (name: string) => screen.getByRole('button', { name }).className.split(/\s+/);

describe('the widget view-mode toggle', () => {
  it('grows each half to 44px wide, away from the other half', () => {
    render(<ViewModeToggle value="carousel" onChange={() => {}} />);
    expect(classesOf('Carousel view')).toEqual(expect.arrayContaining(['touch-target-y', 'after:right-0', 'after:left-auto', 'after:w-11']));
    expect(classesOf('List view')).toEqual(expect.arrayContaining(['touch-target-y', 'after:w-11']));
  });
});

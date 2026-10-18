import { describe, expect, it, vi } from 'vitest';

const assertPageCapability = vi.hoisted(() => vi.fn());
vi.mock('@/lib/page-guard', () => ({ assertPageCapability }));

// The pages' API routes are the boundary; these guards give a member without
// the capability a 404 instead of a page of failed requests.
describe('section page guards', () => {
  it.each([
    ['activity', 'activity.view'],
    ['calendar', 'calendar.view'],
  ])('/%s requires %s', async (section, capability) => {
    const { default: Layout } = await import(`./${section}/layout`);
    await Layout({ children: null });
    expect(assertPageCapability).toHaveBeenLastCalledWith(capability);
  });
});

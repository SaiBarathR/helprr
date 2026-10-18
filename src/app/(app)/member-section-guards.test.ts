import { describe, expect, it, vi } from 'vitest';

const { assertPageCapability, assertPageAdmin } = vi.hoisted(() => ({ assertPageCapability: vi.fn(), assertPageAdmin: vi.fn() }));
vi.mock('@/lib/page-guard', () => ({ assertPageCapability, assertPageAdmin }));

// The pages' API routes are the boundary; these guards give a member without
// the capability a 404 instead of a page of failed requests.
describe('section page guards', () => {
  // /activity and /activity/history sit in the (view) group; the import page
  // has its own guard, matching its API (activity.manage, not activity.view).
  it.each([
    ['activity/(view)', 'activity.view'],
    ['activity/import', 'activity.manage'],
    ['calendar', 'calendar.view'],
    ['insights', 'insights.view'],
  ])('/%s requires %s', async (section, capability) => {
    const { default: Layout } = await import(`./${section}/layout`);
    await Layout({ children: null });
    expect(assertPageCapability).toHaveBeenLastCalledWith(capability);
  });

  it('/settings/file-audit is for admins, as its API is', async () => {
    const { default: Layout } = await import('./settings/file-audit/layout');
    await Layout({ children: null });
    expect(assertPageAdmin).toHaveBeenCalledTimes(1);
  });
});

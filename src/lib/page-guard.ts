import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

/**
 * Server-side page guard: render a 404 for users who lack `cap`. Used by thin
 * route `layout.tsx` files wrapping admin-only pages so a member who types the
 * URL directly gets notFound() instead of a broken page. The page's API routes
 * are the real boundary; this is the page-level half of defense-in-depth.
 */
export async function assertPageCapability(cap: Capability): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !can(user, cap)) {
    notFound();
  }
}

/**
 * Server-side page guard for admin-only pages with no dedicated capability
 * (e.g. the AniList library, which is tied to the single shared operator
 * account). Renders a 404 for non-admins.
 */
export async function assertPageAdmin(): Promise<void> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    notFound();
  }
}

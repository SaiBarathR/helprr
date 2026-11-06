import type { Metadata } from 'next';

// The link's token travels in the URL fragment; keep the page out of search
// indexes and Referer headers all the same.
export const metadata: Metadata = {
  title: 'Set your password · Helprr',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from 'next';

// The URL is a credential: keep it out of search indexes and Referer headers.
export const metadata: Metadata = {
  title: 'Set your password · Helprr',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

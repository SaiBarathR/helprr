import { redirect } from 'next/navigation';

// Random Watch now lives inside Recommendations as its "Random" mode. Keep the
// old URL working for bookmarks, PWA shortcuts, and muscle memory.
export default function RandomRedirect() {
  redirect('/recommendations?mode=random');
}

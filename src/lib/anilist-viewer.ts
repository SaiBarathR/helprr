/** All observers sharing the viewer query must cache the complete response.
 * A transient upstream failure must not replace a connected account with a
 * fabricated disconnected state and collapse the library on back navigation.
 */
export async function fetchAnilistViewer<T>(signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/anilist/viewer', { signal });
  if (!response.ok) throw new Error('Unable to load AniList connection');
  return response.json() as Promise<T>;
}

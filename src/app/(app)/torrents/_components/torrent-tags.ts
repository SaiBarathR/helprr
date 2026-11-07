/** qBittorrent lists a torrent's tags as one string joined with ", ". */
export function parseTorrentTags(tags: string | undefined): string[] {
  return (tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

/** Why qBittorrent would refuse this new tag name, or null when it is fine. */
export function newTagProblem(tag: string): string | null {
  const name = tag.trim();
  if (!name) return 'Name the tag';
  if (name.includes(',')) return "A tag can't contain a comma";
  if (name.length > 100) return 'Keep the tag under 100 characters';
  return null;
}

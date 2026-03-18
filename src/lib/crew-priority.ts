const RANKED_CREW_ROLES: Record<string, number> = {
  Director: 0,
  Creator: 1,
  Showrunner: 2,
  Writer: 3,
  Screenplay: 4,
  Story: 5,
  'Executive Producer': 6,
  Producer: 7,
  'Director of Photography': 8,
  'Original Music Composer': 9,
  Editor: 10,
};

const UNRANKED = 99;

export function crewRolePriority(job: string): number {
  return RANKED_CREW_ROLES[job] ?? UNRANKED;
}

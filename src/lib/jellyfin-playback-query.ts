export function sanitizeDays(
  input: string | null,
  defaultDays: number,
  maxDays = 3650
): number {
  const parsed = input ? Number(input) : Number.NaN;
  if (!Number.isFinite(parsed)) return defaultDays;
  const normalized = Math.floor(parsed);
  if (normalized < 1) return defaultDays;
  return Math.min(normalized, maxDays);
}

export function getDefaultEndDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

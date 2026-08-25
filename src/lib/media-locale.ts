function displayName(type: 'language' | 'region', code: string | null | undefined): string | null {
  const normalized = code?.trim();
  if (!normalized) return null;

  try {
    return new Intl.DisplayNames(['en'], { type }).of(normalized) ?? normalized.toUpperCase();
  } catch {
    return normalized.toUpperCase();
  }
}

export function formatLanguageCode(code: string | null | undefined): string | null {
  return displayName('language', code);
}

export function formatRegionCode(code: string | null | undefined): string | null {
  return displayName('region', code);
}

export function formatRegionCodes(codes: readonly string[] | null | undefined): string | null {
  const names = (codes ?? [])
    .map(formatRegionCode)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(', ') : null;
}
